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
  populateAttribution?: boolean;
  createMissingAttribution?: boolean;
  linkPrimaryContact?: boolean;
  createMissingContacts?: boolean;
  requestIntervalMs?: number;
  timeoutMs?: number;
};

export type OdooSyncResult = {
  status: "disabled" | "completed";
  attempted: number;
  created: number;
  updated: number;
  unchanged: number;
  contactsCreated: number;
  contactsMatched: number;
  attributionRecordsCreated: number;
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
    populateAttribution: config.populateAttribution === true,
    createMissingAttribution: config.createMissingAttribution === true,
    linkPrimaryContact: config.linkPrimaryContact === true,
    createMissingContacts: config.createMissingContacts === true,
    requestIntervalMs: Math.max(0, config.requestIntervalMs ?? 0),
    timeoutMs: Math.max(1_000, config.timeoutMs || 30_000),
  };
}

function rateLimitedFetcher(fetcher: typeof fetch, intervalMs: number): typeof fetch {
  if (intervalMs <= 0) return fetcher;
  let lastStartedAt = 0;
  return (async (...args: Parameters<typeof fetch>) => {
    const waitMs = Math.max(0, lastStartedAt + intervalMs - Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastStartedAt = Date.now();
    return fetcher(...args);
  }) as typeof fetch;
}

type OdooFieldInfo = {
  type?: string;
  readonly?: boolean;
  relation?: string;
  selection?: Array<[string, string]>;
};

const ODOO_STANDARD_LEAD_FIELD_TYPES: Record<string, string> = {
  partner_name: "char",
  contact_name: "char",
  email_from: "char",
  phone: "char",
  function: "char",
  street: "char",
  date_deadline: "date",
  partner_id: "many2one",
  campaign_id: "many2one",
  medium_id: "many2one",
  source_id: "many2one",
};

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
    ...Object.keys(ODOO_STANDARD_LEAD_FIELD_TYPES),
    "type",
    "team_id",
    "user_id",
    "priority",
    ...(config.initialStageId ? ["stage_id"] : []),
  ])];
  const fields = await json2Call(config, config.model, "fields_get", {
    allfields: requiredFields,
    attributes: ["type", "readonly", "relation", "selection"],
  }, fetcher) as Record<string, OdooFieldInfo>;
  const missing = requiredFields.filter((field) => !Object.hasOwn(fields, field));
  if (missing.length > 0) {
    throw new Error(`Odoo preflight failed; required fields are missing: ${missing.join(", ")}. No records were written.`);
  }
  const mismatched = Object.entries({ ...ODOO_TENDER_FIELD_TYPES, ...ODOO_STANDARD_LEAD_FIELD_TYPES })
    .filter(([name, type]) => fields[name]?.type !== type)
    .map(([name, type]) => `${name} expected ${type}, found ${fields[name]?.type ?? "missing"}`);
  if (mismatched.length > 0) {
    throw new Error(`Odoo preflight failed; custom field types do not match: ${mismatched.join("; ")}. No records were written.`);
  }
  return { requiredFieldCount: requiredFields.length, fields };
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
  const odooFetch = rateLimitedFetcher(fetcher, config.requestIntervalMs);
  assertCompletePreflightRoutingConfig(config);
  const apiVersion = await assertSupportedVersion(config, odooFetch);
  const { requiredFieldCount } = await assertFieldsExist(config, payloads, odooFetch);
  await assertRoutingRecordsExist(config, odooFetch);
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

function selectionValue(field: OdooFieldInfo | undefined, label: string) {
  if (!label) return false;
  const normalized = label.trim().toLowerCase();
  const match = field?.selection?.find(([key, display]) =>
    key.trim().toLowerCase() === normalized || display.trim().toLowerCase() === normalized);
  if (!match) {
    throw new Error(`Odoo project-sector selection has no value matching ${label}.`);
  }
  return match[0];
}

function createdId(result: unknown) {
  if (Number.isInteger(result) && Number(result) > 0) return Number(result);
  if (Array.isArray(result) && Number.isInteger(result[0]) && Number(result[0]) > 0) return Number(result[0]);
  throw new Error("Odoo create returned no usable record ID.");
}

async function namedRecordId(
  config: ReturnType<typeof requiredConfig>,
  model: string,
  name: string,
  createMissing: boolean,
  fetcher: typeof fetch,
) {
  const matches = await json2Call(config, model, "search_read", {
    domain: [["name", "=ilike", name]],
    fields: ["id", "name"],
    limit: 5,
  }, fetcher) as Array<{ id?: number; name?: string }>;
  const exact = matches.filter((record) => record.name?.trim().toLowerCase() === name.trim().toLowerCase());
  if (exact.length > 0 && Number.isInteger(exact[0]?.id)) {
    return { id: exact[0].id!, created: false };
  }
  if (!createMissing) return { id: false as const, created: false };
  const id = createdId(await json2Call(config, model, "create", { vals_list: [{ name }] }, fetcher));
  return { id, created: true };
}

async function attributionValues(
  payload: OdooLeadDryRun,
  config: ReturnType<typeof requiredConfig>,
  fetcher: typeof fetch,
) {
  if (!config.populateAttribution) return { values: {}, created: 0 };
  const campaign = await namedRecordId(
    config, "utm.campaign", payload.attribution.campaignName, config.createMissingAttribution, fetcher,
  );
  const medium = await namedRecordId(
    config, "utm.medium", payload.attribution.mediumName, config.createMissingAttribution, fetcher,
  );
  const source = await namedRecordId(
    config, "utm.source", payload.attribution.sourceName, config.createMissingAttribution, fetcher,
  );
  const values: Record<string, number> = {};
  if (campaign.id) values.campaign_id = campaign.id;
  if (medium.id) values.medium_id = medium.id;
  if (source.id) values.source_id = source.id;
  return {
    values,
    created: Number(campaign.created) + Number(medium.created) + Number(source.created),
  };
}

async function primaryContactId(
  payload: OdooLeadDryRun,
  config: ReturnType<typeof requiredConfig>,
  fetcher: typeof fetch,
) {
  if (!config.linkPrimaryContact) return { id: false as const, created: false, matched: false };
  const { email_from: email, phone, contact_name: contact, partner_name: company } = payload.values;
  if (!email && !phone) return { id: false as const, created: false, matched: false };
  const domain = email
    ? [["email", "=ilike", email]]
    : [["phone", "=", phone]];
  const matches = await json2Call(config, "res.partner", "search_read", {
    domain,
    fields: ["id", "name", "email", "phone"],
    limit: 3,
  }, fetcher) as Array<{ id?: number }>;
  if (matches.length === 1 && Number.isInteger(matches[0]?.id)) {
    return { id: matches[0].id!, created: false, matched: true };
  }
  if (matches.length > 1 || !config.createMissingContacts) {
    return { id: false as const, created: false, matched: false };
  }
  const displayName = contact && company ? `${contact} (${company})` : contact || company || email || phone;
  const id = createdId(await json2Call(config, "res.partner", "create", {
    vals_list: [{
      name: displayName,
      email: email || false,
      phone: phone || false,
      function: payload.values.function || false,
      street: payload.values.street || false,
      company_type: "person",
      comment: `Created by Helmonic Tender Intelligence for ${payload.values.name}.`,
    }],
  }, fetcher));
  return { id, created: true, matched: false };
}

function valuesForOdoo(
  payload: OdooLeadDryRun,
  config: ReturnType<typeof requiredConfig>,
  fields: Record<string, OdooFieldInfo>,
  linkedValues: Record<string, unknown> = {},
) {
  const values: Record<string, unknown> = {
    ...payload.values,
    x_studio_project_sector: selectionValue(fields.x_studio_project_sector, payload.values.x_studio_project_sector),
    [config.externalIdField]: payload.matchValue,
    type: "opportunity",
    team_id: config.salesTeamId,
    user_id: ownerUserId(payload, config),
    priority: odooPriority(payload),
    ...linkedValues,
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
    return {
      status: "disabled",
      attempted: 0,
      created: 0,
      updated: 0,
      unchanged: payloads.length,
      contactsCreated: 0,
      contactsMatched: 0,
      attributionRecordsCreated: 0,
      failures: [],
    };
  }
  const config = requiredConfig(inputConfig);
  const odooFetch = rateLimitedFetcher(fetcher, config.requestIntervalMs);
  assertRoutingConfig(config, payloads);
  await assertSupportedVersion(config, odooFetch);
  const { fields } = await assertFieldsExist(config, payloads, odooFetch);

  const result: OdooSyncResult = {
    status: "completed",
    attempted: payloads.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    contactsCreated: 0,
    contactsMatched: 0,
    attributionRecordsCreated: 0,
    failures: [],
  };
  for (const payload of payloads) {
    try {
      const matches = await json2Call(config, config.model, "search_read", {
        domain: [[config.externalIdField, "=", payload.matchValue]],
        fields: ["id"],
        limit: 2,
      }, odooFetch) as Array<{ id?: number }>;
      if (!Array.isArray(matches)) throw new Error("Odoo search_read returned an invalid response.");
      if (matches.length > 1) throw new Error("More than one Odoo lead has the same Helmonic external ID.");
      const attribution = await attributionValues(payload, config, odooFetch);
      const contact = await primaryContactId(payload, config, odooFetch);
      const linkedValues: Record<string, unknown> = { ...attribution.values };
      if (contact.id) linkedValues.partner_id = contact.id;
      const values = valuesForOdoo(payload, config, fields, linkedValues);
      result.attributionRecordsCreated += attribution.created;
      result.contactsCreated += Number(contact.created);
      result.contactsMatched += Number(contact.matched);
      if (matches.length === 1 && Number.isFinite(matches[0]?.id)) {
        await json2Call(config, config.model, "write", { ids: [matches[0].id], vals: values }, odooFetch);
        result.updated += 1;
      } else {
        await json2Call(config, config.model, "create", { vals_list: [values] }, odooFetch);
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
