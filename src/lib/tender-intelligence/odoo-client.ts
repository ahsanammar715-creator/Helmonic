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
  populateEmailMatchTags?: boolean;
  createMissingEmailMatchTags?: boolean;
  populateSourceTags?: boolean;
  createMissingSourceTags?: boolean;
  normalizeHistoricalRecords?: boolean;
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
  emailMatchTagsCreated: number;
  emailMatchTagsLinked: number;
  sourceTagsCreated: number;
  sourceTagsLinked: number;
  historicalRecordsNormalized: number;
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
    populateEmailMatchTags: config.populateEmailMatchTags === true,
    createMissingEmailMatchTags: config.createMissingEmailMatchTags === true,
    populateSourceTags: config.populateSourceTags === true,
    createMissingSourceTags: config.createMissingSourceTags === true,
    normalizeHistoricalRecords: config.normalizeHistoricalRecords === true,
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
  tag_ids: "many2many",
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

function odooPriorityFromRank(rank: number) {
  // Reserve Odoo's three-star treatment for current, actionable RFIs. This
  // prevents an older generic email match from visually outranking a live RFI.
  if (rank >= 1300) return "3";
  if (rank >= 900) return "2";
  if (rank >= 600) return "1";
  return "0";
}

function odooPriority(payload: OdooLeadDryRun) {
  return odooPriorityFromRank(payload.values.x_pipeline_priority_rank);
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

async function emailMatchTagValues(
  payload: OdooLeadDryRun,
  config: ReturnType<typeof requiredConfig>,
  registry: TagRegistry,
  fetcher: typeof fetch,
) {
  if (!config.populateEmailMatchTags || !payload.emailMatchTagName) {
    return { ids: [] as number[], created: 0, linked: 0 };
  }
  const tag = await tagRecordId(config, registry, payload.emailMatchTagName, config.createMissingEmailMatchTags, fetcher);
  return {
    ids: tag.id ? [tag.id] : [],
    created: Number(tag.created),
    linked: Number(Boolean(tag.id)),
  };
}

async function sourceTagValues(
  payload: OdooLeadDryRun,
  config: ReturnType<typeof requiredConfig>,
  registry: TagRegistry,
  fetcher: typeof fetch,
) {
  const names = [...payload.sourceTagNames, ...payload.statusTagNames];
  if (!config.populateSourceTags || names.length === 0) {
    return { ids: [] as number[], created: 0, linked: 0 };
  }
  const ids: number[] = [];
  let created = 0;
  for (const name of names) {
    const tag = await tagRecordId(config, registry, name, config.createMissingSourceTags, fetcher);
    if (!tag.id) continue;
    ids.push(tag.id);
    created += Number(tag.created);
  }
  return { ids, created, linked: ids.length };
}

type TagRegistry = {
  byId: Map<number, string>;
  byName: Map<string, number>;
};

const SOURCE_TAG_NAMES = new Set([
  "BI", "PL", "NPR", "DCC", "TD", "EU",
  "Source: BuildingInfo", "Source: PlanningLeads", "Source: National Planning Register",
  "Source: DCC", "Source: eTenders", "Source: TED",
].map((name) => name.toLowerCase()));

const EMAIL_TAG_NAMES = new Set([
  "Verified Email Match - Glen", "Verified Email Match - Eoghan", "Verified Email Match",
  "Email Match - Multiple Owners", "Email Match: Glen", "Email Match: Eoghan",
  "Email Match: Glen + Eoghan", "Email Match: Verified",
].map((name) => name.toLowerCase()));

const STATUS_TAG_NAMES = new Set([
  "Already Won: iAcoustics", "Competitor Appointed", "Appointment: Verify",
].map((name) => name.toLowerCase()));

const SOURCE_SYSTEM_CODES = new Map([
  ["buildinginfo", "BI"],
  ["planningleads", "PL"],
  ["national planning register", "NPR"],
  ["dcc", "DCC"],
  ["etenders", "TD"],
  ["ted", "EU"],
]);

const SOURCE_CODE_ORDER = ["BI", "PL", "NPR", "DCC", "TD", "EU"];

function managedTagName(name?: string) {
  const normalized = String(name ?? "").trim().toLowerCase();
  return SOURCE_TAG_NAMES.has(normalized) || EMAIL_TAG_NAMES.has(normalized) || STATUS_TAG_NAMES.has(normalized);
}

async function loadTagRegistry(
  config: ReturnType<typeof requiredConfig>,
  fetcher: typeof fetch,
): Promise<TagRegistry> {
  if (!config.populateEmailMatchTags && !config.populateSourceTags) {
    return { byId: new Map(), byName: new Map() };
  }
  const records = await json2Call(config, "crm.tag", "search_read", {
    domain: [],
    fields: ["id", "name"],
    limit: 1_000,
  }, fetcher) as Array<{ id?: number; name?: string }>;
  const byId = new Map<number, string>();
  const byName = new Map<string, number>();
  for (const record of records) {
    if (!Number.isInteger(record.id) || !record.name) continue;
    byId.set(record.id!, record.name);
    byName.set(record.name.trim().toLowerCase(), record.id!);
  }
  return { byId, byName };
}

async function tagRecordId(
  config: ReturnType<typeof requiredConfig>,
  registry: TagRegistry,
  name: string,
  createMissing: boolean,
  fetcher: typeof fetch,
) {
  const existing = registry.byName.get(name.trim().toLowerCase());
  if (existing) return { id: existing, created: false };
  if (!createMissing) return { id: false as const, created: false };
  const id = createdId(await json2Call(config, "crm.tag", "create", { vals_list: [{ name }] }, fetcher));
  registry.byId.set(id, name);
  registry.byName.set(name.trim().toLowerCase(), id);
  return { id, created: true };
}

function managedTagCommands(existingIds: number[], desiredIds: number[], registry: TagRegistry) {
  const existing = new Set(existingIds);
  const desired = new Set(desiredIds);
  const remove = existingIds
    .filter((id) => managedTagName(registry.byId.get(id)) && !desired.has(id))
    .map((id): [number, number] => [3, id]);
  const add = desiredIds
    .filter((id) => !existing.has(id))
    .map((id): [number, number] => [4, id]);
  return [...remove, ...add];
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

type ExistingLeadValues = {
  id?: number;
  name?: string | false;
  priority?: string | false;
  tag_ids?: number[];
  partner_name?: string | false;
  contact_name?: string | false;
  email_from?: string | false;
  phone?: string | false;
  function?: string | false;
  street?: string | false;
  x_applicant?: string | false;
  x_party_details?: string | false;
  x_source_systems?: string | false;
  x_project_reference?: string | false;
  x_studio_reference?: string | false;
  x_helmonic_external_id?: string | false;
  x_source_record_ids?: string | false;
  x_source_urls?: string | false;
  x_project_link?: string | false;
  x_evidence_document_urls?: string | false;
  x_assigned_person?: string | false;
  x_warm_connection_verified?: boolean;
  x_lead_quality?: string | false;
  x_pipeline_bucket?: string | false;
  x_pipeline_priority_rank?: number;
  x_pipeline_priority_reason?: string | false;
  x_classification?: string | false;
  x_rfi_received_at?: string | false;
  x_rfi_response_due_at?: string | false;
  x_decision_due_at?: string | false;
  x_source_major_updated_at?: string | false;
  x_first_seen_at?: string | false;
  x_project_stage?: string | false;
  x_routing_reason?: string | false;
  x_acoustic_appointment_status?: string | false;
  x_appointed_acoustician?: string | false;
  x_appointment_evidence?: string | false;
  x_appointment_evidence_source_url?: string | false;
  x_competitive_quote_opportunity?: boolean;
  x_outreach_eligibility?: string | false;
  x_outreach_suppression_reason?: string | false;
  x_outreach_key?: string | false;
};

function appointmentTagName(status: unknown) {
  if (status === "iacoustics-appointed") return "Already Won: iAcoustics";
  if (status === "competitor-appointed") return "Competitor Appointed";
  if (status === "needs-verification") return "Appointment: Verify";
  return undefined;
}

function sourceCodesFromSystems(value: unknown) {
  const codes = typeof value === "string"
    ? value.split(";").map((system) => SOURCE_SYSTEM_CODES.get(system.trim().toLowerCase())).filter(Boolean) as string[]
    : [];
  return [...new Set(codes)].sort((left, right) => SOURCE_CODE_ORDER.indexOf(left) - SOURCE_CODE_ORDER.indexOf(right));
}

function sourcePrefixedName(name: unknown, codes: string[]) {
  const current = typeof name === "string" ? name.trim() : "";
  if (!current || codes.length === 0) return current;
  const withoutManagedPrefix = current.replace(/^\[(?:BI|PL|NPR|DCC|TD|EU)(?:\+(?:BI|PL|NPR|DCC|TD|EU))*\]\s*/i, "");
  return `[${codes.join("+")}] ${withoutManagedPrefix}`;
}

function historicalDaysRemaining(value: unknown, now: Date) {
  if (typeof value !== "string" || !value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const target = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  const current = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - current) / 86_400_000);
}

function historicalRecentRfi(record: ExistingLeadValues, now: Date) {
  const received = record.x_rfi_received_at || record.x_source_major_updated_at || record.x_first_seen_at;
  const age = historicalDaysRemaining(received, now);
  return age !== false && age <= 0 && age >= -42;
}

function historicalPipelinePriority(record: ExistingLeadValues, now: Date) {
  const quality = typeof record.x_lead_quality === "string" ? record.x_lead_quality : "";
  const bucket = typeof record.x_pipeline_bucket === "string" ? record.x_pipeline_bucket : "";
  const routeable = !["poor", "closed-background", "existing-project"].includes(quality)
    && !["background", "already-won"].includes(bucket);
  const verifiedEmailMatch = record.x_warm_connection_verified === true && routeable;
  const rfi = record.x_classification === "noise-related-rfi" && routeable;
  const buildingInfo = sourceCodesFromSystems(record.x_source_systems).includes("BI");
  const rfiDaysRemaining = historicalDaysRemaining(record.x_rfi_response_due_at, now);
  const liveDatedRfi = rfi && rfiDaysRemaining !== false && rfiDaysRemaining >= 0;
  const recentUndatedRfi = rfi && rfiDaysRemaining === false && historicalRecentRfi(record, now);
  const expiredRfi = rfi && rfiDaysRemaining !== false && rfiDaysRemaining < 0;
  const decisionDaysRemaining = historicalDaysRemaining(record.x_decision_due_at, now);
  const postDecisionStage = /granted|commencement|construction|on site|completed/i.test(String(record.x_project_stage ?? ""));
  const stalePendingPlanningDecision = !rfi && decisionDaysRemaining !== false && decisionDaysRemaining < 0 && !postDecisionStage;
  if (buildingInfo && liveDatedRfi && verifiedEmailMatch) {
    return { rank: 1550, reason: "Live human-reviewed BuildingInfo acoustic RFI with a due date and verified consultant email relationship" };
  }
  if (buildingInfo && liveDatedRfi) return { rank: 1500, reason: "Live human-reviewed BuildingInfo acoustic RFI with a published response due date" };
  if (buildingInfo && recentUndatedRfi && verifiedEmailMatch) return { rank: 1450, reason: "Recent human-reviewed BuildingInfo acoustic RFI with verified consultant email history; response due date not supplied" };
  if (buildingInfo && recentUndatedRfi) return { rank: 1400, reason: "Recent human-reviewed BuildingInfo acoustic RFI; response due date not supplied" };
  if (liveDatedRfi && verifiedEmailMatch) return { rank: 1350, reason: "Live acoustic RFI with a due date and verified consultant email relationship" };
  if (liveDatedRfi) return { rank: 1300, reason: "Live acoustic RFI with a published response due date" };
  if (recentUndatedRfi && verifiedEmailMatch) return { rank: 1200, reason: "Recent acoustic RFI with verified consultant email history; response due date not supplied" };
  if (recentUndatedRfi) return { rank: 1100, reason: "Recent acoustic RFI; response due date not supplied" };
  if (expiredRfi) return verifiedEmailMatch
    ? { rank: 450, reason: "RFI response date has passed; retained with verified relationship for consultant review" }
    : { rank: 250, reason: "RFI response date has passed; retained as background until refreshed" };
  if (rfi && verifiedEmailMatch) return { rank: 1000, reason: "Acoustic RFI with verified consultant email history; RFI dates unavailable" };
  if (rfi) return { rank: 950, reason: "Acoustic RFI retained for review; RFI dates unavailable" };
  if (stalePendingPlanningDecision) return verifiedEmailMatch
    ? { rank: 350, reason: "Planning decision due date has passed with no confirmed outcome; refresh required before action" }
    : { rank: 150, reason: "Planning decision due date has passed with no confirmed outcome; retained as background" };
  if (verifiedEmailMatch) return { rank: 900, reason: "Qualified opportunity with a verified consultant email relationship" };
  if (quality === "excellent") return { rank: 800, reason: "Excellent opportunity without a verified email relationship" };
  if (record.x_acoustic_appointment_status === "competitor-appointed") {
    return { rank: 700, reason: "Competitive quotation opportunity requiring consultant review" };
  }
  if (quality === "good") return { rank: 600, reason: "Good opportunity" };
  if (quality === "medium") return { rank: 400, reason: "Medium opportunity for monitoring" };
  if (quality === "poor") return { rank: 200, reason: "Low-priority opportunity retained for background" };
  if (quality === "existing-project") return { rank: 100, reason: "Already won by iAcoustics; excluded from outreach ordering" };
  return { rank: 0, reason: "Closed or background record" };
}

async function normalizeHistoricalOdooRecords(
  config: ReturnType<typeof requiredConfig>,
  registry: TagRegistry,
  fetcher: typeof fetch,
) {
  if (!config.normalizeHistoricalRecords) return 0;
  const records = await json2Call(config, config.model, "search_read", {
    domain: [[config.externalIdField, "!=", false]],
    fields: [
      "id", "name", "priority", "tag_ids", config.externalIdField, "x_source_systems", "x_project_reference",
      "x_studio_reference", "x_warm_connection_verified", "x_assigned_person",
      "x_acoustic_appointment_status", "x_lead_quality", "x_pipeline_bucket",
      "x_pipeline_priority_rank", "x_pipeline_priority_reason", "x_classification",
      "x_rfi_received_at", "x_rfi_response_due_at", "x_decision_due_at",
      "x_source_major_updated_at", "x_first_seen_at", "x_project_stage",
    ],
    limit: 5_000,
  }, fetcher) as ExistingLeadValues[];
  let normalized = 0;
  const normalizationNow = new Date();
  for (const record of records) {
    if (!Number.isInteger(record.id)) continue;
    const codes = sourceCodesFromSystems(record.x_source_systems);
    const desiredTagIds: number[] = [];
    if (config.populateSourceTags) {
      for (const code of codes) {
        const tag = await tagRecordId(config, registry, code, config.createMissingSourceTags, fetcher);
        if (tag.id) desiredTagIds.push(tag.id);
      }
    }
    if (config.populateEmailMatchTags && record.x_warm_connection_verified === true) {
      const tag = await tagRecordId(
        config,
        registry,
        existingEmailMatchTag(record, registry),
        config.createMissingEmailMatchTags,
        fetcher,
      );
      if (tag.id) desiredTagIds.push(tag.id);
    }
    const appointmentTag = appointmentTagName(record.x_acoustic_appointment_status);
    if (config.populateSourceTags && appointmentTag) {
      const tag = await tagRecordId(config, registry, appointmentTag, config.createMissingSourceTags, fetcher);
      if (tag.id) desiredTagIds.push(tag.id);
    }
    const tagCommands = managedTagCommands(record.tag_ids ?? [], desiredTagIds, registry);
    const values: Record<string, unknown> = {};
    const name = sourcePrefixedName(record.name, codes);
    if (name && name !== record.name) values.name = name;
    if (codes.length > 0 && record.x_project_reference) {
      const reference = `${codes.join("+")}-${record.x_project_reference}`;
      if (reference !== record.x_studio_reference) values.x_studio_reference = reference;
    }
    const priority = historicalPipelinePriority(record, normalizationNow);
    if (record.x_pipeline_priority_rank !== priority.rank) values.x_pipeline_priority_rank = priority.rank;
    if (record.x_pipeline_priority_reason !== priority.reason) values.x_pipeline_priority_reason = priority.reason;
    const visualPriority = odooPriorityFromRank(priority.rank);
    if (record.priority !== visualPriority) values.priority = visualPriority;
    if (tagCommands.length > 0) values.tag_ids = tagCommands;
    if (Object.keys(values).length === 0) continue;
    await json2Call(config, config.model, "write", { ids: [record.id], vals: values }, fetcher);
    normalized += 1;
  }
  return normalized;
}

function mergedValues(left: unknown, right: unknown, separator: string) {
  const items = [left, right]
    .flatMap((value) => typeof value === "string" ? value.split(separator) : [])
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(items)].join(separator);
}

function existingEmailMatchTag(existing: ExistingLeadValues, registry?: TagRegistry) {
  const names = (existing.tag_ids ?? []).map((id) => registry?.byId.get(id) ?? "");
  if (names.some((name) => /multiple owners|glen \+ eoghan/i.test(name))) return "Email Match: Glen + Eoghan";
  if (names.some((name) => /glen/i.test(name))) return "Email Match: Glen";
  if (names.some((name) => /eoghan/i.test(name))) return "Email Match: Eoghan";
  if (names.some((name) => managedTagName(name) && /email match/i.test(name))) return "Email Match: Verified";
  if (existing.x_assigned_person === "Glen Plunkett") return "Email Match: Glen";
  if (existing.x_assigned_person === "Eoghan Tyrrell") return "Email Match: Eoghan";
  return "Email Match: Verified";
}

function payloadWithExistingEvidence(
  payload: OdooLeadDryRun,
  existing?: ExistingLeadValues,
  registry?: TagRegistry,
): OdooLeadDryRun {
  if (!existing) return payload;
  const sourceSystems = mergedValues(existing.x_source_systems, payload.values.x_source_systems, "; ");
  const preserveWhenMissing = (incoming: string, prior: unknown) => incoming || (typeof prior === "string" ? prior : "");
  const preserveVerifiedRelationship = existing.x_warm_connection_verified === true
    && payload.values.x_warm_connection_verified !== true;
  const preservedEmailMatchTag = existingEmailMatchTag(existing, registry);
  const appointmentPriority = (status: unknown) => status === "iacoustics-appointed" ? 3
    : status === "competitor-appointed" ? 2 : status === "needs-verification" ? 1 : 0;
  const preserveAppointment = appointmentPriority(existing.x_acoustic_appointment_status)
    > appointmentPriority(payload.values.x_acoustic_appointment_status);
  const preservedAppointmentStatus = preserveAppointment
    ? String(existing.x_acoustic_appointment_status)
    : payload.values.x_acoustic_appointment_status;
  const preservedStatusTag = appointmentTagName(preservedAppointmentStatus);
  return {
    ...payload,
    emailMatchTagName: preserveVerifiedRelationship ? preservedEmailMatchTag : payload.emailMatchTagName,
    statusTagNames: preservedStatusTag ? [preservedStatusTag] : [],
    attribution: {
      ...payload.attribution,
      sourceName: sourceSystems.includes(";") ? "Helmonic Tender Intelligence" : payload.attribution.sourceName,
    },
    values: {
      ...payload.values,
      partner_name: preserveWhenMissing(payload.values.partner_name, existing.partner_name),
      contact_name: preserveWhenMissing(payload.values.contact_name, existing.contact_name),
      email_from: preserveWhenMissing(payload.values.email_from, existing.email_from),
      phone: preserveWhenMissing(payload.values.phone, existing.phone),
      function: preserveWhenMissing(payload.values.function, existing.function),
      street: preserveWhenMissing(payload.values.street, existing.street),
      x_applicant: preserveWhenMissing(payload.values.x_applicant, existing.x_applicant),
      x_source_systems: sourceSystems,
      x_source_record_ids: mergedValues(existing.x_source_record_ids, payload.values.x_source_record_ids, "; "),
      x_project_link: preserveWhenMissing(payload.values.x_project_link, existing.x_project_link),
      x_source_urls: mergedValues(existing.x_source_urls, payload.values.x_source_urls, "\n"),
      x_evidence_document_urls: mergedValues(
        existing.x_evidence_document_urls,
        payload.values.x_evidence_document_urls,
        "\n",
      ),
      x_party_details: mergedValues(existing.x_party_details, payload.values.x_party_details, "\n"),
      x_assigned_person: preserveVerifiedRelationship
        ? preserveWhenMissing("", existing.x_assigned_person)
        : payload.values.x_assigned_person,
      x_warm_connection_verified: preserveVerifiedRelationship || payload.values.x_warm_connection_verified,
      x_routing_reason: preserveVerifiedRelationship
        ? preserveWhenMissing("", existing.x_routing_reason)
        : payload.values.x_routing_reason,
      x_acoustic_appointment_status: preservedAppointmentStatus,
      x_appointed_acoustician: preserveAppointment
        ? preserveWhenMissing("", existing.x_appointed_acoustician)
        : payload.values.x_appointed_acoustician,
      x_appointment_evidence: preserveAppointment
        ? preserveWhenMissing("", existing.x_appointment_evidence)
        : payload.values.x_appointment_evidence,
      x_appointment_evidence_source_url: preserveAppointment
        ? preserveWhenMissing("", existing.x_appointment_evidence_source_url)
        : payload.values.x_appointment_evidence_source_url,
      x_competitive_quote_opportunity: preserveAppointment
        ? existing.x_competitive_quote_opportunity === true
        : payload.values.x_competitive_quote_opportunity,
      x_outreach_eligibility: preserveAppointment
        ? preserveWhenMissing("", existing.x_outreach_eligibility)
        : payload.values.x_outreach_eligibility,
      x_outreach_suppression_reason: preserveAppointment
        ? preserveWhenMissing("", existing.x_outreach_suppression_reason)
        : payload.values.x_outreach_suppression_reason,
      x_outreach_key: preserveWhenMissing(payload.values.x_outreach_key, existing.x_outreach_key),
      x_lead_quality: preserveAppointment && preservedAppointmentStatus === "iacoustics-appointed"
        ? "existing-project"
        : payload.values.x_lead_quality,
      x_pipeline_bucket: preserveAppointment && preservedAppointmentStatus === "iacoustics-appointed"
        ? "already-won"
        : payload.values.x_pipeline_bucket,
    },
  };
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
      emailMatchTagsCreated: 0,
      emailMatchTagsLinked: 0,
      sourceTagsCreated: 0,
      sourceTagsLinked: 0,
      historicalRecordsNormalized: 0,
      failures: [],
    };
  }
  const config = requiredConfig(inputConfig);
  const odooFetch = rateLimitedFetcher(fetcher, config.requestIntervalMs);
  assertRoutingConfig(config, payloads);
  await assertSupportedVersion(config, odooFetch);
  const { fields } = await assertFieldsExist(config, payloads, odooFetch);
  const tagRegistry = await loadTagRegistry(config, odooFetch);

  const result: OdooSyncResult = {
    status: "completed",
    attempted: payloads.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    contactsCreated: 0,
    contactsMatched: 0,
    attributionRecordsCreated: 0,
    emailMatchTagsCreated: 0,
    emailMatchTagsLinked: 0,
    sourceTagsCreated: 0,
    sourceTagsLinked: 0,
    historicalRecordsNormalized: 0,
    failures: [],
  };
  for (const payload of payloads) {
    try {
      const matches = await json2Call(config, config.model, "search_read", {
        domain: [[config.externalIdField, "=", payload.matchValue]],
        fields: [
          "id",
          "tag_ids",
          "partner_name",
          "contact_name",
          "email_from",
          "phone",
          "function",
          "street",
          "x_applicant",
          "x_party_details",
          "x_source_systems",
          "x_source_record_ids",
          "x_project_link",
          "x_source_urls",
          "x_evidence_document_urls",
          "x_assigned_person",
          "x_warm_connection_verified",
          "x_routing_reason",
          "x_acoustic_appointment_status",
          "x_appointed_acoustician",
          "x_appointment_evidence",
          "x_appointment_evidence_source_url",
          "x_competitive_quote_opportunity",
          "x_outreach_eligibility",
          "x_outreach_suppression_reason",
          "x_outreach_key",
        ],
        limit: 2,
      }, odooFetch) as ExistingLeadValues[];
      if (!Array.isArray(matches)) throw new Error("Odoo search_read returned an invalid response.");
      if (matches.length > 1) throw new Error("More than one Odoo lead has the same Helmonic external ID.");
      const effectivePayload = payloadWithExistingEvidence(payload, matches[0], tagRegistry);
      const attribution = await attributionValues(effectivePayload, config, odooFetch);
      const sourceTags = await sourceTagValues(effectivePayload, config, tagRegistry, odooFetch);
      const emailMatchTag = await emailMatchTagValues(effectivePayload, config, tagRegistry, odooFetch);
      const contact = await primaryContactId(effectivePayload, config, odooFetch);
      const tagCommands = managedTagCommands(
        matches[0]?.tag_ids ?? [],
        [...sourceTags.ids, ...emailMatchTag.ids],
        tagRegistry,
      );
      const linkedValues: Record<string, unknown> = {
        ...attribution.values,
        ...(tagCommands.length ? { tag_ids: tagCommands } : {}),
      };
      if (contact.id) linkedValues.partner_id = contact.id;
      const values = valuesForOdoo(effectivePayload, config, fields, linkedValues);
      result.attributionRecordsCreated += attribution.created;
      result.emailMatchTagsCreated += emailMatchTag.created;
      result.emailMatchTagsLinked += emailMatchTag.linked;
      result.sourceTagsCreated += sourceTags.created;
      result.sourceTagsLinked += sourceTags.linked;
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
    const details = result.failures
      .map((failure) => `${failure.externalId}: ${failure.error}`)
      .join("; ");
    throw new Error(`Odoo synchronization completed with ${result.failures.length} failed record(s): ${details}`);
  }
  result.historicalRecordsNormalized = await normalizeHistoricalOdooRecords(
    config,
    tagRegistry,
    odooFetch,
  );
  return result;
}
