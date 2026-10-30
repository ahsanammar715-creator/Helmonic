import type { OdooLeadDryRun } from "./odoo-payload.ts";
import { ODOO_TENDER_FIELD_TYPES } from "./odoo-field-contract.ts";
import { acousticCpvCodes, relevantTenderText } from "./policy.ts";
import { genericPlanningPortalUrl, nationalPlanningProjectUrl } from "./project-links.ts";

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
  migrateManagedRecordsToLeads?: boolean;
  archiveUnmanagedTestFixtures?: boolean;
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
  managedRecordsMovedToLeads: number;
  managedLeadsArchived: number;
  managedLeadsReactivated: number;
  managedRfisArchived: number;
  managedRfisReactivated: number;
  unmanagedTestFixturesArchived: number;
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
    migrateManagedRecordsToLeads: config.migrateManagedRecordsToLeads === true,
    archiveUnmanagedTestFixtures: config.archiveUnmanagedTestFixtures === true,
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
  active: "boolean",
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
  // Odoo owns this field and generates the A/L/Q/J workflow reference.
  // Helmonic only reads it to remove source IDs written by older releases.
  x_studio_reference: "char",
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
  // Reserve Odoo's three-star treatment for live and recent undated RFIs.
  // Expired RFIs retain their date-led queue position but are visually
  // demoted to two stars so they cannot be mistaken for current deadlines.
  if (rank >= 500_000_000) return "3";
  if (rank >= 1_000_000) return "2";
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
  existing?: ExistingLeadValues,
) {
  const values: Record<string, unknown> = {
    ...payload.values,
    x_studio_project_sector: selectionValue(fields.x_studio_project_sector, payload.values.x_studio_project_sector),
    [config.externalIdField]: payload.matchValue,
    ...linkedValues,
  };
  if (config.externalIdField !== "x_helmonic_external_id") delete values.x_helmonic_external_id;
  if (!existing?.id) {
    // Creation is the only point where automation may initialise Odoo-owned
    // workflow fields. Later refreshes enrich intelligence without undoing a
    // consultant's ownership, priority, team or stage decisions.
    values.type = "lead";
    values.team_id = config.salesTeamId;
    values.user_id = ownerUserId(payload, config);
    values.priority = odooPriority(payload);
    if (config.initialStageId) values.stage_id = config.initialStageId;
    return values;
  }

  // The project name and standard closing date are human-controlled after
  // creation. Source deadlines continue to refresh in the dedicated RFI and
  // planning date fields used by the automated ordering.
  delete values.name;
  delete values.date_deadline;

  // Older Helmonic releases put vendor/council references in Odoo's Lead
  // Reference field. Move that legacy value out of the way during an ordinary
  // refresh, but only when it is exactly the source/project reference. Proper
  // A/L/Q/J values and every other human-entered reference remain untouched.
  if (legacySourceReferenceInLeadReference(
    existing,
    payload.values.x_source_reference,
    payload.values.x_project_reference,
  )) {
    values.x_studio_reference = false;
  }

  // Never replace an established linked contact. Native text contact fields
  // are protected separately by payloadWithExistingEvidence and are only
  // populated when blank.
  if (existing.partner_id) delete values.partner_id;

  // A controlled, explicitly enabled migration may move a managed record back
  // to the separate Leads queue. Ordinary recurring syncs never change type.
  if (config.migrateManagedRecordsToLeads && existing.type === "opportunity") {
    values.type = "lead";
  }
  return values;
}

type ExistingLeadValues = {
  id?: number;
  active?: boolean;
  type?: "lead" | "opportunity" | false;
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
  x_source_ledger?: string | false;
  x_project_reference?: string | false;
  x_studio_reference?: string | false;
  x_source_reference?: string | false;
  x_helmonic_external_id?: string | false;
  x_source_record_ids?: string | false;
  x_source_urls?: string | false;
  x_project_link?: string | false;
  x_evidence_document_urls?: string | false;
  x_assigned_person?: string | false;
  user_id?: [number, string] | number | false;
  partner_id?: [number, string] | number | false;
  x_warm_connection_verified?: boolean;
  x_lead_quality?: string | false;
  x_lead_panel?: string | false;
  x_pipeline_bucket?: string | false;
  x_pipeline_priority_rank?: number;
  x_pipeline_priority_reason?: string | false;
  x_classification?: string | false;
  x_evidence_status?: string | false;
  x_evidence_excerpt?: string | false;
  x_matched_terms?: string | false;
  x_cpv_codes?: string | false;
  x_opportunity_type?: string | false;
  x_rfi_published_at?: string | false;
  x_rfi_received_at?: string | false;
  x_rfi_response_due_at?: string | false;
  x_rfi_response_received_at?: string | false;
  x_deadline?: string | false;
  x_planning_received_at?: string | false;
  x_planning_validated_at?: string | false;
  x_decision_due_at?: string | false;
  x_source_major_updated_at?: string | false;
  x_first_seen_at?: string | false;
  x_last_seen_at?: string | false;
  x_project_stage?: string | false;
  x_project_value?: number | false;
  x_residential_scale?: string | false;
  x_routing_reason?: string | false;
  x_relationship_summary?: string | false;
  x_relationship_evidence?: string | false;
  x_project_history_summary?: string | false;
  x_project_history_evidence?: string | false;
  x_acoustic_appointment_status?: string | false;
  x_appointed_acoustician?: string | false;
  x_appointment_evidence?: string | false;
  x_appointment_evidence_source_url?: string | false;
  x_competitive_quote_opportunity?: boolean;
  x_outreach_eligibility?: string | false;
  x_outreach_suppression_reason?: string | false;
  x_outreach_key?: string | false;
};

export function legacySourceReferenceInLeadReference(
  existing: ExistingLeadValues | undefined,
  sourceReference: unknown,
  projectReference: unknown,
) {
  const leadReference = String(existing?.x_studio_reference ?? "").trim();
  if (!leadReference) return false;

  // Never touch Odoo's proper workflow references. Charlotte/Odoo owns these
  // values and they must survive every Helmonic refresh.
  if (/^(?:A|L|Q|J)-\d+$/i.test(leadReference)) return false;

  const sourceValues = [sourceReference, projectReference, existing?.x_source_reference]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return sourceValues.includes(leadReference);
}

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

function projectNameWithoutSourcePrefix(name: unknown) {
  const current = typeof name === "string" ? name.trim() : "";
  return current.replace(/^\[(?:BI|PL|NPR|DCC|TD|EU)(?:\+(?:BI|PL|NPR|DCC|TD|EU))*\]\s*/i, "");
}

function isLegacyJobNumberOnly(name: unknown) {
  return /^J[-\s]?\d+$/i.test(projectNameWithoutSourcePrefix(name));
}

function historicalProjectName(
  record: ExistingLeadValues,
  canonicalNamesByExternalId: ReadonlyMap<string, string>,
) {
  const current = projectNameWithoutSourcePrefix(record.name);
  if (current && !isLegacyJobNumberOnly(current)) return current;
  const externalId = typeof record.x_helmonic_external_id === "string" ? record.x_helmonic_external_id : "";
  const canonical = projectNameWithoutSourcePrefix(canonicalNamesByExternalId.get(externalId));
  if (canonical && !isLegacyJobNumberOnly(canonical)) return canonical;
  const location = typeof record.street === "string" ? record.street.trim() : "";
  if (location) return location;
  const applicant = typeof record.x_applicant === "string" ? record.x_applicant.trim() : "";
  const reference = typeof record.x_project_reference === "string" ? record.x_project_reference.trim() : "";
  if (applicant && reference) return `${applicant} — ${reference}`;
  if (applicant) return applicant;
  return reference ? `Planning project ${reference}` : current;
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
  return [record.x_rfi_received_at, record.x_rfi_published_at, record.x_source_major_updated_at, record.x_first_seen_at]
    .map((value) => historicalDaysRemaining(value, now))
    .some((age) => age !== false && age <= 0 && age >= -42);
}

const HISTORICAL_GRANTED_CONDITION_ACTIVE_DAYS = 30;

function historicalExpiredGrantedCondition(record: ExistingLeadValues, now: Date) {
  if (record.x_classification !== "granted-with-noise-conditions") return false;
  const decisionDaysRemaining = historicalDaysRemaining(record.x_decision_due_at, now);
  return decisionDaysRemaining !== false
    && decisionDaysRemaining < -HISTORICAL_GRANTED_CONDITION_ACTIVE_DAYS;
}

function historicalClosedLeadStage(value: unknown) {
  return /refus(?:e|ed|al)|withdrawn|invalid(?:ated)?|cancelled|completed|awarded/i.test(String(value ?? ""));
}

function historicalUrlCandidates(value: unknown) {
  return String(value ?? "")
    .split(/[\r\n;]+/)
    .map((candidate) => candidate.trim().replace(/^http:/i, "https:"))
    .filter((candidate) => /^https:\/\//i.test(candidate) && !genericPlanningPortalUrl(candidate));
}

function historicalProjectLink(record: ExistingLeadValues) {
  const existing = typeof record.x_project_link === "string"
    ? record.x_project_link.trim().replace(/^http:/i, "https:")
    : "";
  if (/^https:\/\//i.test(existing) && !genericPlanningPortalUrl(existing)) return existing;

  const reference = String(record.x_project_reference ?? "").trim();
  const supplied = historicalUrlCandidates(record.x_source_urls);
  const referenceMatch = reference
    ? supplied.find((candidate) => candidate.toLowerCase().includes(reference.toLowerCase()))
    : undefined;
  if (referenceMatch) return referenceMatch;
  if (supplied[0]) return supplied[0];
  if (!reference) return "";

  const systems = String(record.x_source_systems ?? "").toLowerCase();
  if (systems.includes("dcc")) {
    const query = new URLSearchParams({ FileSystemId: "PL", Folder1_Ref: reference });
    return `https://webapps.dublincity.ie/PublicAccess_Live/SearchResult/RunThirdPartySearch?${query}`;
  }
  if (/(?:national planning register|planningleads|planning)/i.test(systems)) {
    return nationalPlanningProjectUrl("", reference);
  }
  return "";
}

function historicalActiveLeadQueueStatus(record: ExistingLeadValues, now: Date): boolean | undefined {
  if (record.x_acoustic_appointment_status === "iacoustics-appointed"
    || record.x_lead_quality === "existing-project"
    || record.x_pipeline_bucket === "already-won") return false;

  // The historical classification was produced by the acoustic-condition
  // classifier even when older records did not persist the full evidence
  // excerpt/term bundle. Expired grants leave the active queue; undated grants
  // remain visible only in the date-validation panel.
  if (record.x_classification === "granted-with-noise-conditions") {
    if (historicalExpiredGrantedCondition(record, now)) return false;
    // Keep undated grants available for validation, but their panel and rank
    // below ensure that they cannot lead the primary queue.
    return true;
  }

  if (record.x_classification === "noise-related-rfi") {
    if (record.x_rfi_response_received_at) return false;
    const daysRemaining = historicalDaysRemaining(record.x_rfi_response_due_at, now);
    if (daysRemaining !== false) return daysRemaining >= 0;
    return historicalRecentRfi(record, now);
  }

  if (historicalClosedLeadStage(record.x_project_stage)) return false;

  if (record.x_opportunity_type === "formal-public-tender") {
    const daysRemaining = historicalDaysRemaining(record.x_deadline, now);
    return daysRemaining === false || daysRemaining >= 0;
  }

  if (record.x_opportunity_type === "planning-pipeline-lead") {
    const daysRemaining = historicalDaysRemaining(record.x_decision_due_at, now);
    return daysRemaining === false || daysRemaining >= 0;
  }

  return true;
}

function historicalCommercialRfiTieBreaker(buildingInfo: boolean, verifiedEmailMatch: boolean) {
  return buildingInfo && verifiedEmailMatch ? 30
    : verifiedEmailMatch ? 20
      : buildingInfo ? 10 : 0;
}

function historicalRfiActivityFreshness(record: ExistingLeadValues, now: Date) {
  return [record.x_rfi_received_at, record.x_rfi_published_at, record.x_source_major_updated_at, record.x_first_seen_at]
    .map((value) => historicalDaysRemaining(value, now))
    .filter((days): days is number => days !== false && days <= 0)
    .map((days) => 900 - Math.min(Math.abs(days), 900))
    .reduce((freshest, score) => Math.max(freshest, score), 0);
}

function historicalGrantedConditionsActivityAge(record: ExistingLeadValues, now: Date) {
  const ages = [record.x_source_major_updated_at, record.x_last_seen_at, record.x_first_seen_at]
    .map((value) => historicalDaysRemaining(value, now))
    .filter((days): days is number => days !== false && days <= 0)
    .map((days) => Math.abs(days));
  return ages.length ? Math.min(...ages) : false;
}

function historicalLiveRfiPriority(
  daysRemaining: number,
  activityFreshness: number,
  buildingInfo: boolean,
  verifiedEmailMatch: boolean,
) {
  const dueDateRank = 2_100_000_000 - Math.min(daysRemaining, 5_000) * 100_000;
  return dueDateRank
    + historicalCommercialRfiTieBreaker(buildingInfo, verifiedEmailMatch) * 2_500
    + activityFreshness * 20;
}

function historicalRecentUndatedRfiPriority(
  activityFreshness: number,
  buildingInfo: boolean,
  verifiedEmailMatch: boolean,
) {
  return 1_500_000_000
    + activityFreshness * 100
    + historicalCommercialRfiTieBreaker(buildingInfo, verifiedEmailMatch);
}

function historicalExpiredRfiPriority(daysPastDue: number, buildingInfo: boolean, verifiedEmailMatch: boolean) {
  return -100_000_000 - Math.min(daysPastDue, 9_000) * 100
    + historicalCommercialRfiTieBreaker(buildingInfo, verifiedEmailMatch);
}

function historicalSecondaryPlanningDecisionPriority(
  daysRemaining: number,
  buildingInfo: boolean,
  retainedRelationship: boolean,
) {
  return 20_000
    + (5_000 - Math.min(daysRemaining, 5_000)) * 10
    + historicalCommercialRfiTieBreaker(buildingInfo, retainedRelationship);
}

function historicalGrantedAcousticConditionsPriority(
  daysSinceActivity: number,
  buildingInfo: boolean,
  retainedRelationship: boolean,
) {
  return 1_200_000_000
    + historicalCommercialRfiTieBreaker(buildingInfo, retainedRelationship) * 2_500
    + (120 - Math.min(daysSinceActivity, 120)) * 1_000;
}

function historicalPostDecisionStage(value: unknown) {
  const stage = String(value ?? "");
  if (/request(?:ed)?\s+(?:for\s+)?additional information|additional information requested|further information requested/i.test(stage)) {
    return false;
  }
  return /grant(?:ed)?|conditional|refus(?:e|ed|al)|withdrawn|invalid(?:ated)?|commencement|construction|on site|completed/i.test(stage);
}

function historicalLiveRfiPriorityReason(
  daysRemaining: number,
  hasActivityDate: boolean,
  buildingInfo: boolean,
  verifiedEmailMatch: boolean,
) {
  const due = daysRemaining === 0 ? "due today" : `due in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`;
  const chronology = hasActivityDate
    ? "; RFI received/published date is the secondary ordering key"
    : "; RFI received/published date unavailable";
  const source = buildingInfo ? "; human-reviewed BuildingInfo source" : "";
  const relationship = verifiedEmailMatch ? "; verified acoustic consultant email relationship" : "";
  return `Active acoustic RFI ${due}; response deadline takes precedence${chronology}${source}${relationship}`;
}

function historicalConfirmedAcousticEvidence(record: ExistingLeadValues) {
  if (record.x_evidence_status !== "official-text") return false;
  if (["needs-council-evidence", "no-relevant-opportunity"].includes(String(record.x_classification ?? ""))) return false;
  const excerpt = typeof record.x_evidence_excerpt === "string" ? record.x_evidence_excerpt.trim() : "";
  const terms = typeof record.x_matched_terms === "string" ? record.x_matched_terms.trim() : "";
  if (!excerpt || !terms || !relevantTenderText(excerpt)) return false;
  if (record.x_opportunity_type === "formal-public-tender") {
    const cpvCodes = String(record.x_cpv_codes ?? "").split(/[;,\s]+/).filter(Boolean);
    return cpvCodes.some((code) => acousticCpvCodes.includes(code as never));
  }
  return Boolean(record.x_classification);
}

function historicalLeadReviewPanel(record: ExistingLeadValues, now: Date) {
  const quality = String(record.x_lead_quality ?? "");
  const bucket = String(record.x_pipeline_bucket ?? "");
  if (record.x_acoustic_appointment_status === "iacoustics-appointed"
    || quality === "existing-project"
    || bucket === "already-won") {
    return "Existing Relationship / Do Not Cold Contact";
  }
  const routeable = !["poor", "closed-background", "existing-project"].includes(quality)
    && !["background", "already-won"].includes(bucket);
  const confirmedAcoustic = historicalConfirmedAcousticEvidence(record);
  if (record.x_classification === "noise-related-rfi" && routeable && confirmedAcoustic) {
    if (record.x_rfi_response_received_at) return "Competitive / Re-engagement";
    const daysRemaining = historicalDaysRemaining(record.x_rfi_response_due_at, now);
    if (daysRemaining !== false && daysRemaining < 0) return "Competitive / Re-engagement";
    return "Urgent Acoustic RFI";
  }
  if (record.x_classification === "granted-with-noise-conditions"
    && routeable
    && confirmedAcoustic) {
    if (!record.x_decision_due_at) return "Needs Date Validation";
    if (historicalExpiredGrantedCondition(record, now)) return "Granted / Follow-up";
    return "Granted with Acoustic Conditions";
  }
  if (routeable && historicalPostDecisionStage(record.x_project_stage)) return "Competitive / Re-engagement";
  if (record.x_acoustic_appointment_status === "competitor-appointed") return "Competitive / Re-engagement";
  if (confirmedAcoustic) return "Confirmed Acoustic Opportunity";
  if (routeable) return "Potential Acoustic Fit";
  return "General Potential / Background";
}

function historicalPipelinePriority(record: ExistingLeadValues, now: Date) {
  const quality = typeof record.x_lead_quality === "string" ? record.x_lead_quality : "";
  const bucket = typeof record.x_pipeline_bucket === "string" ? record.x_pipeline_bucket : "";
  const routeable = !["poor", "closed-background", "existing-project"].includes(quality)
    && !["background", "already-won"].includes(bucket);
  const confirmedAcoustic = historicalConfirmedAcousticEvidence(record);
  const retainedRelationship = record.x_warm_connection_verified === true;
  const verifiedEmailMatch = retainedRelationship && routeable && confirmedAcoustic;
  const rfi = record.x_classification === "noise-related-rfi" && routeable && confirmedAcoustic;
  const grantedAcousticConditions = record.x_classification === "granted-with-noise-conditions"
    && routeable
    && confirmedAcoustic;
  const buildingInfo = sourceCodesFromSystems(record.x_source_systems).includes("BI");
  const rfiDaysRemaining = historicalDaysRemaining(record.x_rfi_response_due_at, now);
  const activityFreshness = historicalRfiActivityFreshness(record, now);
  const grantedConditionsAge = historicalGrantedConditionsActivityAge(record, now);
  const liveDatedRfi = rfi && rfiDaysRemaining !== false && rfiDaysRemaining >= 0;
  const recentUndatedRfi = rfi && rfiDaysRemaining === false && historicalRecentRfi(record, now);
  const expiredRfi = rfi && rfiDaysRemaining !== false && rfiDaysRemaining < 0;
  const fulfilledRfi = rfi && Boolean(record.x_rfi_response_received_at);
  const decisionDaysRemaining = historicalDaysRemaining(record.x_decision_due_at, now);
  const postDecisionStage = historicalPostDecisionStage(record.x_project_stage);
  const livePlanningDecision = !rfi
    && routeable
    && decisionDaysRemaining !== false
    && decisionDaysRemaining >= 0
    && !postDecisionStage;
  const stalePendingPlanningDecision = !rfi && decisionDaysRemaining !== false && decisionDaysRemaining < 0 && !postDecisionStage;
  const expiredGrant = grantedAcousticConditions && historicalExpiredGrantedCondition(record, now);
  const grantNeedsDateValidation = grantedAcousticConditions && !record.x_decision_due_at;
  if (liveDatedRfi && !fulfilledRfi) return {
    rank: historicalLiveRfiPriority(rfiDaysRemaining, activityFreshness, buildingInfo, verifiedEmailMatch),
    reason: historicalLiveRfiPriorityReason(rfiDaysRemaining, activityFreshness > 0, buildingInfo, verifiedEmailMatch),
  };
  if (recentUndatedRfi && !fulfilledRfi) return {
    rank: historicalRecentUndatedRfiPriority(activityFreshness, buildingInfo, verifiedEmailMatch),
    reason: `Recent confirmed acoustic RFI ordered by received/published date; response due date not supplied${buildingInfo ? "; human-reviewed BuildingInfo source" : ""}${verifiedEmailMatch ? "; verified acoustic consultant email relationship" : ""}`,
  };
  if (fulfilledRfi) return {
    rank: -200_000_000 + historicalCommercialRfiTieBreaker(buildingInfo, verifiedEmailMatch),
    reason: `Further-information response was received ${record.x_rfi_response_received_at}; archived from active Leads and retained for audit, relationship history and competitive follow-up, never treated as an open RFI${buildingInfo ? "; human-reviewed BuildingInfo provenance retained" : ""}`,
  };
  if (expiredRfi) {
    const daysPastDue = Math.abs(rfiDaysRemaining);
    return {
      rank: historicalExpiredRfiPriority(daysPastDue, buildingInfo, verifiedEmailMatch),
      reason: `RFI response date passed ${daysPastDue} day${daysPastDue === 1 ? "" : "s"} ago; archived from active Leads and retained for audit, deduplication and consultant-reviewed competitive follow-up${verifiedEmailMatch ? "; verified relationship retained for context" : ""}`,
    };
  }
  if (expiredGrant) return {
    rank: 90 + historicalCommercialRfiTieBreaker(buildingInfo, retainedRelationship),
    reason: `Acoustic-condition grant is more than ${HISTORICAL_GRANTED_CONDITION_ACTIVE_DAYS} days past its decision date; retained as a low-priority granted follow-up below live RFIs and current applications`,
  };
  if (grantNeedsDateValidation) return {
    rank: 160 + historicalCommercialRfiTieBreaker(buildingInfo, retainedRelationship),
    reason: "Permission grant has confirmed acoustic/noise evidence but no planning decision date; retained for date validation and excluded from the primary target ordering",
  };
  if (grantedAcousticConditions) return {
    rank: historicalGrantedAcousticConditionsPriority(grantedConditionsAge === false ? 120 : grantedConditionsAge, buildingInfo, retainedRelationship),
    reason: `Permission granted with confirmed acoustic/noise conditions; second primary category after current Further Information Requests; newest grant evidence first${buildingInfo ? "; human-reviewed BuildingInfo source" : ""}${retainedRelationship ? "; verified historical relationship" : ""}`,
  };
  if (postDecisionStage) return {
    rank: 100 + historicalCommercialRfiTieBreaker(buildingInfo, retainedRelationship),
    reason: "Planning outcome is already conditional, granted, refused or otherwise decided; retained for later competitive follow-up and demoted below live work",
  };
  if (stalePendingPlanningDecision) return retainedRelationship
    ? { rank: 180, reason: "Planning decision due date has passed with no confirmed outcome; refresh required before action. Historical relationship retained for context" }
    : { rank: 120, reason: "Planning decision due date has passed with no confirmed outcome; retained below live work until refreshed" };
  if (livePlanningDecision) return {
    rank: historicalSecondaryPlanningDecisionPriority(decisionDaysRemaining, buildingInfo, retainedRelationship),
    reason: `Secondary planning monitor: decision due in ${decisionDaysRemaining} day${decisionDaysRemaining === 1 ? "" : "s"}; current-project acoustic evidence is not one of the two primary targets${buildingInfo ? "; human-reviewed BuildingInfo source retained" : ""}${retainedRelationship ? "; verified historical relationship retained" : ""}`,
  };
  if (buildingInfo && routeable) {
    const partE = !confirmedAcoustic
      && ["attached-4-plus", "lrd-100-plus"].includes(String(record.x_residential_scale ?? ""));
    const commercialRank = !confirmedAcoustic
      ? partE ? 500 : retainedRelationship ? 320 : 220
      : verifiedEmailMatch ? 900
        : record.x_acoustic_appointment_status === "competitor-appointed" ? 700
          : quality === "excellent" ? 800
            : quality === "good" ? 600
              : quality === "medium" ? 400 : 200;
    return {
      rank: 10_000 + commercialRank,
      reason: `Secondary BuildingInfo review; ${confirmedAcoustic ? "current acoustic evidence confirmed but it is not a live RFI or granted acoustic condition" : "retained as a potential acoustic fit pending authoritative confirmation"}`,
    };
  }
  if (rfi && verifiedEmailMatch) return { rank: 1000, reason: "Acoustic RFI with verified consultant email history; RFI dates unavailable" };
  if (rfi) return { rank: 950, reason: "Acoustic RFI retained for review; RFI dates unavailable" };
  if (!confirmedAcoustic && routeable
    && ["attached-4-plus", "lrd-100-plus"].includes(String(record.x_residential_scale ?? ""))) {
    return {
      rank: 500,
      reason: "Part E commercial review: attached residential scheme of at least four units; potential acoustic work expected, ordered by project value within the Potential Acoustic Fit panel",
    };
  }
  if (!confirmedAcoustic) {
    return retainedRelationship
      ? { rank: 320, reason: "Potential acoustic fit only; current-project acoustic evidence is unconfirmed. Verified historical relationship retained for context, not opportunity proof" }
      : { rank: 220, reason: "Potential acoustic fit only; current-project acoustic evidence is unconfirmed" };
  }
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
  canonicalNamesByExternalId: ReadonlyMap<string, string>,
  fetcher: typeof fetch,
) {
  if (!config.normalizeHistoricalRecords) {
    return {
      normalized: 0,
      movedToLeads: 0,
      archivedLeads: 0,
      reactivatedLeads: 0,
      archivedRfis: 0,
      reactivatedRfis: 0,
    };
  }
  const records = await json2Call(config, config.model, "search_read", {
    domain: [[config.externalIdField, "!=", false]],
    fields: [
      "id", "active", "type", "name", "priority", "tag_ids", "street", "x_applicant", config.externalIdField, "x_source_systems", "x_project_reference",
      // x_studio_reference is read only to recognise legacy source values.
      // It is Odoo's sequential A-number and is never written by Helmonic.
      "x_studio_reference", "x_source_reference", "x_source_urls", "x_project_link", "x_warm_connection_verified", "x_assigned_person",
      "user_id", "x_routing_reason",
      "x_acoustic_appointment_status", "x_lead_quality", "x_pipeline_bucket",
      "x_lead_panel", "x_pipeline_priority_rank", "x_pipeline_priority_reason", "x_classification",
      "x_evidence_status", "x_evidence_excerpt", "x_matched_terms", "x_cpv_codes", "x_opportunity_type",
      "x_deadline", "x_rfi_published_at", "x_rfi_received_at", "x_rfi_response_due_at", "x_rfi_response_received_at",
      "x_planning_received_at", "x_planning_validated_at", "x_decision_due_at",
      "x_source_major_updated_at", "x_first_seen_at", "x_last_seen_at", "x_project_stage", "x_project_value", "x_residential_scale",
    ],
    limit: 5_000,
    context: { active_test: false },
  }, fetcher) as ExistingLeadValues[];
  let normalized = 0;
  let movedToLeads = 0;
  let archivedLeads = 0;
  let reactivatedLeads = 0;
  let archivedRfis = 0;
  let reactivatedRfis = 0;
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
    if (config.migrateManagedRecordsToLeads && record.type === "opportunity") {
      // The controlled Tender Desk migration must also cover managed records
      // that are not present in today's discovery payload (for example an
      // earlier BuildingInfo test). Manual Odoo records have no Helmonic
      // external ID and are excluded by the search domain above.
      values.type = "lead";
      movedToLeads += 1;
    }
    const name = historicalProjectName(record, canonicalNamesByExternalId);
    if (name && name !== record.name) values.name = name;
    if (codes.length > 0 && record.x_project_reference) {
      const reference = `${codes.join("+")}-${record.x_project_reference}`;
      if (reference !== record.x_source_reference) values.x_source_reference = reference;
      if (legacySourceReferenceInLeadReference(record, reference, record.x_project_reference)) {
        values.x_studio_reference = false;
      }
    }
    const resolvedProjectLink = historicalProjectLink(record);
    if (resolvedProjectLink && resolvedProjectLink !== record.x_project_link) {
      values.x_project_link = resolvedProjectLink;
    }
    const normalizedRecord = resolvedProjectLink
      ? { ...record, x_project_link: resolvedProjectLink }
      : record;
    const priority = historicalPipelinePriority(normalizedRecord, normalizationNow);
    const activeLeadStatus = historicalActiveLeadQueueStatus(normalizedRecord, normalizationNow);
    if (activeLeadStatus !== undefined && record.active !== activeLeadStatus) {
      values.active = activeLeadStatus;
      if (activeLeadStatus) reactivatedLeads += 1;
      else archivedLeads += 1;
      if (record.x_classification === "noise-related-rfi") {
        if (activeLeadStatus) reactivatedRfis += 1;
        else archivedRfis += 1;
      }
    }
    const confirmedAcoustic = historicalConfirmedAcousticEvidence(record);
    const nativeOwnerId = Array.isArray(record.user_id)
      ? Number(record.user_id[0])
      : Number(record.user_id || 0);
    const staleAutomatedAssignment = !confirmedAcoustic && (
      ["Glen Plunkett", "Eoghan Tyrrell"].includes(String(record.x_assigned_person ?? ""))
      || nativeOwnerId === config.glenUserId
      || nativeOwnerId === config.eoghanUserId
    );
    if (record.x_pipeline_priority_rank !== priority.rank) values.x_pipeline_priority_rank = priority.rank;
    if (record.x_pipeline_priority_reason !== priority.reason) values.x_pipeline_priority_reason = priority.reason;
    const reviewPanel = historicalLeadReviewPanel(record, normalizationNow);
    if (record.x_lead_panel !== reviewPanel) values.x_lead_panel = reviewPanel;
    if (!confirmedAcoustic
      && !["poor", "closed-background", "existing-project", "potential"].includes(String(record.x_lead_quality ?? ""))
      && !["background", "already-won"].includes(String(record.x_pipeline_bucket ?? ""))) {
      values.x_lead_quality = "potential";
    }
    const visualPriority = odooPriorityFromRank(priority.rank);
    if (record.priority !== visualPriority) values.priority = visualPriority;
    if (staleAutomatedAssignment) {
      // Retain the verified relationship/tag/contact evidence, but remove the
      // operational assignment created by older releases. A historical email
      // match alone must never put a non-acoustic project on a consultant's list.
      values.x_assigned_person = "";
      values.user_id = false;
      const priorRoute = String(record.x_routing_reason ?? "").trim();
      values.x_routing_reason = [
        "Verified historical email relationship retained for context; not assigned because current-project acoustic evidence is unconfirmed",
        priorRoute ? `Prior route: ${priorRoute}` : "",
      ].filter(Boolean).join(". ");
    }
    if (tagCommands.length > 0) values.tag_ids = tagCommands;
    if (Object.keys(values).length === 0) continue;
    await json2Call(config, config.model, "write", { ids: [record.id], vals: values }, fetcher);
    normalized += 1;
  }
  return {
    normalized,
    movedToLeads,
    archivedLeads,
    reactivatedLeads,
    archivedRfis,
    reactivatedRfis,
  };
}

const UNMANAGED_TEST_FIXTURE_NAMES = [
  "New Residential Project, Dublin 12",
  "New Hotel Project, Dublin 2",
  "Noise testing",
  "Tender 123",
  "RFI Lead 1",
  "RFI Lead 2",
  "ABC building project",
] as const;

async function archiveUnmanagedTestFixtures(
  config: ReturnType<typeof requiredConfig>,
  fetcher: typeof fetch,
) {
  if (!config.archiveUnmanagedTestFixtures) return 0;
  const fixtures = await json2Call(config, config.model, "search_read", {
    domain: [
      [config.externalIdField, "=", false],
      ["type", "=", "lead"],
      ["active", "=", true],
      ["name", "in", [...UNMANAGED_TEST_FIXTURE_NAMES]],
    ],
    fields: ["id", "name"],
    limit: 100,
  }, fetcher) as Array<{ id?: number; name?: string }>;
  const ids = fixtures.map((record) => record.id).filter((id): id is number => Number.isInteger(id));
  if (ids.length === 0) return 0;
  await json2Call(config, config.model, "write", { ids, vals: { active: false } }, fetcher);
  return ids.length;
}

function mergedValues(left: unknown, right: unknown, separator: string) {
  const items = [left, right]
    .flatMap((value) => typeof value === "string" ? value.split(separator) : [])
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(items)].join(separator);
}

function mergedProjectUrls(left: unknown, right: unknown) {
  return mergedValues(left, right, "\n")
    .split("\n")
    .map((value) => value.trim().replace(/^http:/i, "https:"))
    .filter((value) => value && !genericPlanningPortalUrl(value))
    .filter((value, index, all) => all.indexOf(value) === index)
    .join("\n");
}

function conciseLegacyRelationshipSummary(value: unknown) {
  const source = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!source) return "";
  const legacyEvidence = /Matched project party:|Evidence source:|Source message URI:|Evidence reference\(s\):/i.test(source);
  if (!legacyEvidence && source.length <= 1_600) return source;

  const captured = (pattern: RegExp, maximum = 5) => {
    const values = [...source.matchAll(pattern)]
      .map((match) => String(match[1] ?? "").trim())
      .filter(Boolean);
    return [...new Set(values)].slice(0, maximum);
  };
  const consultants = captured(/Verified consultant history:\s*([^|]+)/gi, 2);
  const contacts = captured(/Matched email contact:\s*([^|]+)/gi);
  const organisations = captured(/Matched project party:\s*([^|]+)/gi);
  const dates = captured(/Matched email date:\s*([^|]+)/gi, 2);
  const subjects = captured(/Matched email subject:\s*([^|]+)/gi, 2);
  const projects = captured(/Earlier job\(s\):\s*([^|]+)/gi);
  const emails = [...new Set((source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [])
    .map((email) => email.toLowerCase()))].slice(0, 5);
  const phones = [...new Set((source.match(/(?:\+|00)?\d[\d\s().-]{7,}\d/g) ?? [])
    .map((phone) => phone.trim()))].slice(0, 5);
  const conversations = Math.max(
    captured(/Evidence reference\(s\):\s*([^|]+)/gi, 25).length,
    dates.length,
    1,
  );
  const summary = [
    `${consultants.join(" and ") || "iAcoustics"} previously corresponded with ${contacts.join(", ") || organisations.join(", ") || "the project team"} (${conversations} verified email conversation${conversations === 1 ? "" : "s"}${dates[0] ? `; latest ${dates[0]}` : ""}).`,
    organisations.length ? `Relationship organisation/project party: ${organisations.join(", ")}.` : "",
    emails.length ? `Known email contacts: ${emails.join(", ")}.` : "",
    phones.length ? `Known phone numbers: ${phones.join(", ")}.` : "",
    subjects.length ? `Matched conversation subjects: ${subjects.join("; ")}.` : "",
    projects.length ? `Earlier or similar iAcoustics work referenced in the email history: ${projects.join(", ")}.` : "",
    "This is historical relationship context; the current project's acoustic requirement is assessed separately.",
  ].filter(Boolean).join(" ");
  return summary.length <= 1_600 ? summary : `${summary.slice(0, 1_599).trimEnd()}…`;
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
  const preserveWhenMissing = (incoming: unknown, prior: unknown) =>
    typeof incoming === "string" && incoming.trim()
      ? incoming
      : typeof prior === "string" ? prior : "";
  const preserveHumanValue = (prior: unknown, incoming: string) =>
    typeof prior === "string" && prior.trim() ? prior : incoming;
  const preserveVerifiedRelationship = existing.x_warm_connection_verified === true
    && payload.values.x_warm_connection_verified !== true;
  const incomingAssignmentIsAllowed = Boolean(payload.values.x_assigned_person);
  const preservedEmailMatchTag = existingEmailMatchTag(existing, registry);
  const appointmentPriority = (status: unknown) => status === "iacoustics-appointed" ? 3
    : status === "competitor-appointed" ? 2 : status === "needs-verification" ? 1 : 0;
  const preserveAppointment = appointmentPriority(existing.x_acoustic_appointment_status)
    > appointmentPriority(payload.values.x_acoustic_appointment_status);
  const preservedAppointmentStatus = preserveAppointment
    ? String(existing.x_acoustic_appointment_status)
    : payload.values.x_acoustic_appointment_status;
  const preservedStatusTag = appointmentTagName(preservedAppointmentStatus);
  const values = {
    ...payload.values,
      // Existing native contact values may have been corrected by a person.
      // Keep them; only fill fields that are still blank.
    partner_name: preserveHumanValue(existing.partner_name, payload.values.partner_name),
      contact_name: preserveHumanValue(existing.contact_name, payload.values.contact_name),
      email_from: preserveHumanValue(existing.email_from, payload.values.email_from),
      phone: preserveHumanValue(existing.phone, payload.values.phone),
      function: preserveHumanValue(existing.function, payload.values.function),
      street: preserveHumanValue(existing.street, payload.values.street),
      x_applicant: preserveWhenMissing(payload.values.x_applicant, existing.x_applicant),
      x_source_systems: sourceSystems,
      x_source_ledger: mergedValues(existing.x_source_ledger, payload.values.x_source_ledger, "\n"),
      x_source_record_ids: mergedValues(existing.x_source_record_ids, payload.values.x_source_record_ids, "; "),
      x_project_link: preserveWhenMissing(
        genericPlanningPortalUrl(String(payload.values.x_project_link ?? "")) ? "" : payload.values.x_project_link,
        genericPlanningPortalUrl(String(existing.x_project_link ?? "")) ? "" : existing.x_project_link,
      ),
      // A later source refresh may omit a date that was already verified and
      // backfilled in Odoo. Never erase that date, because it controls expiry
      // and prevents an old grant from returning to the primary queue.
      x_decision_due_at: preserveWhenMissing(payload.values.x_decision_due_at, existing.x_decision_due_at),
      x_source_urls: mergedProjectUrls(existing.x_source_urls, payload.values.x_source_urls),
      x_evidence_document_urls: mergedValues(
        existing.x_evidence_document_urls,
        payload.values.x_evidence_document_urls,
        "\n",
      ),
      x_party_details: mergedValues(existing.x_party_details, payload.values.x_party_details, "\n"),
      // Never revive a prior consultant assignment merely because the
      // relationship itself is preserved. The incoming payload applies the
      // current acoustic-evidence guard and is the authority for assignment.
      x_assigned_person: preserveVerifiedRelationship && incomingAssignmentIsAllowed
        ? preserveWhenMissing("", existing.x_assigned_person) || payload.values.x_assigned_person
        : payload.values.x_assigned_person,
      x_warm_connection_verified: preserveVerifiedRelationship || payload.values.x_warm_connection_verified,
      x_routing_reason: preserveVerifiedRelationship
        ? (incomingAssignmentIsAllowed
          ? preserveWhenMissing("", existing.x_routing_reason) || payload.values.x_routing_reason
          : [
            "Verified historical email relationship retained for context; current-project acoustic evidence is unconfirmed",
            existing.x_routing_reason ? `Prior route: ${existing.x_routing_reason}` : "",
          ].filter(Boolean).join(". "))
        : payload.values.x_routing_reason,
      x_relationship_summary: preserveVerifiedRelationship
        ? conciseLegacyRelationshipSummary(existing.x_relationship_summary) || payload.values.x_relationship_summary
        : payload.values.x_relationship_summary,
      x_relationship_evidence: preserveVerifiedRelationship
        ? preserveWhenMissing("", existing.x_relationship_evidence) || payload.values.x_relationship_evidence
        : payload.values.x_relationship_evidence,
      x_project_history_summary: !payload.values.x_project_history_evidence && existing.x_project_history_evidence
        ? preserveWhenMissing("", existing.x_project_history_summary)
        : payload.values.x_project_history_summary,
      x_project_history_evidence: preserveWhenMissing(
        payload.values.x_project_history_evidence,
        existing.x_project_history_evidence,
      ),
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
  };
  const normalizedRecord = { ...existing, ...values } as ExistingLeadValues;
  const normalizationNow = new Date();
  const normalizedPriority = historicalPipelinePriority(normalizedRecord, normalizationNow);
  const normalizedActive = historicalActiveLeadQueueStatus(normalizedRecord, normalizationNow);
  values.x_pipeline_priority_rank = normalizedPriority.rank;
  values.x_pipeline_priority_reason = normalizedPriority.reason;
  values.x_lead_panel = historicalLeadReviewPanel(normalizedRecord, normalizationNow);
  if (normalizedActive !== undefined) values.active = normalizedActive;
  return {
    ...payload,
    emailMatchTagName: preserveVerifiedRelationship ? preservedEmailMatchTag : payload.emailMatchTagName,
    statusTagNames: preservedStatusTag ? [preservedStatusTag] : [],
    attribution: {
      ...payload.attribution,
      sourceName: sourceSystems.includes(";") ? "Helmonic Tender Intelligence" : payload.attribution.sourceName,
    },
    values,
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
      managedRecordsMovedToLeads: 0,
      managedLeadsArchived: 0,
      managedLeadsReactivated: 0,
      managedRfisArchived: 0,
      managedRfisReactivated: 0,
      unmanagedTestFixturesArchived: 0,
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
    managedRecordsMovedToLeads: 0,
    managedLeadsArchived: 0,
    managedLeadsReactivated: 0,
    managedRfisArchived: 0,
    managedRfisReactivated: 0,
    unmanagedTestFixturesArchived: 0,
    failures: [],
  };
  for (const payload of payloads) {
    try {
      const matches = await json2Call(config, config.model, "search_read", {
        domain: [[config.externalIdField, "=", payload.matchValue]],
        fields: [
          "id",
          "active",
          "type",
          "tag_ids",
          "partner_name",
          "contact_name",
          "email_from",
          "phone",
          "function",
          "street",
          "partner_id",
          "x_applicant",
          "x_party_details",
          "x_source_systems",
          "x_project_reference",
          "x_source_reference",
          "x_studio_reference",
          "x_source_ledger",
          "x_source_record_ids",
          "x_project_link",
          "x_source_urls",
          "x_evidence_document_urls",
          "x_assigned_person",
          "x_warm_connection_verified",
          "x_routing_reason",
          "x_relationship_summary",
          "x_relationship_evidence",
          "x_project_history_summary",
          "x_project_history_evidence",
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
        context: { active_test: false },
      }, odooFetch) as ExistingLeadValues[];
      if (!Array.isArray(matches)) throw new Error("Odoo search_read returned an invalid response.");
      if (matches.length > 1) throw new Error("More than one Odoo lead has the same Helmonic external ID.");
      const effectivePayload = payloadWithExistingEvidence(payload, matches[0], tagRegistry);
      const attribution = await attributionValues(effectivePayload, config, odooFetch);
      const sourceTags = await sourceTagValues(effectivePayload, config, tagRegistry, odooFetch);
      const emailMatchTag = await emailMatchTagValues(effectivePayload, config, tagRegistry, odooFetch);
      const contact = matches[0]?.partner_id
        ? { id: false as const, created: false, matched: false }
        : await primaryContactId(effectivePayload, config, odooFetch);
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
      const values = valuesForOdoo(effectivePayload, config, fields, linkedValues, matches[0]);
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
        if (values.active === false && matches[0]?.active !== false) {
          result.managedLeadsArchived += 1;
          if (values.x_classification === "noise-related-rfi") result.managedRfisArchived += 1;
        }
        if (values.active === true && matches[0]?.active === false) {
          result.managedLeadsReactivated += 1;
          if (values.x_classification === "noise-related-rfi") result.managedRfisReactivated += 1;
        }
        if (matches[0]?.type === "opportunity" && values.type === "lead") {
          result.managedRecordsMovedToLeads += 1;
        }
      } else {
        await json2Call(config, config.model, "create", { vals_list: [values] }, odooFetch);
        result.created += 1;
        if (values.active === false) {
          result.managedLeadsArchived += 1;
          if (values.x_classification === "noise-related-rfi") result.managedRfisArchived += 1;
        }
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
  const historicalNormalization = await normalizeHistoricalOdooRecords(
    config,
    tagRegistry,
    new Map(payloads.map((payload) => [payload.matchValue, payload.values.name])),
    odooFetch,
  );
  result.historicalRecordsNormalized = historicalNormalization.normalized;
  result.managedRecordsMovedToLeads += historicalNormalization.movedToLeads;
  result.managedLeadsArchived += historicalNormalization.archivedLeads;
  result.managedLeadsReactivated += historicalNormalization.reactivatedLeads;
  result.managedRfisArchived += historicalNormalization.archivedRfis;
  result.managedRfisReactivated += historicalNormalization.reactivatedRfis;
  result.unmanagedTestFixturesArchived = await archiveUnmanagedTestFixtures(config, odooFetch);
  return result;
}
