import {
  acousticCpvCodes,
  acousticKeywords,
  classifyPlanningEvidence,
  deduplicateOpportunities,
  matchedAcousticTerms,
  normalizeText,
  relevantSector,
  relevantTenderText,
  scoreOpportunity,
  stableOpportunityId,
} from "./policy.ts";
import { parseCsv, pick } from "./csv.ts";
import type {
  OfficialSourceSnapshot,
  TenderOpportunity,
} from "./types.ts";
import { enrichDccPlanningOpportunities } from "./dcc-document-evidence.ts";
import { enrichFormalTenderOpportunities } from "./formal-document-evidence.ts";
import { enrichNationalPlanningOpportunities } from "./national-planning-evidence.ts";
import { routeOpportunitiesByRelationships } from "./relationship-routing.ts";
import {
  applyTargetScope,
  leinsterPlanningAuthorities,
  withinTargetScope,
} from "./source-scope.ts";
import { strFromU8, unzipSync } from "fflate";

export const officialSourceUrls = {
  ted: "https://api.ted.europa.eu/v3/notices/search",
  etenders:
    "https://assets.gov.ie/static/documents/4d482e0e/Public_Procurement_Opendata_Dataset.csv",
  nationalPlanning:
    "https://services.arcgis.com/NzlPQPKn5QF9v2US/arcgis/rest/services/IrishPlanningApplications/FeatureServer/0/query",
  dccBase: "https://opendata.dublincity.ie/PandDOpenData/DCC_DUBLINK_BASE.csv",
  dccFurtherInformation:
    "https://opendata.dublincity.ie/PandDOpenData/DCC_DUBLINK_FURINFO.csv",
  dccWeekly:
    "https://www.dublincity.ie/planning-and-land-use/find-planning-application/weeks-planning-applications-and-decisions",
  planningLeads: "https://planningleads.ie/api/v1",
} as const;

const dccOrigin = "https://www.dublincity.ie";

type TedNotice = Record<string, unknown>;

function multilingual(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(multilingual).find(Boolean) ?? "";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return multilingual(record.eng) || Object.values(record).map(multilingual).find(Boolean) || "";
  }
  return "";
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => stringArray(item));
  const normalized = normalizeText(value);
  return normalized ? [normalized] : [];
}

export function parseTedNotices(payload: unknown): TenderOpportunity[] {
  const notices =
    payload && typeof payload === "object" && Array.isArray((payload as { notices?: unknown }).notices)
      ? ((payload as { notices: TedNotice[] }).notices)
      : [];
  return notices.flatMap((notice) => {
    const publicationNumber = normalizeText(notice["publication-number"]);
    const title = multilingual(notice["notice-title"]);
    const buyer = multilingual(notice["buyer-name"]);
    const cpvCodes = [...new Set(stringArray(notice["classification-cpv"]))];
    const description = multilingual(notice["description-lot"] ?? notice["short-description"]);
    const matchedTerms = matchedAcousticTerms(title, description);
    const cpvMatch = cpvCodes.some((code) => acousticCpvCodes.includes(code as never));
    if (!publicationNumber || (!cpvMatch && !relevantTenderText(title, description))) return [];
    const sourceUrl = `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(publicationNumber)}`;
    const opportunity: TenderOpportunity = {
      id: stableOpportunityId("TED", publicationNumber),
      type: "formal-public-tender",
      sourceSystem: "TED",
      sourceRecordId: publicationNumber,
      title: title || `TED notice ${publicationNumber}`,
      description,
      buyer,
      publishedAt: normalizeText(notice["publication-date"]) || undefined,
      deadline:
        stringArray(notice["deadline-receipt-tender-date-lot"] ?? notice.deadline)[0] || undefined,
      sourceUrl,
      evidenceStatus: "discovery-only",
      evidenceExcerpt: description || title,
      cpvCodes,
      matchedTerms,
      fitScore: 0,
    };
    opportunity.fitScore = scoreOpportunity(opportunity);
    return [opportunity];
  });
}

export function parseEtendersCsv(text: string): TenderOpportunity[] {
  return parseCsv(text).flatMap((row) => {
    const sourceRecordId = pick(row, ["Tender ID", "CfT Id", "Notice ID", "Competition ID", "ID"]);
    const title = pick(row, ["Tender/Contract Name", "CfT Title", "Title", "Competition Title", "Contract Title"]);
    const description = pick(row, ["Description", "Short Description", "Contract Description", "Main Cpv Code Description"]);
    const buyer = [
      pick(row, ["Name of Client Contracting Authority"]),
      pick(row, ["Buyer", "Contracting Authority", "Organisation Name"]),
    ].filter(Boolean).join(" · ");
    const cpvCodes = [...new Set([
      pick(row, ["Main Cpv Code", "CPV", "CPV Code", "Main CPV"]),
      pick(row, ["Additional CPV Codes on CFT"]),
    ].join(";")
      .split(/[;,|\s]+/)
      .map((value) => value.trim())
      .filter((value) => /^\d{8}$/.test(value)))];
    const matchedTerms = matchedAcousticTerms(title, description);
    const cpvMatch = cpvCodes.some((code) => acousticCpvCodes.includes(code as never));
    if (!sourceRecordId || (!cpvMatch && !relevantTenderText(title, description))) return [];
    const sourceUrl =
      pick(row, ["TED Notice Link", "URL", "Notice URL", "CfT URL", "Link"]) ||
      "https://www.etenders.gov.ie/epps/quickSearchAction.do";
    const deadline = pick(row, ["Tender Submission Deadline", "Deadline", "Closing Date", "Response Deadline"]);
    const deadlineDate = parseIrishDate(deadline);
    const awarded = pick(row, ["Award Published", "Awarded Suppliers"]);
    const cancelled = pick(row, ["Cancelled Date"]);
    if (cancelled || awarded || (deadlineDate && deadlineDate.getTime() < Date.now())) return [];
    const opportunity: TenderOpportunity = {
      id: stableOpportunityId("eTenders", sourceRecordId),
      type: "formal-public-tender",
      sourceSystem: "eTenders",
      sourceRecordId,
      title: title || `eTenders notice ${sourceRecordId}`,
      description,
      buyer,
      publishedAt: pick(row, ["Notice Published Date / Contract Created Date", "Published Date", "Publication Date", "Date Published"]) || undefined,
      deadline: deadline || undefined,
      sourceUrl,
      evidenceStatus: "discovery-only",
      evidenceExcerpt: description || title,
      cpvCodes,
      matchedTerms,
      fitScore: 0,
    };
    opportunity.fitScore = scoreOpportunity(opportunity);
    return [opportunity];
  });
}

function parseIrishDate(value: string) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return undefined;
  return new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 23, 59, 59));
}

type ArcGisFeature = { attributes?: Record<string, unknown> };

export function parseNationalPlanningFeatures(payload: unknown): TenderOpportunity[] {
  const features =
    payload && typeof payload === "object" && Array.isArray((payload as { features?: unknown }).features)
      ? ((payload as { features: ArcGisFeature[] }).features)
      : [];
  return features.flatMap((feature) => {
    const attributes = feature.attributes ?? {};
    const authority = normalizeText(attributes.PlanningAuthority);
    const reference = normalizeText(attributes.ApplicationNumber);
    const description = normalizeText(attributes.DevelopmentDescription);
    const decision = normalizeText(attributes.Decision || attributes.ApplicationStatus);
    const sourceUrl = normalizeText(attributes.LinkAppDetails);
    if (!authority || !reference) return [];
    const recentActivity = [
      attributes.ReceivedDate,
      attributes.DecisionDate,
      attributes.FIRequestDate,
      attributes.FIRecDate,
    ].some((value) => dateWithinDays(value, 120));
    if (!recentActivity) return [];
    const discoveryRelevant = matchedAcousticTerms(description).length > 0 || relevantSector(description);
    if (!discoveryRelevant) return [];
    const classification = classifyPlanningEvidence({
      stage: decision,
      description,
      evidenceUrl: sourceUrl,
    });
    const opportunity: TenderOpportunity = {
      id: stableOpportunityId("planning", authority, reference),
      type: "planning-pipeline-lead",
      sourceSystem: "National Planning Register",
      sourceRecordId: `${authority}:${reference}`,
      projectReference: reference,
      planningAuthority: authority,
      applicant: [attributes.ApplicantForename, attributes.ApplicantSurname]
        .map(normalizeText)
        .filter(Boolean)
        .join(" ") || undefined,
      title: normalizeText(attributes.DevelopmentAddress) || reference,
      description,
      location: normalizeText(attributes.DevelopmentAddress) || undefined,
      publishedAt: dateFromArcGis(attributes.ETL_DATE ?? attributes.ReceivedDate),
      deadline: dateFromArcGis(attributes.DecisionDueDate),
      sourceUrl: sourceUrl || "https://planning.localgov.ie/",
      evidenceStatus: "discovery-only",
      classification,
      cpvCodes: [],
      matchedTerms: matchedAcousticTerms(description),
      fitScore: 0,
    };
    opportunity.fitScore = scoreOpportunity(opportunity);
    return [opportunity];
  });
}

function dateWithinDays(value: unknown, days: number) {
  const parsed = typeof value === "number" ? value : Date.parse(normalizeText(value));
  if (!Number.isFinite(parsed)) return false;
  const age = Date.now() - parsed;
  return age >= 0 && age <= days * 86_400_000;
}

function dateFromArcGis(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  const normalized = normalizeText(value);
  return normalized || undefined;
}

export function parseDccPlanningCsv(baseText: string, furtherInformationText: string) {
  const furtherInformation = new Map<string, Record<string, string>[]>();
  for (const row of parseCsv(furtherInformationText)) {
    const key = pick(row, ["APNID", "Application ID", "REG_REF"]);
    if (!key) continue;
    furtherInformation.set(key, [...(furtherInformation.get(key) ?? []), row]);
  }

  return parseCsv(baseText).flatMap((row) => {
    const reference = pick(row, ["REG_REF", "Registration Reference", "APNID"]);
    const applicationId = pick(row, ["APNID", "Application ID"]) || reference;
    const description = pick(row, ["LONG_PROPOSAL", "PROPOSAL", "Description"]);
    const location = pick(row, ["LOCATION", "Address"]);
    const stage = pick(row, ["APPTYPE DECISION", "APPTYPE", "DECISION", "STAGE"]);
    const fi = furtherInformation.get(applicationId) ?? furtherInformation.get(reference) ?? [];
    const evidenceText = fi.map((item) => pick(item, ["FI_DESC", "Description"])).filter(Boolean).join("\n");
    const sourceUrl = `https://planning.agileapplications.ie/dublincity/application-details/${encodeURIComponent(reference)}`;
    if (!reference || !(matchedAcousticTerms(description, evidenceText).length > 0 || relevantSector(description))) {
      return [];
    }
    const effectiveStage = evidenceText ? "Further Information" : stage;
    const classification = classifyPlanningEvidence({
      stage: effectiveStage,
      evidenceText: evidenceText || undefined,
      description,
      evidenceUrl: evidenceText ? sourceUrl : undefined,
    });
    const opportunity: TenderOpportunity = {
      id: stableOpportunityId("DCC", reference),
      type: "planning-pipeline-lead",
      sourceSystem: "DCC",
      sourceRecordId: reference,
      projectReference: reference,
      planningAuthority: "Dublin City Council",
      title: location || reference,
      description,
      location: location || undefined,
      publishedAt: pick(row, ["RGNDAT", "APNDAT"]) || undefined,
      deadline: pick(row, ["DECDAT", "TIME_EXP"]) || undefined,
      responseDeadline: fi.map((item) => pick(item, ["RECDDATE"])).find(Boolean) || undefined,
      sourceUrl,
      evidenceStatus: evidenceText ? "official-text" : "discovery-only",
      evidenceExcerpt: evidenceText || undefined,
      classification,
      cpvCodes: [],
      matchedTerms: matchedAcousticTerms(description, evidenceText),
      fitScore: 0,
    };
    opportunity.fitScore = scoreOpportunity(opportunity);
    return [opportunity];
  });
}

function decodeXmlText(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

export function parseDccWeeklyDocumentLinks(html: string) {
  const matches = [...html.matchAll(/href=["']([^"']+\.docx(?:\?[^"']*)?)["']/gi)]
    .map((match) => new URL(decodeXmlText(match[1]), dccOrigin).toString());
  const newestByArea = new Map<string, { week: number; url: string }>();
  for (const url of matches) {
    const name = new URL(url).pathname.match(/a(\d+)-wpl-(\d+)-(\d+)\.docx$/i);
    if (!name) continue;
    const area = name[1];
    const week = Number.parseInt(name[2], 10);
    const current = newestByArea.get(area);
    if (!current || week > current.week) newestByArea.set(area, { week, url });
  }
  return [...newestByArea.entries()]
    .sort(([areaA], [areaB]) => Number(areaA) - Number(areaB))
    .map(([, value]) => value.url);
}

function textFromDocx(bytes: Uint8Array) {
  const documentXml = unzipSync(bytes)["word/document.xml"];
  if (!documentXml) throw new Error("DCC-weekly-document-xml-missing");
  const xml = strFromU8(documentXml);
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXmlText(match[1]))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function dccWeeklyApplicationBlocks(bytes: Uint8Array) {
  return textFromDocx(bytes).split(/(?=Area\s+\d+\s*-\s*[^]{0,100}?Application Number\s+)/i);
}

export function countDccWeeklyApplications(bytes: Uint8Array) {
  return dccWeeklyApplicationBlocks(bytes).filter((block) => /\bApplication Number\s+/i.test(block)).length;
}

export function parseDccWeeklyDocx(bytes: Uint8Array, documentUrl: string): TenderOpportunity[] {
  const blocks = dccWeeklyApplicationBlocks(bytes);
  return blocks.flatMap((block) => {
    const reference = normalizeText(block.match(/Application Number\s+(.+?)\s+Application Type\b/i)?.[1]);
    const location = normalizeText(
      block.match(/\bLocation\s+(.+?)\s+(?:Registration Date|Decision Date|Additional Information)\b/i)?.[1],
    );
    const applicant = normalizeText(block.match(/\bApplicant\s+(.+?)\s+Location\b/i)?.[1]);
    const description = normalizeText(block.match(/\bProposal\s*:\s*([\s\S]+)/i)?.[1] ?? block);
    const matchedTerms = matchedAcousticTerms(description);
    // The acoustic trigger often appears only in the RFI, decision notice or
    // planner report. Keep sector-relevant applications for the subsequent
    // document-level evidence gate even when the weekly summary is silent.
    if (!reference || (matchedTerms.length === 0 && !relevantSector(description))) return [];
    const stage = normalizeText(
      block.match(/\b(?:Decision Type|Additional Information|Application Type)\s+(.+?)(?:\bApplicant\b|\bProposal\b|$)/i)?.[1],
    );
    const classification = classifyPlanningEvidence({ stage, description });
    const opportunity: TenderOpportunity = {
      id: stableOpportunityId("DCC-weekly", reference),
      type: "planning-pipeline-lead",
      sourceSystem: "DCC",
      sourceRecordId: reference,
      projectReference: reference,
      planningAuthority: "Dublin City Council",
      applicant: applicant || undefined,
      title: location || reference,
      description,
      location: location || undefined,
      sourceUrl: documentUrl,
      evidenceStatus: "discovery-only",
      evidenceExcerpt: description.slice(0, 1_200),
      classification,
      cpvCodes: [],
      matchedTerms,
      fitScore: 0,
    };
    opportunity.fitScore = scoreOpportunity(opportunity);
    return [opportunity];
  });
}

function lastNDaysDate(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

const nationalPlanningLookbackDays = 35;
const nationalPlanningPageSize = 1_000;

function transientHttpStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function transientFetchError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError"
    || error.name === "TimeoutError"
    || /aborted due to timeout|fetch failed|network/i.test(error.message);
}

async function fetchWithBoundedRetry(
  fetcher: typeof fetch,
  url: string,
  init: Omit<RequestInit, "signal">,
  options: { attempts?: number; timeoutMs?: number; retryDelayMs?: number } = {},
) {
  const attempts = Math.max(1, options.attempts ?? 3);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 25_000);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!transientHttpStatus(response.status) || attempt === attempts) return response;
      lastError = new Error(`${new URL(url).hostname}-${response.status}`);
    } catch (error) {
      lastError = error;
      if (!transientFetchError(error) || attempt === attempts) throw error;
    }
    if (retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }
  throw lastError;
}

export function buildNationalPlanningWhere(now = Date.now()) {
  const since = new Date(now - nationalPlanningLookbackDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const activity = ["ReceivedDate", "DecisionDate", "FIRequestDate"]
    .map((field) => `${field} >= DATE '${since}'`)
    .join(" OR ");
  const authorities = leinsterPlanningAuthorities.map((authority) => `'${authority.replaceAll("'", "''")}'`).join(",");
  return `(${activity}) AND PlanningAuthority IN (${authorities})`;
}

export async function collectNationalPlanningFeatures(
  fetcher: typeof fetch = fetch,
  pageSize = nationalPlanningPageSize,
  now = Date.now(),
) {
  const features: ArcGisFeature[] = [];
  const where = buildNationalPlanningWhere(now);
  let pagesFetched = 0;
  for (let offset = 0; ; offset += pageSize) {
    const query = new URLSearchParams({
      where,
      outFields:
        "PlanningAuthority,ApplicationNumber,DevelopmentDescription,DevelopmentAddress,ApplicationStatus,ApplicationType,ApplicantForename,ApplicantSurname,Decision,ReceivedDate,DecisionDate,DecisionDueDate,FIRequestDate,FIRecDate,LinkAppDetails,ETL_DATE",
      orderByFields: "OBJECTID ASC",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      returnGeometry: "false",
      f: "json",
    });
    const response = await fetchWithBoundedRetry(fetcher, `${officialSourceUrls.nationalPlanning}?${query}`, {
      cache: "no-store",
      headers: { "User-Agent": "Helmonic-Tender-Intelligence/1.0" },
    });
    if (!response.ok) throw new Error(`National-Planning-${response.status}`);
    const payload = await response.json();
    if (payload?.error) {
      throw new Error(`National-Planning-${normalizeText(payload.error.message) || "ArcGIS-error"}`);
    }
    const page = Array.isArray(payload?.features) ? payload.features : [];
    pagesFetched += 1;
    features.push(...page);
    if (!payload?.exceededTransferLimit || page.length < pageSize) break;
    if (page.length === 0) throw new Error("National-Planning-empty-page-with-transfer-limit");
  }
  return { features, pagesFetched };
}

export function buildTedSearchRequest(page = 1, limit = 100) {
  const acoustic = acousticKeywords.map((term) => `FT~\"${term}\"`);
  const cpv = acousticCpvCodes.map((code) => `classification-cpv=${code}`);
  return {
    query: `buyer-country=IRL AND (${[...acoustic, ...cpv].join(" OR ")}) AND publication-date>=${lastNDaysDate(120)} SORT BY publication-date DESC`,
    fields: [
      "publication-number",
      "notice-title",
      "buyer-name",
      "publication-date",
      "classification-cpv",
      "deadline-receipt-tender-date-lot",
      "description-lot",
    ],
    limit,
    scope: "ACTIVE",
    checkQuerySyntax: false,
    paginationMode: "PAGE_NUMBER",
    page,
  };
}

export async function collectTedOpportunities(
  fetcher: typeof fetch = fetch,
  pageSize = 100,
) {
  const records: TenderOpportunity[] = [];
  let scannedRecords = 0;
  let pagesFetched = 0;
  let totalNoticeCount: number | undefined;
  const maximumPages = 1_000;
  for (let page = 1; page <= maximumPages; page += 1) {
    const response = await fetchWithBoundedRetry(fetcher, officialSourceUrls.ted, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(buildTedSearchRequest(page, pageSize)),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`TED-${response.status}`);
    const payload = await response.json() as { notices?: unknown[]; totalNoticeCount?: number; timedOut?: boolean };
    if (payload.timedOut) throw new Error("TED-query-timed-out");
    const pageNotices = Array.isArray(payload.notices) ? payload.notices : [];
    pagesFetched += 1;
    scannedRecords += pageNotices.length;
    records.push(...parseTedNotices(payload));
    if (Number.isFinite(payload.totalNoticeCount)) totalNoticeCount = Number(payload.totalNoticeCount);
    if (pageNotices.length === 0 || pageNotices.length < pageSize) break;
    if (totalNoticeCount !== undefined && scannedRecords >= totalNoticeCount) break;
    if (page === maximumPages) throw new Error("TED-pagination-safety-limit");
  }
  return {
    records: deduplicateOpportunities(records),
    scannedRecords,
    pagesFetched,
    totalNoticeCount,
  };
}

async function fetchText(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { "User-Agent": "Helmonic-Tender-Intelligence/1.0", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname}-${response.status}`);
  return response.text();
}

export type PlanningLeadsConnectorConfig = {
  enabled: boolean;
  endpoint?: string;
  apiKey?: string;
  pageSize?: number;
  cacheHours?: number;
};

const planningLeadsSearchTerms = ["noise", "acoustic", "vibration"] as const;

function firstValue(record: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = normalizeText(record[name]);
    if (value) return value;
  }
  return "";
}

function planningLeadsRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["results", "leads", "items", "data"]) {
    const rows = record[key];
    if (Array.isArray(rows)) {
      return rows.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
    }
  }
  return [];
}

export function parsePlanningLeads(payload: unknown): TenderOpportunity[] {
  return planningLeadsRows(payload).flatMap((row) => {
    const sourceRecordId = firstValue(row, [
      "application_reference",
      "planning_reference",
      "application_number",
      "application_id",
      "reg_ref",
      "reference",
      "id",
    ]);
    const title = firstValue(row, ["title", "project_name", "development_address", "address"]);
    const description = firstValue(row, [
      "development_description",
      "description",
      "proposal",
      "summary",
    ]);
    const authority = firstValue(row, ["planning_authority", "authority", "local_authority"]);
    const stage = firstValue(row, [
      "decision_status",
      "decision",
      "status",
      "application_status",
      "lead_readiness",
      "stage",
    ]);
    const sourceUrl = firstValue(row, [
      "raw_source_url",
      "source_url",
      "public_url",
      "public_page_url",
      "record_url",
      "detail_url",
      "planning_url",
      "planning_link",
      "application_url",
      "source_link",
      "url",
      "link",
    ]);
    const matchedTerms = matchedAcousticTerms(title, description);
    if (!sourceRecordId || !sourceUrl || (matchedTerms.length === 0 && !relevantSector(title, description))) return [];

    // PlanningLeads is an accelerator, not the evidence authority. Even if its
    // summary says granted/refused/RFI, the linked council wording must be read
    // before a planning-stage classification is confirmed.
    const classification = relevantSector(title, description)
      ? "design-construction-potential"
      : "needs-council-evidence";
    const opportunity: TenderOpportunity = {
      id: stableOpportunityId("PlanningLeads", authority, sourceRecordId),
      type: "planning-pipeline-lead",
      sourceSystem: "PlanningLeads",
      sourceRecordId,
      projectReference: sourceRecordId,
      planningAuthority: authority || undefined,
      applicant: firstValue(row, ["applicant", "applicant_name", "organisation_name", "company_name"]) || undefined,
      title: title || [authority, sourceRecordId].filter(Boolean).join(" · "),
      description: [description, stage].filter(Boolean).join(" · "),
      location: firstValue(row, ["development_address", "address", "location", "county"]) || undefined,
      publishedAt: firstValue(row, [
        "updated_at",
        "first_seen",
        "date_received",
        "received_date",
        "created_at",
      ]) || undefined,
      deadline: firstValue(row, ["decision_due_date", "deadline", "response_deadline"]) || undefined,
      sourceUrl,
      evidenceStatus: "discovery-only",
      classification,
      cpvCodes: [],
      matchedTerms,
      fitScore: 0,
    };
    opportunity.fitScore = scoreOpportunity(opportunity);
    return [opportunity];
  });
}

export function buildPlanningLeadsSearchUrls(config: PlanningLeadsConnectorConfig) {
  const endpoint = (config.endpoint || officialSourceUrls.planningLeads).replace(/\/+$/, "");
  const pageSize = Math.min(100, Math.max(1, config.pageSize ?? 100));
  return planningLeadsSearchTerms.map((term) => {
    const query = new URLSearchParams({ q: term, page: "1", page_size: String(pageSize) });
    return `${endpoint}/leads?${query}`;
  });
}

export function filterRecentPlanningLeads(
  records: TenderOpportunity[],
  days = 120,
  now = Date.now(),
) {
  const maximumAge = days * 86_400_000;
  return records.filter((record) => {
    const timestamp = Date.parse(record.publishedAt ?? "");
    if (!Number.isFinite(timestamp)) return false;
    const age = now - timestamp;
    return age >= 0 && age <= maximumAge;
  });
}

let planningLeadsCache:
  | { expiresAt: number; records: TenderOpportunity[] }
  | undefined;

async function collectPlanningLeads(config: PlanningLeadsConnectorConfig) {
  if (planningLeadsCache && planningLeadsCache.expiresAt > Date.now()) {
    return planningLeadsCache.records;
  }
  const responses = await Promise.all(
    buildPlanningLeadsSearchUrls(config).map(async (url) => {
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          "User-Agent": "Helmonic-Tender-Intelligence/1.0",
        },
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new Error(`PlanningLeads-${response.status}`);
      return parsePlanningLeads(await response.json());
    }),
  );
  const records = filterRecentPlanningLeads(deduplicateOpportunities(responses.flat()));
  planningLeadsCache = {
    expiresAt: Date.now() + Math.max(1, config.cacheHours ?? 12) * 3_600_000,
    records,
  };
  return records;
}

export async function collectOfficialSourceSnapshot(options: {
  planningLeads?: PlanningLeadsConnectorConfig;
  documentEvidence?: {
    formal?: boolean;
    nationalPlanningLimit?: number;
  };
} = {}): Promise<OfficialSourceSnapshot> {
  const sources: OfficialSourceSnapshot["sources"] = [];
  const records: TenderOpportunity[] = [];
  const tasks: Array<Promise<void>> = [
    (async () => {
      try {
        const result = await collectTedOpportunities();
        const scoped = result.records.map(applyTargetScope).filter(withinTargetScope);
        records.push(...scoped);
        sources.push({
          name: "TED",
          status: "ok",
          records: scoped.length,
          scannedRecords: result.scannedRecords,
          pagesFetched: result.pagesFetched,
        });
      } catch (error) {
        sources.push({ name: "TED", status: "failed", records: 0, error: error instanceof Error ? error.message : "unknown" });
      }
    })(),
    (async () => {
      try {
        const csv = await fetchText(officialSourceUrls.etenders);
        const parsed = parseEtendersCsv(csv).map(applyTargetScope).filter(withinTargetScope);
        records.push(...parsed);
        sources.push({ name: "eTenders", status: "ok", records: parsed.length, scannedRecords: parseCsv(csv).length, pagesFetched: 1 });
      } catch (error) {
        sources.push({ name: "eTenders", status: "failed", records: 0, error: error instanceof Error ? error.message : "unknown" });
      }
    })(),
    (async () => {
      try {
        const result = await collectNationalPlanningFeatures();
        const parsed = parseNationalPlanningFeatures(result).map(applyTargetScope).filter(withinTargetScope);
        records.push(...parsed);
        sources.push({
          name: "National Planning Register",
          status: "ok",
          records: parsed.length,
          scannedRecords: result.features.length,
          pagesFetched: result.pagesFetched,
        });
      } catch (error) {
        sources.push({ name: "National Planning Register", status: "failed", records: 0, error: error instanceof Error ? error.message : "unknown" });
      }
    })(),
    (async () => {
      try {
        const weeklyPage = await fetchText(officialSourceUrls.dccWeekly);
        const documentUrls = parseDccWeeklyDocumentLinks(weeklyPage);
        if (documentUrls.length === 0) throw new Error("DCC-weekly-documents-missing");
        let scannedRecords = 0;
        const parsed = (
          await Promise.all(
            documentUrls.map(async (url) => {
              const response = await fetch(url, {
                cache: "no-store",
                headers: { "User-Agent": "Helmonic-Tender-Intelligence/1.0" },
                signal: AbortSignal.timeout(25_000),
              });
              if (!response.ok) throw new Error(`DCC-weekly-${response.status}`);
              const bytes = new Uint8Array(await response.arrayBuffer());
              scannedRecords += countDccWeeklyApplications(bytes);
              return parseDccWeeklyDocx(bytes, url);
            }),
          )
        ).flat();
        const scoped = parsed.map(applyTargetScope).filter(withinTargetScope);
        records.push(...scoped);
        sources.push({
          name: "DCC",
          status: "ok",
          records: scoped.length,
          scannedRecords,
          pagesFetched: 1,
          sourceDocumentsFetched: documentUrls.length,
        });
      } catch (error) {
        sources.push({ name: "DCC", status: "failed", records: 0, error: error instanceof Error ? error.message : "unknown" });
      }
    })(),
  ];
  const planningLeads = options.planningLeads;
  if (!planningLeads?.enabled || !planningLeads.apiKey) {
    sources.push({
      name: "PlanningLeads",
      status: "not-configured",
      records: 0,
      error: planningLeads?.enabled
        ? "Free API key not configured"
        : "Optional free discovery connector disabled",
    });
  } else {
    tasks.push((async () => {
      try {
        const parsed = (await collectPlanningLeads(planningLeads)).map(applyTargetScope).filter(withinTargetScope);
        records.push(...parsed);
        sources.push({ name: "PlanningLeads", status: "ok", records: parsed.length });
      } catch (error) {
        sources.push({
          name: "PlanningLeads",
          status: "failed",
          records: 0,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    })());
  }
  await Promise.all(tasks);
  let opportunities = await enrichDccPlanningOpportunities(deduplicateOpportunities(records));
  if (options.documentEvidence?.formal !== false) {
    opportunities = await enrichFormalTenderOpportunities(opportunities);
  }
  const nationalPlanningLimit = Math.max(0, options.documentEvidence?.nationalPlanningLimit ?? 0);
  if (nationalPlanningLimit > 0) {
    opportunities = await enrichNationalPlanningOpportunities(opportunities, { limit: nationalPlanningLimit });
  }
  opportunities = routeOpportunitiesByRelationships(opportunities);

  for (const source of sources) {
    const sourceRecords = opportunities.filter((record) => record.sourceSystem === source.name);
    source.officialEvidenceRecords = sourceRecords.filter((record) => record.evidenceStatus === "official-text").length;
    source.evidenceUnavailableRecords = sourceRecords.filter((record) => record.evidenceStatus === "evidence-unavailable").length;
    source.discoveryOnlyRecords = sourceRecords.filter((record) => record.evidenceStatus === "discovery-only").length;
    source.routedToGlen = sourceRecords.filter((record) => record.routedTo === "Glen").length;
    source.routedToOwen = sourceRecords.filter((record) => record.routedTo === "Owen").length;
    source.needsTriage = sourceRecords.filter((record) => record.routingStatus === "needs-triage").length;
  }
  return {
    generatedAt: new Date().toISOString(),
    sources: sources.sort((a, b) => a.name.localeCompare(b.name)),
    opportunities,
  };
}
