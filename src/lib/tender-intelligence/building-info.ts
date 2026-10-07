import {
  matchedAcousticTerms,
  normalizeText,
  relevantSector,
  scoreOpportunity,
  stableOpportunityId,
} from "./policy.ts";
import type { LeadParty, TenderOpportunity } from "./types.ts";

export type BuildingInfoConfig = {
  enabled: boolean;
  endpoint: string;
  apiKey?: string;
  userKey?: string;
  updateWindow?: string;
  minUpdatedAt?: string;
  maxUpdatedAt?: string;
  pageSize?: number;
  maxPages?: number;
};

function stringValue(value: unknown) {
  return normalizeText(value);
}

function numberValue(value: unknown) {
  const parsed = Number.parseFloat(stringValue(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rowsFromPayload(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["data", "records", "results", "projects"]) {
    if (Array.isArray(record[key])) return rowsFromPayload(record[key]);
  }
  return record.planning_id ? [record] : [];
}

function companyRole(value: string): LeadParty["role"] {
  if (/applicant/i.test(value)) return "applicant";
  if (/agent/i.test(value)) return "agent";
  if (/architect/i.test(value)) return "architect";
  if (/developer|equity provider/i.test(value)) return "developer";
  if (/contractor/i.test(value)) return "contractor";
  if (/consult|engineer|project manager|certifier/i.test(value)) return "consultant";
  return "other";
}

function companiesFromRow(row: Record<string, unknown>): LeadParty[] {
  const raw = Array.isArray(row.companies) ? row.companies : [];
  return raw.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const company = value as Record<string, unknown>;
    const roleValue = company.planning_company_type_name;
    const roleName = typeof roleValue === "object" && roleValue
      ? stringValue((roleValue as Record<string, unknown>).company_type_name)
      : stringValue(roleValue);
    const organisation = stringValue(company.company_name);
    const contact = stringValue(company.planning_company_contact_name);
    const email = stringValue(company.company_email);
    if (!organisation && !contact && !email) return [];
    return [{
      name: contact || organisation || email,
      organisation: organisation || undefined,
      role: companyRole(roleName),
      email: email || undefined,
    } satisfies LeadParty];
  });
}

function isAgriculture(row: Record<string, unknown>) {
  return /agricultur/i.test(`${stringValue(row.planning_category)} ${stringValue(row.planning_subcategory)}`);
}

export function parseBuildingInfoProjects(payload: unknown): TenderOpportunity[] {
  return rowsFromPayload(payload).flatMap((row) => {
    const planningId = stringValue(row.planning_id);
    if (!planningId) return [];
    const title = stringValue(row.planning_title) || `BuildingInfo project ${planningId}`;
    const originalDescription = stringValue(row.planning_description);
    const category = stringValue(row.planning_category);
    const subcategory = stringValue(row.planning_subcategory);
    const stage = stringValue(row.planning_stage);
    const projectType = stringValue(row.planning_type);
    const units = numberValue(row.planning_units);
    const value = numberValue(row.planning_value);
    const description = [
      originalDescription,
      category && `Category: ${category}`,
      subcategory && `Subcategory: ${subcategory}`,
      projectType && `Type: ${projectType}`,
      stage && `Stage: ${stage}`,
      units !== undefined && `Units: ${units}`,
      value !== undefined && `Value: ${value}`,
    ].filter(Boolean).join("\n");
    const parties = companiesFromRow(row);
    const sourceUrl = stringValue(row.planning_url) || stringValue(row.planning_urlopen) || "https://app.buildinginfo.com/";
    const agriculture = isAgriculture(row);
    const classification = !agriculture && relevantSector(title, description)
      ? "design-construction-potential"
      : "no-relevant-opportunity";
    const opportunity: TenderOpportunity = {
      id: stableOpportunityId("BuildingInfo", planningId),
      type: "planning-pipeline-lead",
      sourceSystem: "BuildingInfo",
      sourceRecordId: planningId,
      projectReference: stringValue(row.planning_number) || planningId,
      planningAuthority: stringValue(row.council_name) || undefined,
      applicant: parties.find((party) => party.role === "applicant")?.organisation,
      parties,
      title,
      description,
      location: [
        row.planning_development_address_1,
        row.planning_development_address_2,
        row.planning_development_address_3,
        row.planning_development_address_4,
        row.planning_development_postcode,
      ].map(stringValue).filter(Boolean).join(", ") || stringValue(row.planning_county) || undefined,
      publishedAt: stringValue(row.planning_application_date) || undefined,
      sourceUpdatedAt: stringValue(row.api_date) || undefined,
      sourceMajorUpdatedAt: stringValue(row.planning_public_updated) || undefined,
      deadline: stringValue(row.planning_tender_deadline) || undefined,
      sourceUrl,
      evidenceStatus: "discovery-only",
      classification,
      cpvCodes: [],
      matchedTerms: matchedAcousticTerms(title, description),
      fitScore: 0,
      sourceStatus: stage || undefined,
      projectStage: stage || undefined,
      projectValue: value,
      projectUnits: units,
      scopeStatus: agriculture ? "excluded" : undefined,
      scopeExclusionReason: agriculture ? "excluded-agriculture" : undefined,
    };
    opportunity.fitScore = scoreOpportunity(opportunity);
    return [opportunity];
  });
}

export function buildBuildingInfoPageUrl(config: BuildingInfoConfig, offset = 0) {
  const pageSize = Math.min(1000, Math.max(1, config.pageSize ?? 1000));
  const url = new URL(config.endpoint);
  if (!config.apiKey || !config.userKey) throw new Error("BuildingInfo API credentials are not configured.");
  url.searchParams.set("api_key", config.apiKey);
  url.searchParams.set("ukey", config.userKey);
  if (config.minUpdatedAt || config.maxUpdatedAt) {
    url.searchParams.set("_apion", "8");
    if (config.minUpdatedAt) url.searchParams.set("min_apion", config.minUpdatedAt);
    if (config.maxUpdatedAt) url.searchParams.set("max_apion", config.maxUpdatedAt);
  } else {
    url.searchParams.set("_apion", config.updateWindow ?? "0.7");
  }
  url.searchParams.set("more", `limit ${offset},${pageSize}`);
  url.searchParams.set("order", "planning_id");
  return url;
}

export async function collectBuildingInfoProjects(
  config: BuildingInfoConfig,
  fetcher: typeof fetch = fetch,
) {
  const pageSize = Math.min(1000, Math.max(1, config.pageSize ?? 1000));
  const maxPages = Math.max(1, config.maxPages ?? 50);
  const records: TenderOpportunity[] = [];
  let pagesFetched = 0;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await fetcher(buildBuildingInfoPageUrl(config, page * pageSize), {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "Helmonic-Tender-Intelligence/1.0" },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw new Error(`BuildingInfo-${response.status}`);
    const parsed = parseBuildingInfoProjects(await response.json());
    records.push(...parsed);
    pagesFetched += 1;
    if (parsed.length < pageSize) break;
  }
  return { records, pagesFetched, scannedRecords: records.length };
}
