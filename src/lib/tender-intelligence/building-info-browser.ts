import { acousticKeywords, matchedAcousticTerms, normalizeText } from "./policy.ts";

export type BuildingInfoBrowserLink = {
  text: string;
  href: string;
};

export type BuildingInfoBrowserSnapshot = {
  projectUrl: string;
  pageTitle?: string;
  heading?: string;
  bodyText: string;
  links?: BuildingInfoBrowserLink[];
  observedAt?: string;
  searchProfile?: string;
};

export type BuildingInfoBrowserRow = Record<string, string>;

const countyNames = [
  "Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin", "Galway", "Kerry",
  "Kildare", "Kilkenny", "Laois", "Leitrim", "Limerick", "Longford", "Louth",
  "Mayo", "Meath", "Monaghan", "Offaly", "Roscommon", "Sligo", "Tipperary",
  "Waterford", "Westmeath", "Wexford", "Wicklow",
] as const;

const roleLabels = [
  "Applicant", "Agent", "Architect", "Developer", "Contractor", "Planning Consultant",
] as const;

const dateLabels = {
  rfiPublished: ["RFI Published", "RFI Publication Date"],
  rfiReceived: ["RFI Received", "Further Information Requested", "Further Info Requested"],
  rfiDue: ["RFI Response Due", "RFI Deadline", "Further Information Due", "Further Info Due"],
  responseReceived: ["RFI Response Received", "Further Information Received", "Further Info Received"],
  planningReceived: ["Planning Received", "Application Received", "Received Date"],
  planningValidated: ["Planning Validated", "Application Validated", "Validated Date"],
  planningDecisionDue: ["Planning Decision Due", "Decision Due Date"],
} as const;

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanLine(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function lines(value: string) {
  return value.split(/\r?\n/).map(cleanLine).filter(Boolean);
}

export function normalizeBuildingInfoDate(value: string | undefined) {
  const input = cleanLine(value ?? "");
  if (!input) return "";
  const iso = input.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const local = input.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})\b/);
  if (local) return `${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : "";
}

export function assertBuildingInfoUrl(input: string, expectedHost = "app.buildinginfo.com") {
  const url = new URL(input);
  const host = url.hostname.toLowerCase();
  const required = expectedHost.toLowerCase();
  if (url.protocol !== "https:" || (host !== required && !host.endsWith(`.${required}`))) {
    throw new Error(`Refusing non-BuildingInfo browser URL: ${url.origin}`);
  }
  url.hash = "";
  return url.toString();
}

export function parseBuildingInfoResultCount(text: string) {
  const match = normalizeText(text).match(/\b([\d,]+)\s+of\s+([\d,]+)\s+Projects?\b/i);
  if (!match) return undefined;
  return {
    loaded: Number.parseInt(match[1].replaceAll(",", ""), 10),
    total: Number.parseInt(match[2].replaceAll(",", ""), 10),
  };
}

function labelledValue(text: string, labels: readonly string[]) {
  for (const label of labels) {
    const pattern = new RegExp(`(?:^|\\n)\\s*${escapeRegex(label)}\\s*:?\\s*([^\\n]+)`, "i");
    const match = text.match(pattern);
    if (match) return cleanLine(match[1]);
  }
  return "";
}

function labelledDate(text: string, labels: readonly string[]) {
  return normalizeBuildingInfoDate(labelledValue(text, labels));
}

function contextAroundAcousticTerms(text: string, maximum = 1_500) {
  const normalized = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  const termPattern = new RegExp(`\\b(?:${acousticKeywords.map(escapeRegex).join("|")}|decibels?|dB|hearing|BNS)\\b`, "i");
  const match = termPattern.exec(normalized);
  if (!match) return "";
  const start = Math.max(0, match.index - 500);
  const end = Math.min(normalized.length, match.index + maximum - 500);
  return cleanLine(normalized.slice(start, end));
}

function projectId(snapshot: BuildingInfoBrowserSnapshot) {
  const text = `${snapshot.heading ?? ""}\n${snapshot.pageTitle ?? ""}\n${snapshot.bodyText}`;
  return text.match(/\bProject\s*ID\s*:?\s*(\d{4,})\b/i)?.[1]
    ?? text.match(/\((\d{4,})\)/)?.[1]
    ?? text.match(/\b(?:Project|Planning)\s*(?:Ref(?:erence)?|Number)\s*:?\s*([A-Z0-9/\-]{4,})\b/i)?.[1]
    ?? "";
}

function title(snapshot: BuildingInfoBrowserSnapshot) {
  const heading = cleanLine(snapshot.heading ?? "");
  if (heading && !/^BuildingInfo$/i.test(heading)) return heading.replace(/\s*\(\d{4,}\)\s*$/, "");
  const pageTitle = cleanLine(snapshot.pageTitle ?? "").replace(/\s*[|\-]\s*BuildingInfo.*$/i, "");
  if (pageTitle && !/^BuildingInfo$/i.test(pageTitle)) return pageTitle;
  return lines(snapshot.bodyText).find((line) => /(?:€|£)[\d,.]+|Development|Project|Tender/i.test(line)) ?? "";
}

function county(text: string) {
  return countyNames.find((name) => new RegExp(`\\b(?:Co\\.?\\s*)?${escapeRegex(name)}\\b`, "i").test(text)) ?? "";
}

function projectValue(text: string) {
  const match = text.match(/[€£]\s*([\d,.]+)\s*([mkb])?\b/i);
  if (!match) return "";
  const amount = Number.parseFloat(match[1].replaceAll(",", ""));
  if (!Number.isFinite(amount)) return "";
  const multiplier = match[2]?.toLowerCase() === "b" ? 1_000_000_000
    : match[2]?.toLowerCase() === "m" ? 1_000_000
      : match[2]?.toLowerCase() === "k" ? 1_000 : 1;
  return String(amount * multiplier);
}

function blockAfterRole(text: string, label: typeof roleLabels[number]) {
  const all = lines(text);
  const index = all.findIndex((line) => new RegExp(`^${escapeRegex(label)}\\s*:?$`, "i").test(line));
  if (index < 0) return [];
  const block: string[] = [];
  for (const line of all.slice(index + 1, index + 10)) {
    if (roleLabels.some((role) => new RegExp(`^${escapeRegex(role)}\\s*:?$`, "i").test(line))) break;
    block.push(line);
  }
  return block;
}

function roleFields(text: string, label: typeof roleLabels[number]) {
  const block = blockAfterRole(text, label);
  const email = block.join(" ").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const phone = block.find((line) => /(?:\+?353|\b0\d)[\d\s()-]{6,}/.test(line))?.match(/(?:\+?353|\b0\d)[\d\s()-]{6,}/)?.[0]?.trim() ?? "";
  const descriptive = block.filter((line) => !line.includes("@") && !/(?:\+?353|\b0\d)[\d\s()-]{6,}/.test(line) && !/^https?:|^www\./i.test(line));
  return {
    organisation: descriptive[0] ?? "",
    contact: descriptive[1] ?? "",
    email,
    phone,
  };
}

function evidenceLink(links: BuildingInfoBrowserLink[] | undefined, fallback: string) {
  const valid = (links ?? []).flatMap((link) => {
    try {
      return [{ ...link, href: new URL(link.href, fallback).toString() }];
    } catch {
      return [];
    }
  });
  return valid.find((link) => /noise|sound|acoustic|vibration|decibel|\.pdf\b/i.test(`${link.text} ${link.href}`))?.href
    ?? valid.find((link) => /document|report|condition|further.?information/i.test(`${link.text} ${link.href}`))?.href
    ?? fallback;
}

function stage(text: string) {
  return labelledValue(text, ["Stage", "Project Stage", "Planning Status", "Status"])
    || (text.match(/\b(Further Information Requested|Plans Granted|Plans Applied|Pre[- ]planning|Commencement|Tender)\b/i)?.[1] ?? "");
}

function sector(text: string) {
  return labelledValue(text, ["Sector", "Category", "Project Sector"]);
}

function applicationReference(text: string) {
  return labelledValue(text, ["Planning Reference", "Planning Ref", "Application Number", "Project Ref"]);
}

function planningAuthority(text: string) {
  return labelledValue(text, ["Planning Authority", "Council", "Local Authority"]);
}

export function buildingInfoProjectCategory(snapshot: BuildingInfoBrowserSnapshot) {
  const text = snapshot.bodyText;
  const evidence = contextAroundAcousticTerms(text);
  const hasAcousticEvidence = matchedAcousticTerms(evidence).length > 0 || /\b(?:decibels?|dB|hearing|BNS)\b/i.test(evidence);
  const rfi = /\b(?:RFI|Further Information (?:Request(?:ed)?|Required))\b/i.test(text);
  const responseReceived = /\bFurther Information (?:Response )?Received\b/i.test(text)
    || Boolean(labelledDate(text, dateLabels.responseReceived));
  const granted = /\b(?:Plans? Granted|Permission Granted|Grant of Permission|Granted with Conditions)\b/i.test(text);
  if (rfi && hasAcousticEvidence) return responseReceived ? "fulfilled-rfi" : "acoustic-rfi";
  if (granted && hasAcousticEvidence) return "acoustic-grant";
  if (hasAcousticEvidence) return "potential-acoustic";
  return "not-acoustic";
}

export function extractBuildingInfoBrowserRow(snapshot: BuildingInfoBrowserSnapshot) {
  const url = assertBuildingInfoUrl(snapshot.projectUrl);
  const bodyText = snapshot.bodyText.replace(/\r/g, "");
  const id = projectId(snapshot);
  const projectTitle = title(snapshot);
  const projectCounty = county(`${projectTitle}\n${bodyText}`);
  if (!id || !projectTitle || !projectCounty) return undefined;
  const evidenceExcerpt = contextAroundAcousticTerms(bodyText)
    || cleanLine(labelledValue(bodyText, ["Description", "Project Description"]) || projectTitle);
  const category = buildingInfoProjectCategory(snapshot);
  const projectStage = stage(bodyText);
  const evidenceUrl = evidenceLink(snapshot.links, url);
  const observed = normalizeBuildingInfoDate(snapshot.observedAt) || new Date().toISOString().slice(0, 10);
  const applicant = roleFields(bodyText, "Applicant");
  const architect = roleFields(bodyText, "Architect");
  const developer = roleFields(bodyText, "Developer");
  const contractor = roleFields(bodyText, "Contractor");
  const consultant = roleFields(bodyText, "Planning Consultant");
  const rfiPublished = labelledDate(bodyText, dateLabels.rfiPublished);
  const rfiReceived = labelledDate(bodyText, dateLabels.rfiReceived);
  const rfiDue = labelledDate(bodyText, dateLabels.rfiDue);
  const responseReceived = labelledDate(bodyText, dateLabels.responseReceived);
  return {
    building_info_project_id: id,
    project_title: projectTitle,
    county: projectCounty,
    project_url: url,
    trigger_type: category === "acoustic-rfi" || category === "fulfilled-rfi" ? "Further Information Requested"
      : category === "acoustic-grant" ? "Permission Granted with Acoustic Conditions"
        : "Potential Acoustic Fit",
    evidence_document: evidenceUrl === url ? "BuildingInfo project detail" : "BuildingInfo linked evidence document",
    evidence_excerpt: evidenceExcerpt,
    evidence_document_url: evidenceUrl,
    project_stage: projectStage,
    sector: sector(bodyText),
    project_value: projectValue(`${projectTitle}\n${bodyText}`),
    planning_reference: applicationReference(bodyText),
    planning_authority: planningAuthority(bodyText),
    site_address: labelledValue(bodyText, ["Site Address", "Address", "Location"]),
    rfi_published_date: rfiPublished,
    rfi_received_date: rfiReceived,
    rfi_response_due_date: rfiDue,
    rfi_response_received_date: responseReceived,
    planning_received_date: labelledDate(bodyText, dateLabels.planningReceived),
    planning_validated_date: labelledDate(bodyText, dateLabels.planningValidated),
    planning_decision_due_date: labelledDate(bodyText, dateLabels.planningDecisionDue),
    last_updated: observed,
    applicant: applicant.organisation,
    applicant_contact: applicant.contact,
    applicant_email: applicant.email,
    applicant_phone: applicant.phone,
    architect: architect.organisation,
    architect_contact: architect.contact,
    architect_email: architect.email,
    architect_phone: architect.phone,
    developer: developer.organisation,
    developer_contact: developer.contact,
    developer_email: developer.email,
    developer_phone: developer.phone,
    contractor: contractor.organisation,
    contractor_contact: contractor.contact,
    contractor_email: contractor.email,
    contractor_phone: contractor.phone,
    planning_consultant: consultant.organisation,
    planning_consultant_contact: consultant.contact,
    planning_consultant_email: consultant.email,
    planning_consultant_phone: consultant.phone,
    source_search_name: snapshot.searchProfile ?? "iAcoustics acoustic opportunity watch",
  } satisfies BuildingInfoBrowserRow;
}

export function isCurrentBuildingInfoBrowserTarget(
  row: BuildingInfoBrowserRow,
  category: ReturnType<typeof buildingInfoProjectCategory>,
  now = new Date(),
  includePotential = false,
) {
  if (category === "fulfilled-rfi" || category === "not-acoustic") return false;
  if (category === "potential-acoustic") return includePotential;
  if (category === "acoustic-grant") return true;
  const due = Date.parse(row.rfi_response_due_date || "");
  return !Number.isFinite(due) || due >= new Date(now.toISOString().slice(0, 10)).getTime();
}

export const BUILDINGINFO_BROWSER_CSV_HEADERS = [
  "building_info_project_id", "project_title", "county", "project_url", "trigger_type",
  "evidence_document", "evidence_excerpt", "evidence_document_url", "project_stage", "sector",
  "project_value", "planning_reference", "planning_authority", "site_address",
  "rfi_published_date", "rfi_received_date", "rfi_response_due_date", "rfi_response_received_date",
  "planning_received_date", "planning_validated_date", "planning_decision_due_date", "last_updated",
  "applicant", "applicant_contact", "applicant_email", "applicant_phone",
  "architect", "architect_contact", "architect_email", "architect_phone",
  "developer", "developer_contact", "developer_email", "developer_phone",
  "contractor", "contractor_contact", "contractor_email", "contractor_phone",
  "planning_consultant", "planning_consultant_contact", "planning_consultant_email",
  "planning_consultant_phone", "source_search_name",
] as const;

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function buildingInfoBrowserRowsToCsv(rows: BuildingInfoBrowserRow[]) {
  return [
    BUILDINGINFO_BROWSER_CSV_HEADERS.join(","),
    ...rows.map((row) => BUILDINGINFO_BROWSER_CSV_HEADERS.map((header) => csvCell(row[header] ?? "")).join(",")),
  ].join("\r\n") + "\r\n";
}
