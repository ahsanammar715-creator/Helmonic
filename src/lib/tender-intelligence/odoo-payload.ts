import type { TenderOpportunity } from "./types.ts";

export type OdooLeadDryRun = {
  operation: "upsert";
  matchField: "x_helmonic_external_id";
  matchValue: string;
  values: {
    name: string;
    description: string;
    x_helmonic_external_id: string;
    x_pipeline_bucket: string;
    x_lead_quality: string;
    x_evidence_status: string;
    x_classification: string;
    x_source_systems: string;
    x_source_record_ids: string;
    x_source_urls: string;
    x_evidence_excerpt: string;
    x_source_published_at: string | false;
    x_source_updated_at: string | false;
    x_source_major_updated_at: string | false;
    x_source_age_days: number | false;
    x_freshness_band: string;
    x_deadline: string | false;
    x_assigned_person: string;
    x_warm_connection_verified: boolean;
    x_routing_reason: string;
    x_deduplication_status: string;
    x_possible_duplicate_ids: string;
    x_project_value: number | false;
    x_project_units: number | false;
    x_project_stage: string;
    x_opportunity_type: string;
    x_location: string;
    x_planning_authority: string;
    x_project_reference: string;
    x_applicant: string;
    x_party_details: string;
    x_cpv_codes: string;
    x_matched_terms: string;
    x_evidence_document_urls: string;
    x_residential_scale: string;
    x_first_seen_at: string | false;
    x_last_seen_at: string | false;
    x_last_confirmed_at: string | false;
    x_cycle_status: string;
    x_scope_status: string;
  };
};

function actionableDeadline(record: TenderOpportunity) {
  if (record.classification === "noise-related-rfi") return record.responseDeadline ?? "";
  if (record.type === "formal-public-tender") return record.deadline ?? "";
  return "";
}

function odooDatetime(value?: string) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function ownerDisplayName(record: TenderOpportunity) {
  if (record.routedTo === "Glen") return "Glen Plunkett";
  if (record.routedTo === "Owen") return "Eoghan Tyrrell";
  return "";
}

function partyDetails(record: TenderOpportunity) {
  return (record.parties ?? []).map((party) => [
    party.role,
    party.name,
    party.organisation,
    party.email,
    party.phone,
  ].filter(Boolean).join(" | ")).join("\n");
}

function evidenceDocumentUrls(record: TenderOpportunity) {
  return [...new Set((record.evidenceDocuments ?? [])
    .map((document) => document.sourceUrl)
    .filter(Boolean))].join("\n");
}

function verifiedWarmConnection(record: TenderOpportunity) {
  return /^exact-party-match-supported-by-(?:glen|owen)-email-evidence$/i.test(record.routingReason ?? "");
}

function sourceValues(record: TenderOpportunity) {
  const sources = record.duplicateSources?.length ? record.duplicateSources : [{
    id: record.id,
    sourceSystem: record.sourceSystem,
    sourceRecordId: record.sourceRecordId,
    sourceUrl: record.sourceUrl,
    evidenceStatus: record.evidenceStatus,
  }];
  return {
    systems: [...new Set(sources.map((source) => source.sourceSystem))].join("; "),
    recordIds: sources.map((source) => `${source.sourceSystem}:${source.sourceRecordId}`).join("; "),
    urls: [...new Set(sources.map((source) => source.sourceUrl).filter(Boolean))].join("\n"),
  };
}

function description(record: TenderOpportunity) {
  return [
    record.description,
    `Qualification: ${record.qualificationReason ?? "Not yet commercially graded."}`,
    `Freshness: ${record.freshnessReason ?? "Source publication date unavailable."}`,
    `Evidence: ${record.evidenceExcerpt ?? "No exact excerpt retained; observe the evidence-status field before outreach."}`,
    `Routing: ${record.routingReason ?? "No owner route assigned."}`,
  ].filter(Boolean).join("\n\n");
}

export function buildOdooDryRun(records: TenderOpportunity[]) {
  const payloads: OdooLeadDryRun[] = [];
  for (const record of records) {
    if (record.deduplicationStatus === "duplicate") continue;
    const externalId = record.crmExternalId;
    if (!externalId) throw new Error(`Record ${record.id} has no stable CRM external ID.`);
    const sources = sourceValues(record);
    payloads.push({
      operation: "upsert",
      matchField: "x_helmonic_external_id",
      matchValue: externalId,
      values: {
        name: record.title,
        description: description(record),
        x_helmonic_external_id: externalId,
        x_pipeline_bucket: record.leadDisposition ?? "monitor",
        x_lead_quality: record.leadQuality ?? "medium",
        x_evidence_status: record.evidenceStatus,
        x_classification: record.classification ?? record.type,
        x_source_systems: sources.systems,
        x_source_record_ids: sources.recordIds,
        x_source_urls: sources.urls,
        x_evidence_excerpt: record.evidenceExcerpt ?? "",
        x_source_published_at: odooDatetime(record.publishedAt),
        x_source_updated_at: odooDatetime(record.sourceUpdatedAt),
        x_source_major_updated_at: odooDatetime(record.sourceMajorUpdatedAt),
        x_source_age_days: Number.isFinite(record.sourceAgeDays) ? record.sourceAgeDays! : false,
        x_freshness_band: record.leadFreshness ?? "date-unknown",
        x_deadline: odooDatetime(actionableDeadline(record)),
        x_assigned_person: ownerDisplayName(record),
        x_warm_connection_verified: verifiedWarmConnection(record),
        x_routing_reason: record.routingReason ?? "",
        x_deduplication_status: record.deduplicationStatus ?? "unique",
        x_possible_duplicate_ids: (record.possibleDuplicateIds ?? []).join(";"),
        x_project_value: Number.isFinite(record.projectValue) ? record.projectValue! : false,
        x_project_units: Number.isFinite(record.projectUnits)
          ? record.projectUnits!
          : Number.isFinite(record.residentialUnitCount) ? record.residentialUnitCount! : false,
        x_project_stage: record.projectStage ?? record.sourceStatus ?? "",
        x_opportunity_type: record.type,
        x_location: record.location ?? "",
        x_planning_authority: record.planningAuthority ?? "",
        x_project_reference: record.projectReference ?? "",
        x_applicant: record.applicant ?? "",
        x_party_details: partyDetails(record),
        x_cpv_codes: record.cpvCodes.join("; "),
        x_matched_terms: record.matchedTerms.join("; "),
        x_evidence_document_urls: evidenceDocumentUrls(record),
        x_residential_scale: record.residentialScale ?? "",
        x_first_seen_at: odooDatetime(record.firstSeenAt),
        x_last_seen_at: odooDatetime(record.lastSeenAt),
        x_last_confirmed_at: odooDatetime(record.lastConfirmedAt),
        x_cycle_status: record.cycleStatus ?? "",
        x_scope_status: record.scopeStatus ?? "unknown",
      },
    });
  }

  const externalIds = payloads.map((payload) => payload.matchValue);
  if (new Set(externalIds).size !== externalIds.length) {
    throw new Error("Odoo dry-run contains duplicate x_helmonic_external_id values.");
  }
  return payloads.sort((left, right) => left.matchValue.localeCompare(right.matchValue));
}

export function summarizeOdooDryRun(payloads: OdooLeadDryRun[]) {
  const count = (field: keyof OdooLeadDryRun["values"], value: unknown) =>
    payloads.filter((payload) => payload.values[field] === value).length;
  return {
    upserts: payloads.length,
    uniqueExternalIds: new Set(payloads.map((payload) => payload.matchValue)).size,
    active: count("x_pipeline_bucket", "active"),
    nurture: count("x_pipeline_bucket", "nurture"),
    monitor: count("x_pipeline_bucket", "monitor"),
    background: count("x_pipeline_bucket", "background"),
    excellent: count("x_lead_quality", "excellent"),
    good: count("x_lead_quality", "good"),
    medium: count("x_lead_quality", "medium"),
    poor: count("x_lead_quality", "poor"),
    closedBackground: count("x_lead_quality", "closed-background"),
    verifiedWarmConnections: count("x_warm_connection_verified", true),
    withActionableDeadline: payloads.filter((payload) => Boolean(payload.values.x_deadline)).length,
    evidenceUnavailable: count("x_evidence_status", "evidence-unavailable"),
    discoveryOnly: count("x_evidence_status", "discovery-only"),
    officialText: count("x_evidence_status", "official-text"),
  };
}

const validationQualityRank: Record<string, number> = {
  excellent: 0,
  good: 1,
  medium: 2,
};

const validationBucketRank: Record<string, number> = {
  active: 0,
  nurture: 1,
  monitor: 2,
};

/**
 * Select one conservative, evidence-backed record for the isolated Odoo test.
 * This deliberately excludes discovery-only, unverified, out-of-region and
 * background records so a validation run can never fan out into a bulk sync.
 */
export function selectOdooValidationLead(payloads: OdooLeadDryRun[]) {
  const eligible = payloads.filter((payload) => {
    const values = payload.values;
    const excerpt = values.x_evidence_excerpt.trim();
    return values.x_evidence_status === "official-text"
      && values.x_scope_status === "eligible"
      && excerpt.length >= 40
      && !/^(?:false|none|n\/?a|not available|unavailable)$/i.test(excerpt)
      && /\b(?:acoustic|noise|sound|vibration|reverberation|airborne|impact)\b/i.test(excerpt)
      && Object.hasOwn(validationQualityRank, values.x_lead_quality)
      && Object.hasOwn(validationBucketRank, values.x_pipeline_bucket);
  });
  if (eligible.length === 0) {
    throw new Error("No in-scope, official-evidence lead is eligible for the one-record Odoo validation.");
  }
  return [...eligible].sort((left, right) => {
    const leftValues = left.values;
    const rightValues = right.values;
    return validationQualityRank[leftValues.x_lead_quality] - validationQualityRank[rightValues.x_lead_quality]
      || validationBucketRank[leftValues.x_pipeline_bucket] - validationBucketRank[rightValues.x_pipeline_bucket]
      || (typeof leftValues.x_source_age_days === "number" ? leftValues.x_source_age_days : Number.MAX_SAFE_INTEGER)
        - (typeof rightValues.x_source_age_days === "number" ? rightValues.x_source_age_days : Number.MAX_SAFE_INTEGER)
      || left.matchValue.localeCompare(right.matchValue);
  })[0];
}
