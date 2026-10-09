import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parseCsvStrict, pick } from "./csv.ts";
import {
  classifyPlanningEvidence,
  matchedAcousticTerms,
  normalizeText,
  scoreOpportunity,
  stableOpportunityId,
} from "./policy.ts";
import type {
  LeadParty,
  PlanningClassification,
  PlanningDocumentEvidence,
  TenderOpportunity,
} from "./types.ts";

export type BuildingInfoCsvConfig = {
  enabled: boolean;
  directory?: string;
  maxFiles?: number;
  maxFileBytes?: number;
};

const headers = {
  projectId: ["building_info_project_id", "buildinginfo_project_id", "building info project id", "project_id", "project id", "planning_id", "id"],
  projectTitle: ["project_title", "project title", "project_name", "project name", "planning_title", "title"],
  county: ["county", "project_county", "project county", "planning_county"],
  projectUrl: ["project_url", "project url", "buildinginfo_url", "buildinginfo url", "building info url", "planning_url", "url", "link"],
  triggerType: ["trigger_type", "trigger type", "lead_trigger", "lead trigger", "request_type", "request type"],
  evidenceDocument: ["evidence_document", "evidence document", "evidence_document_name", "evidence document name", "document_name", "document name", "document", "filename"],
  evidenceExcerpt: ["evidence_excerpt", "evidence excerpt", "matched_text", "matched text", "acoustic_evidence", "acoustic evidence", "excerpt", "evidence"],
} as const;

const requiredHeaders = Object.entries(headers) as Array<[keyof typeof headers, readonly string[]]>;

function normalizedHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function assertRequiredHeaders(row: Record<string, string>, sourceName: string) {
  const available = new Set(Object.keys(row).map(normalizedHeader));
  const missing = requiredHeaders
    .filter(([, aliases]) => !aliases.some((alias) => available.has(normalizedHeader(alias))))
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`${sourceName} is missing required BuildingInfo CSV columns: ${missing.join(", ")}.`);
  }
}

function value(row: Record<string, string>, aliases: readonly string[]) {
  return normalizeText(pick(row, [...aliases]));
}

function optionalValue(row: Record<string, string>, aliases: string[]) {
  return normalizeText(pick(row, aliases));
}

function requiredValue(
  row: Record<string, string>,
  aliases: readonly string[],
  label: string,
  sourceName: string,
  rowNumber: number,
) {
  const result = value(row, aliases);
  if (!result) throw new Error(`${sourceName} row ${rowNumber} has no ${label}.`);
  return result;
}

function validHttpUrl(input: string, label: string, sourceName: string, rowNumber: number) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`${sourceName} row ${rowNumber} has an invalid ${label}.`);
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error(`${sourceName} row ${rowNumber} ${label} must use HTTPS or HTTP.`);
  }
  return url.toString();
}

function numericValue(row: Record<string, string>, aliases: string[]) {
  const input = optionalValue(row, aliases).replace(/[€,£,\s]/g, "");
  if (!input) return undefined;
  const parsed = Number.parseFloat(input);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function party(
  row: Record<string, string>,
  role: LeadParty["role"],
  organisationAliases: string[],
  contactAliases: string[],
  emailAliases: string[],
  phoneAliases: string[],
): LeadParty | undefined {
  const organisation = optionalValue(row, organisationAliases);
  const contact = optionalValue(row, contactAliases);
  const email = optionalValue(row, emailAliases);
  const phone = optionalValue(row, phoneAliases);
  if (!organisation && !contact && !email && !phone) return undefined;
  return {
    name: contact || organisation || email || phone,
    role,
    organisation: organisation || undefined,
    email: email || undefined,
    phone: phone || undefined,
  } satisfies LeadParty;
}

function partiesFromRow(row: Record<string, string>) {
  return [
    party(row, "applicant", ["applicant", "applicant_name", "applicant organisation"], ["applicant_contact", "applicant contact"], ["applicant_email", "applicant email"], ["applicant_phone", "applicant phone"]),
    party(row, "agent", ["agent", "agent_name", "agent organisation"], ["agent_contact", "agent contact"], ["agent_email", "agent email"], ["agent_phone", "agent phone"]),
    party(row, "architect", ["architect", "architect_name", "architect company", "architect organisation"], ["architect_contact", "architect contact"], ["architect_email", "architect email"], ["architect_phone", "architect phone"]),
    party(row, "developer", ["developer", "developer_name", "developer company", "developer organisation"], ["developer_contact", "developer contact"], ["developer_email", "developer email"], ["developer_phone", "developer phone"]),
    party(row, "contractor", ["contractor", "contractor_name", "main contractor", "contractor company"], ["contractor_contact", "contractor contact"], ["contractor_email", "contractor email"], ["contractor_phone", "contractor phone"]),
    party(row, "consultant", ["planning_consultant", "planning consultant", "planning consultant company"], ["planning_consultant_contact", "planning consultant contact"], ["planning_consultant_email", "planning consultant email"], ["planning_consultant_phone", "planning consultant phone"]),
  ].filter((entry): entry is LeadParty => Boolean(entry));
}

function evidenceStatus(excerpt: string) {
  return matchedAcousticTerms(excerpt).length > 0 ? "official-text" as const : "discovery-only" as const;
}

function evidenceDocument(input: {
  projectId: string;
  name: string;
  excerpt: string;
  url: string;
  updatedAt?: string;
  classification: PlanningClassification;
}): PlanningDocumentEvidence {
  return {
    id: stableOpportunityId("BuildingInfo-evidence", input.projectId, input.name, input.excerpt),
    documentType: "BuildingInfo matched planning document",
    description: input.name,
    receivedAt: input.updatedAt,
    sourceUrl: input.url,
    fetchStatus: "fetched",
    matchedTerms: matchedAcousticTerms(input.excerpt),
    excerpt: input.excerpt,
    classification: input.classification,
  };
}

export function parseBuildingInfoCsv(text: string, sourceName = "BuildingInfo CSV") {
  const rows = parseCsvStrict(text);
  if (rows.length === 0) throw new Error(`${sourceName} contains headers but no data rows.`);
  assertRequiredHeaders(rows[0], sourceName);
  return rows.map((row, index) => {
    const rowNumber = index + 2;
    const projectId = requiredValue(row, headers.projectId, "BuildingInfo project ID", sourceName, rowNumber);
    const title = requiredValue(row, headers.projectTitle, "project title", sourceName, rowNumber);
    const county = requiredValue(row, headers.county, "county", sourceName, rowNumber);
    const projectUrl = validHttpUrl(
      requiredValue(row, headers.projectUrl, "project URL", sourceName, rowNumber),
      "project URL",
      sourceName,
      rowNumber,
    );
    const triggerType = requiredValue(row, headers.triggerType, "trigger type", sourceName, rowNumber);
    const documentName = requiredValue(row, headers.evidenceDocument, "evidence document name", sourceName, rowNumber);
    const excerpt = requiredValue(row, headers.evidenceExcerpt, "evidence excerpt", sourceName, rowNumber);
    const documentUrlInput = optionalValue(row, ["evidence_document_url", "evidence document url", "document_url", "document url"]);
    const documentUrl = documentUrlInput
      ? validHttpUrl(documentUrlInput, "evidence document URL", sourceName, rowNumber)
      : projectUrl;
    const stage = optionalValue(row, ["project_stage", "project stage", "planning_stage", "stage", "status"]);
    const sector = optionalValue(row, ["sector", "project_sector", "project sector", "planning_category", "category"]);
    const projectType = optionalValue(row, ["project_type", "project type", "planning_type", "type"]);
    const descriptionInput = optionalValue(row, ["project_description", "project description", "planning_description", "description"]);
    const units = numericValue(row, ["unit_count", "unit count", "project_units", "project units", "planning_units", "units"]);
    const projectValue = numericValue(row, ["project_value", "project value", "planning_value", "value"]);
    const description = [
      descriptionInput,
      sector && `Sector: ${sector}`,
      projectType && `Type: ${projectType}`,
      stage && `Stage: ${stage}`,
      units !== undefined && `Units: ${units}`,
      projectValue !== undefined && `Value: ${projectValue}`,
    ].filter(Boolean).join("\n");
    const classification = classifyPlanningEvidence({
      stage: `${triggerType} ${stage}`,
      evidenceText: excerpt,
      description: `${title} ${description}`,
      evidenceUrl: documentUrl,
    });
    const updatedAt = optionalValue(row, ["last_updated", "last updated", "source_updated_at", "source updated at", "api_date"]);
    const partyRows = partiesFromRow(row);
    const opportunity: TenderOpportunity = {
      id: stableOpportunityId("BuildingInfo", projectId),
      type: "planning-pipeline-lead",
      sourceSystem: "BuildingInfo",
      sourceRecordId: projectId,
      projectReference: optionalValue(row, ["planning_reference", "planning reference", "planning_number", "planning number", "application_number", "application number"]) || projectId,
      planningAuthority: optionalValue(row, ["planning_authority", "planning authority", "council_name", "council", "local authority"]) || undefined,
      applicant: partyRows.find((entry) => entry.role === "applicant")?.organisation,
      parties: partyRows,
      title,
      description,
      location: optionalValue(row, ["site_address", "site address", "project_address", "project address", "address"]) || county,
      publishedAt: optionalValue(row, ["application_date", "application date", "published_at", "published at", "first_seen", "first seen"]) || undefined,
      sourceUpdatedAt: updatedAt || undefined,
      sourceMajorUpdatedAt: optionalValue(row, ["rfi_date", "rfi date", "trigger_date", "trigger date", "major_update_date", "major update date"]) || undefined,
      deadline: optionalValue(row, ["planning_deadline", "planning deadline", "decision_due_date", "decision due date"]) || undefined,
      responseDeadline: optionalValue(row, ["rfi_deadline", "rfi deadline", "response_deadline", "response deadline", "deadline"]) || undefined,
      sourceUrl: projectUrl,
      evidenceStatus: evidenceStatus(excerpt),
      evidenceExcerpt: excerpt,
      evidenceDocuments: [evidenceDocument({
        projectId,
        name: documentName,
        excerpt,
        url: documentUrl,
        updatedAt: updatedAt || undefined,
        classification,
      })],
      classification,
      cpvCodes: [],
      matchedTerms: matchedAcousticTerms(title, description, excerpt),
      fitScore: 0,
      sourceStatus: optionalValue(row, ["source_status", "source status", "status", "project_status", "project status"]) || stage || undefined,
      projectStage: stage || undefined,
      projectSector: sector || undefined,
      triggerType,
      projectValue,
      projectUnits: units,
    };
    opportunity.fitScore = scoreOpportunity(opportunity);
    return opportunity;
  });
}

function timestamp(value: string | undefined) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function partyKey(entry: LeadParty) {
  return [entry.role, entry.name, entry.organisation, entry.email, entry.phone]
    .map((part) => normalizeText(part).toLowerCase())
    .join("|");
}

const classificationPriority: Record<PlanningClassification, number> = {
  "noise-related-rfi": 6,
  "granted-with-noise-conditions": 5,
  "refused-on-noise-grounds": 4,
  "design-construction-potential": 3,
  "needs-council-evidence": 2,
  "no-relevant-opportunity": 1,
};

export function mergeBuildingInfoCsvRecords(records: TenderOpportunity[]) {
  const grouped = new Map<string, TenderOpportunity[]>();
  for (const record of records) {
    grouped.set(record.sourceRecordId, [...(grouped.get(record.sourceRecordId) ?? []), record]);
  }
  return [...grouped.values()].map((group) => {
    const ordered = [...group].sort((left, right) =>
      timestamp(left.sourceUpdatedAt ?? left.sourceMajorUpdatedAt ?? left.publishedAt)
      - timestamp(right.sourceUpdatedAt ?? right.sourceMajorUpdatedAt ?? right.publishedAt));
    const latest = ordered.at(-1)!;
    const documents = new Map<string, PlanningDocumentEvidence>();
    const parties = new Map<string, LeadParty>();
    for (const record of ordered) {
      for (const document of record.evidenceDocuments ?? []) documents.set(document.id, document);
      for (const entry of record.parties ?? []) parties.set(partyKey(entry), entry);
    }
    const classifications = ordered.map((record) => record.classification).filter((item): item is PlanningClassification => Boolean(item));
    const classification = classifications.sort((left, right) => classificationPriority[right] - classificationPriority[left])[0];
    const excerpts = [...documents.values()].map((document) => document.excerpt).filter(Boolean) as string[];
    const merged: TenderOpportunity = {
      ...latest,
      evidenceStatus: ordered.some((record) => record.evidenceStatus === "official-text") ? "official-text" : "discovery-only",
      evidenceExcerpt: [...new Set(excerpts)].join("\n\n") || latest.evidenceExcerpt,
      evidenceDocuments: [...documents.values()],
      classification,
      parties: [...parties.values()],
      matchedTerms: [...new Set(ordered.flatMap((record) => record.matchedTerms))],
      responseDeadline: [...ordered].reverse().map((record) => record.responseDeadline).find(Boolean),
    };
    merged.fitScore = scoreOpportunity(merged);
    return merged;
  }).sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId));
}

export async function collectBuildingInfoCsvProjects(config: BuildingInfoCsvConfig) {
  if (!config.directory) throw new Error("BuildingInfo CSV intake is enabled but no directory is configured.");
  const maxFiles = Math.max(1, config.maxFiles ?? 1_000);
  const maxFileBytes = Math.max(1, config.maxFileBytes ?? 5 * 1024 * 1024);
  const entries = await readdir(config.directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) throw new Error("BuildingInfo CSV intake is enabled but no CSV files were found.");
  if (files.length > maxFiles) {
    throw new Error(`BuildingInfo CSV intake found ${files.length} files; configured maximum is ${maxFiles}.`);
  }
  const rows: TenderOpportunity[] = [];
  for (const file of files) {
    const content = await readFile(path.join(config.directory, file));
    if (content.byteLength > maxFileBytes) {
      throw new Error(`${file} is ${content.byteLength} bytes; configured maximum is ${maxFileBytes}.`);
    }
    rows.push(...parseBuildingInfoCsv(content.toString("utf8"), file));
  }
  const records = mergeBuildingInfoCsvRecords(rows);
  return {
    records,
    importedFiles: files.length,
    scannedRecords: rows.length,
    duplicatesCollapsed: rows.length - records.length,
  };
}
