import type { OdooLeadDryRun } from "./odoo-payload.ts";
import { ODOO_TENDER_FIELD_TYPES } from "./odoo-field-contract.ts";

export type OdooJson2Config = {
  enabled: boolean;
  baseUrl?: string;
  database?: string;
  apiKey?: string;
  model?: string;
  externalIdField?: string;
  salesTeamId?: number;
  initialStageId?: number;
  glenUserId?: number;
  eoghanUserId?: number;
  timeoutMs?: number;
};

export type OdooSyncResult = {
  status: "disabled" | "completed";
  attempted: number;
  created: number;
  updated: number;
  unchanged: number;
  failures: Array<{ externalId: string; error: string }>;
};

export type OdooPreflightResult = {
  status: "completed";
  apiVersion: string;
  model: string;
  externalIdField: string;
  requiredFieldCount: number;
  salesTeamId: number;
  initialStageId: number;
  ownerUserIds: {
    glen: number;
    eoghan: number;
  };
  checks: ["version", "field-contract", "sales-team", "initial-stage", "owner-users"];
  writesAttempted: 0;
};

function requiredConfig(config: OdooJson2Config) {
  if (!config.baseUrl || !config.apiKey) {
    throw new Error("Odoo synchronization is enabled but ODOO_BASE_URL or ODOO_API_KEY is missing.");
  }
  return {
    baseUrl: config.baseUrl.replace(/\/+$/, ""),
    apiKey: config.apiKey,
    database: config.database,
    model: config.model || "crm.lead",
    externalIdField: config.externalIdField || "x_helmonic_external_id",
    salesTeamId: positiveInteger(config.salesTeamId),
    initialStageId: positiveInteger(config.initialStageId),
    glenUserId: positiveInteger(config.glenUserId),
    eoghanUserId: positiveInteger(config.eoghanUserId),
    timeoutMs: Math.max(1_000, config.timeoutMs || 30_000),
  };
}

function positiveInteger(value?: number) {
  return Number.isInteger(value) && value! > 0 ? value : undefined;
}

async function responseError(response: Response) {
  const body = (await response.text()).slice(0, 2_000);
  return `Odoo ${response.status}${body ? `: ${body}` : ""}`;
}

async function json2Call(
  config: ReturnType<typeof requiredConfig>,
  model: string,
  method: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `bearer ${config.apiKey}`,
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "Helmonic-Tender-Intelligence/1.0",
  };
  if (config.database) headers["X-Odoo-Database"] = config.database;
  const response = await fetcher(`${config.baseUrl}/json/2/${encodeURIComponent(model)}/${encodeURIComponent(method)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

async function assertSupportedVersion(config: ReturnType<typeof requiredConfig>, fetcher: typeof fetch) {
  const response = await fetcher(`${config.baseUrl}/web/version`, {
    headers: { Accept: "application/json", "User-Agent": "Helmonic-Tender-Intelligence/1.0" },
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!response.ok) throw new Error(await responseError(response));
  const version = await response.json() as {
    server_version_info?: unknown[];
    server_version?: string;
    version_info?: unknown[];
    version?: string;
  };
  const versionInfo = version.server_version_info ?? version.version_info;
  const versionLabel = version.server_version ?? version.version;
  const major = Number(
    String(versionLabel ?? "").match(/\d+/)?.[0]
      ?? versionInfo?.find((part) => Number.isFinite(Number(part)) && Number(part) >= 10),
  );
  if (!Number.isFinite(major) || major < 19) {
    throw new Error("Odoo JSON-2 synchronization requires Odoo 19 or newer; no records were written.");
  }
  return String(versionLabel ?? versionInfo?.slice(0, 3).join(".") ?? major);
}

async function assertFieldsExist(
  config: ReturnType<typeof requiredConfig>,
  payloads: OdooLeadDryRun[],
  fetcher: typeof fetch,
) {
  const requiredFields = [...new Set([
    config.externalIdField,
    ...Object.keys(ODOO_TENDER_FIELD_TYPES),
    ...payloads.flatMap((payload) => Object.keys(payload.values)),
    "type",
    "team_id",
    "user_id",
    "priority",
    ...(config.initialStageId ? ["stage_id"] : []),
  ])];
  const fields = await json2Call(config, config.model, "fields_get", {
    allfields: requiredFields,
    attributes: ["type", "readonly"],
  }, fetcher) as Record<string, { type?: string; readonly?: boolean }>;
  const missing = requiredFields.filter((field) => !Object.hasOwn(fields, field));
  if (missing.length > 0) {
    throw new Error(`Odoo preflight failed; required fields are missing: ${missing.join(", ")}. No records were written.`);
  }
  const mismatched = Object.entries(ODOO_TENDER_FIELD_TYPES)
    .filter(([name, type]) => fields[name]?.type !== type)
    .map(([name, type]) => `${name} expected ${type}, found ${fields[name]?.type ?? "missing"}`);
  if (mismatched.length > 0) {
    throw new Error(`Odoo preflight failed; custom field types do not match: ${mismatched.join("; ")}. No records were written.`);
  }
  return requiredFields.length;
}

function assertRoutingConfig(config: ReturnType<typeof requiredConfig>, payloads: OdooLeadDryRun[]) {
  if (payloads.length === 0) return;
  const missing: string[] = [];
  if (!config.salesTeamId) missing.push("ODOO_SALES_TEAM_ID");
  if (payloads.some((payload) => payload.values.x_assigned_person === "Glen Plunkett") && !config.glenUserId) {
    missing.push("ODOO_GLEN_USER_ID");
  }
  if (payloads.some((payload) => payload.values.x_assigned_person === "Eoghan Tyrrell") && !config.eoghanUserId) {
    missing.push("ODOO_EOGHAN_USER_ID");
  }
  if (missing.length > 0) {
    throw new Error(`Odoo preflight failed; native CRM routing is not configured: ${missing.join(", ")}. No records were written.`);
  }
}

function assertCompletePreflightRoutingConfig(config: ReturnType<typeof requiredConfig>) {
  const missing: string[] = [];
  if (!config.salesTeamId) missing.push("ODOO_SALES_TEAM_ID");
  if (!config.initialStageId) missing.push("ODOO_INITIAL_STAGE_ID");
  if (!config.glenUserId) missing.push("ODOO_GLEN_USER_ID");
  if (!config.eoghanUserId) missing.push("ODOO_EOGHAN_USER_ID");
  if (missing.length > 0) {
    throw new Error(`Odoo preflight failed; routing configuration is incomplete: ${missing.join(", ")}. No records were written.`);
  }
}

async function routingRecord(
  config: ReturnType<typeof requiredConfig>,
  model: string,
  id: number,
  label: string,
  fetcher: typeof fetch,
) {
  const records = await json2Call(config, model, "search_read", {
    domain: [["id", "=", id]],
    fields: ["id", "name"],
    limit: 2,
  }, fetcher) as Array<{ id?: number; name?: string }>;
  if (!Array.isArray(records) || records.length !== 1 || records[0]?.id !== id) {
    throw new Error(`Odoo preflight failed; ${label} ID ${id} is not readable or does not exist. No records were written.`);
  }
  return records[0];
}

async function assertRoutingRecordsExist(config: ReturnType<typeof requiredConfig>, fetcher: typeof fetch) {
  const team = await routingRecord(config, "crm.team", config.salesTeamId!, "sales team", fetcher);
  const stage = await routingRecord(config, "crm.stage", config.initialStageId!, "initial stage", fetcher);
  const glen = await routingRecord(config, "res.users", config.glenUserId!, "Glen owner user", fetcher);
  const eoghan = await routingRecord(config, "res.users", config.eoghanUserId!, "Eoghan owner user", fetcher);
  if (!String(glen.name ?? "").toLowerCase().includes("glen")) {
    throw new Error(`Odoo preflight failed; user ID ${config.glenUserId} does not resolve to Glen. No records were written.`);
  }
  if (!String(eoghan.name ?? "").toLowerCase().includes("eoghan")) {
    throw new Error(`Odoo preflight failed; user ID ${config.eoghanUserId} does not resolve to Eoghan. No records were written.`);
  }
  return { team, stage, glen, eoghan };
}

export async function preflightOdoo(
  payloads: OdooLeadDryRun[],
  inputConfig: OdooJson2Config,
  fetcher: typeof fetch = fetch,
): Promise<OdooPreflightResult> {
  const config = requiredConfig(inputConfig);
  assertCompletePreflightRoutingConfig(config);
  const apiVersion = await assertSupportedVersion(config, fetcher);
  const requiredFieldCount = await assertFieldsExist(config, payloads, fetcher);
  await assertRoutingRecordsExist(config, fetcher);
  return {
    status: "completed",
    apiVersion,
    model: config.model,
    externalIdField: config.externalIdField,
    requiredFieldCount,
    salesTeamId: config.salesTeamId!,
    initialStageId: config.initialStageId!,
    ownerUserIds: { glen: config.glenUserId!, eoghan: config.eoghanUserId! },
    checks: ["version", "field-contract", "sales-team", "initial-stage", "owner-users"],
    writesAttempted: 0,
  };
}

function ownerUserId(payload: OdooLeadDryRun, config: ReturnType<typeof requiredConfig>) {
  if (payload.values.x_assigned_person === "Glen Plunkett") return config.glenUserId;
  if (payload.values.x_assigned_person === "Eoghan Tyrrell") return config.eoghanUserId;
  return false;
}

function odooPriority(payload: OdooLeadDryRun) {
  if (payload.values.x_lead_quality === "excellent") return "3";
  if (payload.values.x_lead_quality === "good") return "2";
  if (payload.values.x_lead_quality === "medium") return "1";
  return "0";
}

function valuesForOdoo(payload: OdooLeadDryRun, config: ReturnType<typeof requiredConfig>) {
  const values: Record<string, unknown> = {
    ...payload.values,
    [config.externalIdField]: payload.matchValue,
    type: "opportunity",
    team_id: config.salesTeamId,
    user_id: ownerUserId(payload, config),
    priority: odooPriority(payload),
  };
  if (config.externalIdField !== "x_helmonic_external_id") delete values.x_helmonic_external_id;
  if (config.initialStageId) values.stage_id = config.initialStageId;
  return values;
}

export async function syncOdooLeads(
  payloads: OdooLeadDryRun[],
  inputConfig: OdooJson2Config,
  fetcher: typeof fetch = fetch,
): Promise<OdooSyncResult> {
  if (!inputConfig.enabled) {
    return { status: "disabled", attempted: 0, created: 0, updated: 0, unchanged: payloads.length, failures: [] };
  }
  const config = requiredConfig(inputConfig);
  assertRoutingConfig(config, payloads);
  await assertSupportedVersion(config, fetcher);
  await assertFieldsExist(config, payloads, fetcher);

  const result: OdooSyncResult = {
    status: "completed",
    attempted: payloads.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    failures: [],
  };
  for (const payload of payloads) {
    try {
      const matches = await json2Call(config, config.model, "search_read", {
        domain: [[config.externalIdField, "=", payload.matchValue]],
        fields: ["id"],
        limit: 2,
      }, fetcher) as Array<{ id?: number }>;
      if (!Array.isArray(matches)) throw new Error("Odoo search_read returned an invalid response.");
      if (matches.length > 1) throw new Error("More than one Odoo lead has the same Helmonic external ID.");
      const values = valuesForOdoo(payload, config);
      if (matches.length === 1 && Number.isFinite(matches[0]?.id)) {
        await json2Call(config, config.model, "write", { ids: [matches[0].id], vals: values }, fetcher);
        result.updated += 1;
      } else {
        await json2Call(config, config.model, "create", { vals_list: [values] }, fetcher);
        result.created += 1;
      }
    } catch (error) {
      result.failures.push({
        externalId: payload.matchValue,
        error: error instanceof Error ? error.message : "Unknown Odoo synchronization error",
      });
    }
  }
  if (result.failures.length > 0) {
    throw new Error(`Odoo synchronization completed with ${result.failures.length} failed record(s).`);
  }
  return result;
}
