import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

import {
  buildPlanningLeadsSearchUrls,
  buildNationalPlanningWhere,
  buildTedSearchRequest,
  collectNationalPlanningFeatures,
  collectTedOpportunities,
  countDccWeeklyApplications,
  filterRecentPlanningLeads,
  parseDccPlanningCsv,
  parseDccWeeklyDocumentLinks,
  parseDccWeeklyDocx,
  parseEtendersCsv,
  parseNationalPlanningFeatures,
  parsePlanningLeads,
  parseTedNotices,
} from "../../src/lib/tender-intelligence/official-sources.ts";
import { classifyPlanningEvidence } from "../../src/lib/tender-intelligence/policy.ts";
import {
  classifyDccDocumentText,
  enrichDccPlanningOpportunity,
  extractRfiDocumentDates,
  isDccEvidenceDocument,
  parseDccDocumentIndex,
} from "../../src/lib/tender-intelligence/dcc-document-evidence.ts";
import {
  approvedCpvCodesFromOfficialNotice,
  enrichFormalTenderEvidence,
  textFromOfficialNoticeXml,
} from "../../src/lib/tender-intelligence/formal-document-evidence.ts";
import {
  enrichNationalPlanningOpportunity,
  parseEplanningDocumentRows,
} from "../../src/lib/tender-intelligence/national-planning-evidence.ts";
import {
  buildRelationshipLookup,
  routeOpportunityByRelationships,
  routeOpportunitiesByRelationships,
} from "../../src/lib/tender-intelligence/relationship-routing.ts";
import { loadSearchRelationshipLookup } from "../../src/lib/tender-intelligence/search-relationship-index.ts";
import { enrichWithHistoricalProjectMatches } from "../../src/lib/tender-intelligence/search-project-history.ts";
import {
  applyEvidenceRefresh,
  confirmedLedgerRecords,
  mergeCurrentSnapshotWithLedger,
  positiveResolution,
  routingMetadataWithDurablePrecedence,
} from "../../src/lib/tender-intelligence/carry-forward.ts";
import {
  applyTargetScope,
  approvedTenderBuyer,
  targetRegionStatus,
} from "../../src/lib/tender-intelligence/source-scope.ts";
import {
  annotateOpportunityDuplicates,
  deduplicationSummary,
} from "../../src/lib/tender-intelligence/deduplication.ts";
import {
  buildOdooDryRun,
  summarizeOdooDryRun,
} from "../../src/lib/tender-intelligence/odoo-payload.ts";
import {
  legacySourceReferenceInLeadReference,
  preflightOdoo,
  syncOdooLeads,
} from "../../src/lib/tender-intelligence/odoo-client.ts";
import { ODOO_TENDER_FIELD_TYPES } from "../../src/lib/tender-intelligence/odoo-field-contract.ts";
import {
  buildBuildingInfoPageUrl,
  collectBuildingInfoProjects,
  parseBuildingInfoProjects,
} from "../../src/lib/tender-intelligence/building-info.ts";
import {
  mergeBuildingInfoCsvRecords,
  parseBuildingInfoCsv,
} from "../../src/lib/tender-intelligence/building-info-csv.ts";
import {
  assessLeadFreshness,
  assessLeadQuality,
  freshnessPriority,
  qualifyLead,
  residentialUnitCount,
} from "../../src/lib/tender-intelligence/lead-qualification.ts";
import { xlsxFirstSheetToCsv } from "../../src/lib/tender-intelligence/xlsx.ts";
import { applyAppointmentSafeguards } from "../../src/lib/tender-intelligence/appointment-classification.ts";
import { BUILDINGINFO_NATIVE_SEARCH_PROFILE } from "../../src/lib/tender-intelligence/building-info-search-profile.ts";
import {
  assertBuildingInfoUrl,
  buildingInfoBrowserRowsToCsv,
  buildingInfoProjectCategory,
  extractBuildingInfoBrowserRow,
  isCurrentBuildingInfoBrowserTarget,
  normalizeBuildingInfoDate,
  parseBuildingInfoResultCount,
} from "../../src/lib/tender-intelligence/building-info-browser.ts";
import {
  genericPlanningPortalUrl,
  nationalPlanningProjectUrl,
} from "../../src/lib/tender-intelligence/project-links.ts";

function planningLead(overrides = {}) {
  return {
    id: "lead-1",
    type: "planning-pipeline-lead",
    sourceSystem: "DCC",
    sourceRecordId: "WEB-1",
    title: "Example project",
    description: "",
    sourceUrl: "https://example.test/project",
    evidenceStatus: "official-text",
    evidenceExcerpt: "The applicant shall submit a noise assessment for the proposed development.",
    classification: "design-construction-potential",
    cpvCodes: [],
    matchedTerms: ["noise"],
    fitScore: 60,
    ...overrides,
  };
}

test("residential commercial grading implements Eoghan's scale thresholds without discarding leads", () => {
  const lrd = assessLeadQuality(planningLead({ description: "Large Residential Development of 150 apartments" }));
  assert.equal(lrd.quality, "excellent");
  assert.equal(lrd.disposition, "nurture");
  assert.equal(lrd.scale, "lrd-100-plus");

  const partE = assessLeadQuality(planningLead({ description: "Construction of 12 no. apartments in an attached residential block" }));
  assert.equal(partE.quality, "good");
  assert.equal(partE.scale, "attached-4-plus");

  const oneOff = qualifyLead(planningLead({ description: "One-off house and domestic residential extension" }));
  assert.equal(oneOff.leadQuality, "poor");
  assert.equal(oneOff.leadDisposition, "background");
  assert.match(oneOff.qualificationReason, /retained/i);
});

test("four-unit rule requires an attachment signal while 100-plus is always ideal scale", () => {
  assert.equal(residentialUnitCount("Development of 4 no. dwellings"), 4);
  assert.equal(assessLeadQuality(planningLead({ description: "Development of 4 no. detached dwellings" })).quality, "medium");
  assert.equal(assessLeadQuality(planningLead({ description: "Development of 4 no. terraced dwellings" })).quality, "good");
  assert.equal(assessLeadQuality(planningLead({ description: "Development of 100 no. homes" })).quality, "excellent");
  assert.equal(assessLeadQuality(planningLead({ sourceRecordId: "WEBLRD9011/26-S3" })).quality, "excellent");
  assert.equal(assessLeadQuality(planningLead({ sourceRecordId: "Fingal County Council:LRD0066/S3E" })).quality, "excellent");
});

test("specific official acoustic requirements outrank project scale, while generic air and noise wording is lower weight", () => {
  const specific = assessLeadQuality(planningLead({
    classification: "granted-with-noise-conditions",
    description: "Single dwelling",
    evidenceExcerpt: "A suitably qualified acoustic consultant shall submit a noise impact assessment.",
  }));
  assert.equal(specific.quality, "excellent");
  assert.equal(specific.disposition, "active");

  const generic = assessLeadQuality(planningLead({
    classification: "granted-with-noise-conditions",
    evidenceExcerpt: "The applicant shall comply with the requirements of the Air Quality and Noise Section and codes of practice.",
  }));
  assert.equal(generic.quality, "medium");
  assert.equal(generic.disposition, "monitor");
});

test("closed leads remain retained as closed background records", () => {
  const assessed = assessLeadQuality(planningLead({ sourceStatus: "awarded" }));
  assert.equal(assessed.quality, "closed-background");
  assert.equal(assessed.disposition, "background");
});

test("explicit iAcoustics appointment is retained as already won and cold outreach is suppressed", () => {
  const [guarded] = applyAppointmentSafeguards(annotateOpportunityDuplicates([planningLead({
    evidenceExcerpt: "Integrated Acoustic Solutions Ltd has been appointed as the acoustic consultant for this development.",
  })]));
  const assessed = qualifyLead(guarded);
  assert.equal(assessed.acousticAppointmentStatus, "iacoustics-appointed");
  assert.equal(assessed.leadQuality, "existing-project");
  assert.equal(assessed.leadDisposition, "already-won");
  assert.equal(assessed.outreachEligibility, "suppressed-already-won");
  assert.equal(assessed.competitiveQuoteOpportunity, false);
  assert.match(assessed.outreachKey, /^planning-outreach:/);
});

test("an iAcoustics mention without explicit appointment is held for verification", () => {
  const [guarded] = applyAppointmentSafeguards(annotateOpportunityDuplicates([planningLead({
    evidenceExcerpt: "The applicant supplied an earlier iAcoustics report as background information.",
  })]));
  assert.equal(guarded.acousticAppointmentStatus, "needs-verification");
  assert.equal(guarded.outreachEligibility, "consultant-review");
  assert.equal(guarded.competitiveQuoteOpportunity, false);
});

test("an explicitly appointed competitor stays in the pipeline for a reviewed competitive quote", () => {
  const [guarded] = applyAppointmentSafeguards(annotateOpportunityDuplicates([planningLead({
    appointedAcoustician: "Example Noise Consultants Ltd",
    appointmentEvidenceExcerpt: "Example Noise Consultants Ltd has been appointed as acoustic consultant.",
  })]));
  assert.equal(guarded.acousticAppointmentStatus, "competitor-appointed");
  assert.equal(guarded.appointedAcoustician, "Example Noise Consultants Ltd");
  assert.equal(guarded.competitiveQuoteOpportunity, true);
  assert.equal(guarded.outreachEligibility, "consultant-review");
});

test("strict cross-source duplicates share one outreach guard and strongest appointment evidence", () => {
  const guarded = applyAppointmentSafeguards(annotateOpportunityDuplicates([
    planningLead({
      id: "bi-appointment",
      sourceSystem: "BuildingInfo",
      sourceRecordId: "424562",
      projectReference: "2660722",
      planningAuthority: "Wicklow County Council",
      appointedAcoustician: "iAcoustics",
      appointmentEvidenceExcerpt: "iAcoustics has been appointed as acoustic consultant.",
    }),
    planningLead({
      id: "npr-appointment",
      sourceSystem: "National Planning Register",
      sourceRecordId: "Wicklow County Council:2660722",
      projectReference: "2660722",
      planningAuthority: "Wicklow County Council",
    }),
  ]));
  assert.equal(new Set(guarded.map((record) => record.outreachKey)).size, 1);
  assert.ok(guarded.every((record) => record.acousticAppointmentStatus === "iacoustics-appointed"));
  assert.ok(guarded.every((record) => record.outreachEligibility === "suppressed-already-won" || record.outreachEligibility === "suppressed-duplicate"));
});

test("the native BuildingInfo profile requires a bounded, consent-backed operating boundary", () => {
  assert.match(BUILDINGINFO_NATIVE_SEARCH_PROFILE.operatingBoundary, /bounded searches/i);
  assert.match(BUILDINGINFO_NATIVE_SEARCH_PROFILE.operatingBoundary, /no challenge bypass/i);
  assert.match(BUILDINGINFO_NATIVE_SEARCH_PROFILE.operatingBoundary, /written provider consent/i);
  assert.ok(BUILDINGINFO_NATIVE_SEARCH_PROFILE.geography.includedCounties.includes("Wicklow"));
  assert.equal(BUILDINGINFO_NATIVE_SEARCH_PROFILE.geography.excludedRegion, "Northern Ireland");
  assert.ok(BUILDINGINFO_NATIVE_SEARCH_PROFILE.preferredExportFields.includes("appointed_acoustician"));
});

test("recency boosts priority but never excludes an older worthwhile job", () => {
  const now = new Date("2026-09-30T12:00:00.000Z");
  const fresh = qualifyLead(planningLead({
    description: "Large Residential Development of 120 homes",
    publishedAt: "2026-09-30T08:00:00.000Z",
  }), now);
  const older = qualifyLead(planningLead({
    description: "Large Residential Development of 120 homes",
    publishedAt: "2026-07-01T08:00:00.000Z",
  }), now);
  assert.equal(fresh.leadFreshness, "published-today");
  assert.equal(older.leadFreshness, "published-over-30-days");
  assert.equal(fresh.leadQuality, "excellent");
  assert.equal(older.leadQuality, "excellent");
  assert.equal(older.leadDisposition, "nurture");
  assert.ok(freshnessPriority(fresh) > freshnessPriority(older));
  assert.match(older.freshnessReason, /retained/i);
});

test("newly detected records without a source date are not mislabelled as newly published", () => {
  const assessed = assessLeadFreshness(planningLead({ firstSeenAt: "2026-09-29T12:00:00.000Z" }), new Date("2026-09-30T12:00:00.000Z"));
  assert.equal(assessed.freshness, "newly-detected-date-unknown");
  assert.match(assessed.reason, /not claimed to be newly published/i);
});

test("strict cross-source duplicates share one CRM identity without losing either source record", () => {
  const records = annotateOpportunityDuplicates([
    planningLead({
      id: "planning-leads-1",
      sourceSystem: "PlanningLeads",
      sourceRecordId: "2660971",
      projectReference: "2660971",
      planningAuthority: "Meath County Council",
      evidenceStatus: "discovery-only",
    }),
    planningLead({
      id: "national-1",
      sourceSystem: "National Planning Register",
      sourceRecordId: "Meath County Council:2660971",
      projectReference: "2660971",
      planningAuthority: "Meath County Council",
      evidenceStatus: "evidence-unavailable",
    }),
  ]);
  assert.equal(records.length, 2);
  const canonical = records.find((record) => record.deduplicationStatus === "canonical");
  const duplicate = records.find((record) => record.deduplicationStatus === "duplicate");
  assert.equal(canonical.id, "national-1");
  assert.equal(duplicate.id, "planning-leads-1");
  assert.equal(canonical.crmExternalId, duplicate.crmExternalId);
  assert.equal(canonical.duplicateSources.length, 2);
  assert.deepEqual(deduplicationSummary(records), {
    retainedRecords: 2,
    uniqueRecords: 0,
    canonicalGroups: 1,
    duplicateSourceRecords: 1,
    possibleDuplicateRecords: 0,
    crmOpportunityKeys: 1,
  });
});

test("same-address applications with different references are flagged but retained as separate CRM opportunities", () => {
  const records = annotateOpportunityDuplicates([
    planningLead({
      id: "dcc-a",
      sourceRecordId: "WEB3249/26",
      projectReference: "WEB3249/26",
      planningAuthority: "Dublin City Council",
      location: "19 Berkeley Street & Blessington Street, Dublin 7",
    }),
    planningLead({
      id: "dcc-b",
      sourceRecordId: "WEB3307/26",
      projectReference: "WEB3307/26",
      planningAuthority: "Dublin City Council",
      location: "19, Berkeley Street & Blessington Street Dublin 7",
    }),
  ]);
  assert.ok(records.every((record) => record.deduplicationStatus === "possible-duplicate"));
  assert.notEqual(records[0].crmExternalId, records[1].crmExternalId);
  assert.deepEqual(records[0].possibleDuplicateIds, ["dcc-b"]);
});

test("Odoo dry-run upserts once per deduplicated CRM identity and retains every contributing source", () => {
  const records = annotateOpportunityDuplicates([
    qualifyLead(planningLead({
      id: "planning-leads-odoo",
      sourceSystem: "PlanningLeads",
      sourceRecordId: "2661127",
      projectReference: "2661127",
      planningAuthority: "Meath County Council",
      evidenceStatus: "discovery-only",
      parties: [{ role: "architect", name: "Design Contact", organisation: "Design Studio", email: "design@example.test" }],
    }), new Date("2026-09-30T12:00:00.000Z")),
    qualifyLead(planningLead({
      id: "national-odoo",
      sourceSystem: "National Planning Register",
      sourceRecordId: "Meath County Council:2661127",
      projectReference: "2661127",
      planningAuthority: "Meath County Council",
      evidenceStatus: "evidence-unavailable",
    }), new Date("2026-09-30T12:00:00.000Z")),
  ]);
  const payloads = buildOdooDryRun(records);
  assert.equal(payloads.length, 1);
  assert.match(payloads[0].values.x_source_systems, /National Planning Register/);
  assert.match(payloads[0].values.x_source_systems, /PlanningLeads/);
  assert.match(payloads[0].values.x_source_ledger, /Observation \d+: National Planning Register/);
  assert.match(payloads[0].values.x_source_ledger, /Observation \d+: PlanningLeads/);
  assert.match(payloads[0].values.x_source_ledger, /Deduplication status: canonical/);
  assert.match(payloads[0].values.x_party_details, /design@example\.test/);
  assert.equal(payloads[0].operation, "upsert");
  assert.equal(payloads[0].matchField, "x_helmonic_external_id");
  assert.equal(summarizeOdooDryRun(payloads).uniqueExternalIds, 1);
});

test("Odoo payload populates native contact, planning attribution, sector and reference fields", () => {
  const records = annotateOpportunityDuplicates([qualifyLead(planningLead({
    id: "buildinginfo-424562",
    sourceSystem: "BuildingInfo",
    sourceRecordId: "424562",
    projectReference: "2660722",
    planningAuthority: "Wicklow County Council",
    title: "€3.2m Industrial Unit Development in Arklow",
    description: "Single-storey industrial unit",
    location: "Kish Business Park, Clogga Road, Arklow, Co. Wicklow",
    projectSector: "Industrial",
    projectStage: "Plans Applied",
    triggerType: "Further Information Request",
    classification: "noise-related-rfi",
    sourceMajorUpdatedAt: "2026-10-06",
    rfiPublishedAt: "2026-10-05",
    rfiReceivedAt: "2026-10-06",
    rfiDateSource: "BuildingInfo weekly reviewed export",
    rfiDateConfidence: "exact",
    deadline: "2026-11-20",
    responseDeadline: "2026-10-28",
    parties: [{
      role: "applicant",
      name: "Alan Armstrong",
      organisation: "Armstrong Timber Engineering Ltd.",
      email: "sales@ate.ie",
      phone: "0402 33477",
    }],
    routedTo: "Glen",
    emailRelationshipStatus: "verified-single-owner",
    emailRelationshipOwner: "Glen",
  }), new Date("2026-10-07T12:00:00.000Z"))]);
  const [payload] = buildOdooDryRun(records, new Date("2026-10-12T12:00:00.000Z"));
  assert.equal(payload.values.partner_name, "Armstrong Timber Engineering Ltd.");
  assert.equal(payload.values.contact_name, "Alan Armstrong");
  assert.equal(payload.values.email_from, "sales@ate.ie");
  assert.equal(payload.values.phone, "0402 33477");
  assert.equal(payload.values.function, "Applicant");
  assert.equal(payload.values.street, "Kish Business Park, Clogga Road, Arklow, Co. Wicklow");
  assert.equal(payload.values.x_county, "");
  assert.equal(payload.values.date_deadline, "2026-10-28");
  assert.equal(payload.values.name, "€3.2m Industrial Unit Development in Arklow");
  assert.equal(payload.values.x_source_reference, "BI-2660722");
  assert.equal(Object.hasOwn(payload.values, "x_studio_reference"), false);
  assert.equal(payload.values.x_studio_project_sector, "Industrial");
  assert.equal(payload.values.x_project_link, "https://example.test/project");
  assert.equal(payload.values.x_rfi_published_at, "2026-10-05 00:00:00");
  assert.equal(payload.values.x_rfi_received_at, "2026-10-06 00:00:00");
  assert.equal(payload.values.x_rfi_response_due_at, "2026-10-28 00:00:00");
  assert.equal(payload.values.x_rfi_date_source, "BuildingInfo weekly reviewed export");
  assert.equal(payload.values.x_rfi_date_confidence, "exact");
  assert.equal(payload.values.x_decision_due_at, "2026-11-20 00:00:00");
  assert.equal(payload.values.x_action_days_remaining, 16);
  assert.equal(payload.values.x_deadline_urgency, "Due in 16 days — within the 28-day RFI response window");
  assert.equal(payload.values.x_rfi_trigger, "Further Information Request");
  assert.match(payload.values.description, /Project and Source Links/);
  assert.match(payload.values.description, /href="https:\/\/example\.test\/project"/);
  assert.match(payload.values.description, /BuildingInfo project · 424562/);
  assert.match(payload.values.description, /All Project Parties and Contacts/);
  assert.match(payload.values.description, /RFI published date/);
  assert.match(payload.values.description, /RFI received \/ detected date/);
  assert.match(payload.values.description, /RFI response due date/);
  assert.match(payload.values.description, /Planning decision due/);
  assert.match(payload.values.description, /Due in 16 days/);
  assert.deepEqual(payload.attribution, {
    campaignName: "Planning Outreach - Acoustics",
    mediumName: "Planning Intelligence",
    sourceName: "BuildingInfo",
  });
});

test("Odoo exposes appointment evidence, competitive status and the outreach safeguard", () => {
  const [guarded] = applyAppointmentSafeguards(annotateOpportunityDuplicates([planningLead({
    sourceSystem: "BuildingInfo",
    sourceRecordId: "BI-APPOINTED-1",
    appointedAcoustician: "Example Acoustics Ltd",
    appointmentEvidenceExcerpt: "Example Acoustics Ltd has been appointed as acoustic consultant.",
    appointmentEvidenceSourceUrl: "https://example.test/appointment-evidence",
    buildingInfoSearchProfile: "iAcoustics acoustic opportunity watch",
  })]));
  const [payload] = buildOdooDryRun([qualifyLead(guarded)]);
  assert.equal(payload.values.x_acoustic_appointment_status, "competitor-appointed");
  assert.equal(payload.values.x_appointed_acoustician, "Example Acoustics Ltd");
  assert.equal(payload.values.x_competitive_quote_opportunity, true);
  assert.equal(payload.values.x_outreach_eligibility, "consultant-review");
  assert.equal(payload.values.x_lead_panel, "Competitive / Re-engagement");
  assert.match(payload.values.x_outreach_key, /^planning-outreach:/);
  assert.equal(payload.values.x_buildinginfo_search_profile, "iAcoustics acoustic opportunity watch");
  assert.deepEqual(payload.statusTagNames, ["Competitor Appointed"]);
  assert.match(payload.values.description, /Appointment and Outreach Safeguard/);
  assert.match(payload.values.description, /Appointment evidence source: https:\/\/example\.test\/appointment-evidence/);
});

test("Odoo retains iAcoustics wins as protected relationship records", () => {
  const [guarded] = applyAppointmentSafeguards(annotateOpportunityDuplicates([planningLead({
    sourceSystem: "BuildingInfo",
    sourceRecordId: "BI-IACOUSTICS-1",
    appointedAcoustician: "iAcoustics",
    appointmentEvidenceExcerpt: "iAcoustics has been appointed as acoustic consultant.",
    appointmentEvidenceSourceUrl: "https://example.test/iacoustics-appointment",
  })]));
  const [payload] = buildOdooDryRun([qualifyLead(guarded)]);
  assert.equal(payload.values.x_acoustic_appointment_status, "iacoustics-appointed");
  assert.equal(payload.values.x_pipeline_bucket, "already-won");
  assert.equal(payload.values.x_lead_panel, "Existing Relationship / Do Not Cold Contact");
  assert.equal(payload.values.x_outreach_eligibility, "suppressed-already-won");
  assert.equal(payload.values.x_competitive_quote_opportunity, false);
});

test("Odoo payload exposes an explicit visible tag for a verified email relationship", () => {
  const lookup = buildRelationshipLookup([{
    name: "Alan Armstrong",
    email: "sales@ate.ie",
    evidence_refs: ["[E:glen:424562]"],
    email_subject: "Arklow industrial unit follow-up",
    email_sent_at: "2026-09-18T10:15:00Z",
    email_context: "We previously worked with Alan on the earlier Arklow industrial project.",
    email_source_uri: "restricted-email://glen/424562",
    previous_projects: ["Earlier Arklow industrial project"],
  }]);
  const routed = routeOpportunityByRelationships(planningLead({
    id: "email-match-odoo",
    evidenceStatus: "official-text",
    classification: "noise-related-rfi",
    parties: [{
      role: "applicant",
      name: "Alan Armstrong",
      organisation: "Armstrong Timber Engineering Ltd.",
      email: "sales@ate.ie",
    }],
  }), lookup);
  const [payload] = buildOdooDryRun(annotateOpportunityDuplicates([
    qualifyLead(routed, new Date("2026-10-09T12:00:00.000Z")),
  ]));
  assert.equal(payload.values.x_warm_connection_verified, true);
  assert.equal(payload.emailMatchTagName, "Email Match: Glen");
  assert.deepEqual(payload.sourceTagNames, ["DCC"]);
  assert.match(payload.values.description, /DCC \(DCC\)/);
  assert.match(payload.values.description, /Alan Armstrong/);
  assert.match(payload.values.description, /sales@ate\.ie/);
  assert.match(payload.values.x_relationship_summary, /2026-09-18T10:15:00Z/);
  assert.match(payload.values.x_relationship_summary, /Arklow industrial unit follow-up/);
  assert.match(payload.values.x_relationship_summary, /Useful conversation context: We previously worked with Alan/);
  assert.doesNotMatch(payload.values.description, /Full Matched Email Evidence/);
  assert.match(payload.values.x_relationship_evidence, /Evidence source: Restricted iAcoustics consultant email evidence index/);
  assert.match(payload.values.x_relationship_evidence, /Source message URI: restricted-email:\/\/glen\/424562/);
  assert.match(payload.values.x_relationship_evidence, /Evidence reference\(s\): \[E:glen:424562\]/);
  assert.match(payload.values.description, /Glen Plunkett — assigned from an exact single-owner email-evidence match/);
});

test("Odoo relationship summary is bounded and excludes quoted mail headers and confidentiality text", () => {
  const lookup = buildRelationshipLookup([{
    name: "Ronan Woods",
    email: "ronan@example.test",
    evidence_refs: ["[E:glen:1]"],
    email_subject: "Earlier acoustic project",
    email_sent_at: "2026-09-18T10:15:00Z",
    email_context: "Useful agreed next step. From: Ronan Woods Sent: yesterday To: Eoghan Subject: reply This email is confidential and intended solely for the recipient.",
    previous_projects: ["Earlier housing noise assessment"],
  }]);
  const routed = routeOpportunityByRelationships(planningLead({
    id: "bounded-relationship-summary",
    evidenceStatus: "official-text",
    classification: "noise-related-rfi",
    parties: [{ role: "applicant", name: "Ronan Woods", organisation: "Ronan Woods", email: "ronan@example.test" }],
  }), lookup);
  const [payload] = buildOdooDryRun([{
    ...routed,
    crmExternalId: "helmonic-lead:bounded-relationship-summary",
  }]);
  assert.ok(payload.values.x_relationship_summary.length <= 1_600);
  assert.match(payload.values.x_relationship_summary, /Useful agreed next step/);
  assert.doesNotMatch(payload.values.x_relationship_summary, /This email is confidential/i);
  assert.doesNotMatch(payload.values.description, /Evidence source:|Source message URI:|Evidence reference\(s\):/i);
});

test("Odoo marks an exact email relationship to multiple owners as verified and visibly tagged", () => {
  const [payload] = buildOdooDryRun([{
    ...planningLead({
      id: "multi-owner-email-match-odoo",
      evidenceStatus: "official-text",
      classification: "noise-related-rfi",
      emailRelationshipStatus: "verified-multiple-owners",
      routedTo: "Glen",
      routingStatus: "routed",
      routingReason: "balanced-assignment-to-glen-because-both-relationship-histories-exist",
    }),
    crmExternalId: "helmonic-lead:multi-owner-email-match-odoo",
  }]);
  assert.equal(payload.values.x_warm_connection_verified, true);
  assert.equal(payload.emailMatchTagName, "Email Match: Glen");
  assert.equal(payload.values.x_assigned_person, "Glen Plunkett");
  assert.match(payload.values.description, /exact history exists for both Glen and Eoghan/);
});

test("Odoo selects a reachable project contact instead of an unreachable higher-role party", () => {
  const [payload] = buildOdooDryRun([{
    ...planningLead({
      id: "reachable-contact-odoo",
      applicant: "Applicant Holdings Limited",
      parties: [
        { role: "applicant", name: "Applicant Holdings Limited", organisation: "Applicant Holdings Limited" },
        {
          role: "architect",
          name: "Alex Architect",
          organisation: "Example Architects",
          email: "alex@example.test",
          phone: "01 234 5678",
        },
      ],
    }),
    crmExternalId: "helmonic-lead:reachable-contact-odoo",
  }]);
  assert.equal(payload.values.partner_name, "Example Architects");
  assert.equal(payload.values.contact_name, "Alex Architect");
  assert.equal(payload.values.email_from, "alex@example.test");
  assert.equal(payload.values.phone, "01 234 5678");
  assert.equal(payload.values.function, "Architect");
});

test("Odoo keeps planning and tender sources in explicitly separate attribution labels", () => {
  const common = {
    description: "Acoustic consultancy opportunity",
    sourceUrl: "https://example.test/opportunity",
    evidenceStatus: "official-text",
    classification: "acoustic-consultancy-opportunity",
    cpvCodes: [],
    matchedTerms: ["acoustic assessment"],
    fitScore: 80,
    deduplicationStatus: "unique",
  };
  const payloads = buildOdooDryRun([
    {
      ...common,
      id: "planning-label-test",
      type: "planning-pipeline-lead",
      sourceSystem: "PlanningLeads",
      sourceRecordId: "PL-101",
      title: "Planning lead",
      crmExternalId: "planning:PL-101",
    },
    {
      ...common,
      id: "tender-label-test",
      type: "formal-public-tender",
      sourceSystem: "TED",
      sourceRecordId: "TED-2026-101",
      title: "Formal tender",
      crmExternalId: "tender:TED-2026-101",
    },
  ]);
  const planning = payloads.find((payload) => payload.matchValue === "planning:PL-101");
  const tender = payloads.find((payload) => payload.matchValue === "tender:TED-2026-101");
  assert.deepEqual(planning.attribution, {
    campaignName: "Planning Outreach - Acoustics",
    mediumName: "Planning Intelligence",
    sourceName: "PlanningLeads",
  });
  assert.deepEqual(tender.attribution, {
    campaignName: "Tender Outreach - Acoustics",
    mediumName: "Tender Intelligence",
    sourceName: "TED",
  });
});

test("Odoo synchronization remains completely inert while disabled", async () => {
  let calls = 0;
  const result = await syncOdooLeads([], { enabled: false }, async () => {
    calls += 1;
    return Response.json({});
  });
  assert.equal(result.status, "disabled");
  assert.equal(calls, 0);
});

test("Odoo preflight validates the complete contract and routing with zero writes", async () => {
  const calls = [];
  const fetcher = async (request, options = {}) => {
    const url = String(request);
    const body = options.body ? JSON.parse(String(options.body)) : {};
    calls.push({ url, body });
    if (url.endsWith("/web/version")) return Response.json({
      server_version: "saas~19.4+e",
      server_version_info: ["saas", 19, 4, 0, "final", 0, "e"],
    });
    if (url.endsWith("/fields_get")) {
      return Response.json(Object.fromEntries(body.allfields.map((field) => [field, {
        type: ODOO_TENDER_FIELD_TYPES[field] ?? ({
          name: "char",
          active: "boolean",
          description: "html",
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
          type: "selection",
          team_id: "many2one",
          user_id: "many2one",
          priority: "selection",
          stage_id: "many2one",
        }[field] ?? "char"),
      }])));
    }
    if (url.includes("/crm.team/search_read")) return Response.json([{ id: 1, name: "iAcoustics Sales Team" }]);
    if (url.includes("/crm.stage/search_read")) return Response.json([{ id: 1, name: "New" }]);
    if (url.includes("/res.users/search_read")) {
      const id = body.domain[0][2];
      return Response.json([{ id, name: id === 7 ? "Glen Plunkett" : "Eoghan Tyrrell" }]);
    }
    return new Response("Unexpected request", { status: 500 });
  };
  const result = await preflightOdoo([], {
    enabled: false,
    baseUrl: "https://odoo.example.test",
    apiKey: "test-only-key",
    salesTeamId: 1,
    initialStageId: 1,
    glenUserId: 7,
    eoghanUserId: 6,
  }, fetcher);
  assert.equal(result.status, "completed");
  assert.equal(result.writesAttempted, 0);
  assert.ok(result.requiredFieldCount > 20);
  assert.ok(calls.every(({ url }) => !url.endsWith("/create") && !url.endsWith("/write")));
});

test("Odoo creates new Tender Desk records as leads, preserves conversion and supports a controlled migration", async () => {
  const records = annotateOpportunityDuplicates([qualifyLead(planningLead({
    id: "odoo-repeatable",
    sourceRecordId: "WEB1000/26",
    projectReference: "WEB1000/26",
    planningAuthority: "Dublin City Council",
    evidenceStatus: "official-text",
    classification: "design-construction-potential",
    routedTo: "Owen",
  }), new Date("2026-09-30T12:00:00.000Z"))]);
  const payloads = buildOdooDryRun(records);
  let existingId;
  let creates = 0;
  let writes = 0;
  const writtenTypes = [];
  const writtenValues = [];
  const fetcher = async (request, options = {}) => {
    const url = String(request);
    const body = options.body ? JSON.parse(String(options.body)) : {};
    if (url.endsWith("/web/version")) return Response.json({ version_info: [19, 0, 0, "final"] });
    if (url.endsWith("/fields_get")) {
      return Response.json(Object.fromEntries(body.allfields.map((field) => [field, {
        type: ODOO_TENDER_FIELD_TYPES[field] ?? ({
          name: "char",
          active: "boolean",
          description: "html",
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
          type: "selection",
          team_id: "many2one",
          user_id: "many2one",
          priority: "selection",
          stage_id: "many2one",
        }[field] ?? "char"),
      }])));
    }
    if (url.endsWith("/search_read")) return Response.json(existingId ? [{ id: existingId, type: "opportunity" }] : []);
    if (url.endsWith("/create")) {
      assert.equal(body.vals_list[0].x_helmonic_external_id, payloads[0].matchValue);
      assert.equal(body.vals_list[0].team_id, 41);
      assert.equal(body.vals_list[0].x_assigned_person, "Eoghan Tyrrell");
      assert.equal(body.vals_list[0].user_id, 6);
      assert.equal(body.vals_list[0].type, "lead");
      creates += 1;
      existingId = 731;
      return Response.json([existingId]);
    }
    if (url.endsWith("/write")) {
      assert.deepEqual(body.ids, [existingId]);
      writtenTypes.push(body.vals.type);
      writtenValues.push(body.vals);
      writes += 1;
      return Response.json(true);
    }
    return new Response("Unexpected request", { status: 500 });
  };
  const config = {
    enabled: true,
    baseUrl: "https://odoo.example.test",
    database: "test",
    apiKey: "test-only-key",
    salesTeamId: 41,
    eoghanUserId: 6,
  };
  const first = await syncOdooLeads(payloads, config, fetcher);
  const second = await syncOdooLeads(payloads, config, fetcher);
  const migration = await syncOdooLeads(payloads, { ...config, migrateManagedRecordsToLeads: true }, fetcher);
  assert.equal(first.created, 1);
  assert.equal(second.updated, 1);
  assert.equal(migration.updated, 1);
  assert.equal(migration.managedRecordsMovedToLeads, 1);
  assert.equal(creates, 1);
  assert.equal(writes, 2);
  assert.deepEqual(writtenTypes, [undefined, "lead"]);
  for (const values of writtenValues) {
    assert.equal(Object.hasOwn(values, "team_id"), false);
    assert.equal(Object.hasOwn(values, "user_id"), false);
    assert.equal(Object.hasOwn(values, "priority"), false);
    assert.equal(Object.hasOwn(values, "stage_id"), false);
    assert.equal(Object.hasOwn(values, "name"), false);
    assert.equal(Object.hasOwn(values, "date_deadline"), false);
    assert.equal(Object.hasOwn(values, "x_studio_reference"), false);
  }
});

test("Odoo pipeline priority leads with qualified verified email matches", async () => {
  const payloads = buildOdooDryRun([
    {
      ...planningLead({
        id: "warm-priority",
        leadQuality: "good",
        leadDisposition: "active",
        emailRelationshipStatus: "verified-single-owner",
        emailRelationshipOwner: "Glen",
        routedTo: "Glen",
      }),
      crmExternalId: "helmonic-lead:warm-priority",
    },
    {
      ...planningLead({
        id: "excellent-unmatched-priority",
        leadQuality: "excellent",
        leadDisposition: "active",
        emailRelationshipStatus: "no-confirmed-match",
        routedTo: "Owen",
      }),
      crmExternalId: "helmonic-lead:excellent-unmatched-priority",
    },
  ]);
  const writtenPriorities = new Map();
  const fetcher = async (request, options = {}) => {
    const url = String(request);
    const body = options.body ? JSON.parse(String(options.body)) : {};
    if (url.endsWith("/web/version")) return Response.json({ version_info: [19, 0, 0, "final"] });
    if (url.endsWith("/crm.lead/fields_get")) {
      return Response.json(Object.fromEntries(body.allfields.map((field) => [field, {
        type: ODOO_TENDER_FIELD_TYPES[field] ?? ({
          name: "char", active: "boolean", description: "html", partner_name: "char", contact_name: "char",
          email_from: "char", phone: "char", function: "char", street: "char", date_deadline: "date",
          partner_id: "many2one", campaign_id: "many2one", medium_id: "many2one", source_id: "many2one",
          tag_ids: "many2many", type: "selection", team_id: "many2one", user_id: "many2one", priority: "selection",
        }[field] ?? "char"),
        ...(field === "x_studio_project_sector" ? { selection: [["other", "Other"]] } : {}),
      }])));
    }
    if (url.endsWith("/crm.lead/search_read")) return Response.json([]);
    if (url.endsWith("/crm.lead/create")) {
      const values = body.vals_list[0];
      writtenPriorities.set(values.x_helmonic_external_id, values.priority);
      return Response.json([writtenPriorities.size]);
    }
    return new Response("Unexpected request", { status: 500 });
  };
  await syncOdooLeads(payloads, {
    enabled: true,
    baseUrl: "https://odoo.example.test",
    apiKey: "test-only-key",
    salesTeamId: 1,
    glenUserId: 7,
    eoghanUserId: 6,
  }, fetcher);
  assert.equal(writtenPriorities.get("helmonic-lead:warm-priority"), "2");
  assert.equal(writtenPriorities.get("helmonic-lead:excellent-unmatched-priority"), "1");
});

test("Odoo pipeline rank uses the live RFI deadline first and source/relationship ties second", () => {
  const records = [
    planningLead({
      id: "buildinginfo-matched-rfi-rank",
      sourceSystem: "BuildingInfo",
      sourceRecordId: "424562",
      sourceUrl: "https://app.buildinginfo.com/p-OTNsZQ==-",
      classification: "noise-related-rfi",
      rfiReceivedAt: "2026-10-10",
      responseDeadline: "2026-10-20",
      leadQuality: "excellent",
      leadDisposition: "active",
      emailRelationshipStatus: "verified-single-owner",
      emailRelationshipOwner: "Glen",
      routedTo: "Glen",
      crmExternalId: "helmonic-lead:buildinginfo-matched-rfi-rank",
    }),
    planningLead({
      id: "matched-rfi-rank",
      classification: "noise-related-rfi",
      rfiReceivedAt: "2026-10-10",
      responseDeadline: "2026-10-20",
      leadQuality: "excellent",
      leadDisposition: "active",
      emailRelationshipStatus: "verified-single-owner",
      emailRelationshipOwner: "Glen",
      routedTo: "Glen",
      crmExternalId: "helmonic-lead:matched-rfi-rank",
    }),
    planningLead({
      id: "unmatched-rfi-rank",
      classification: "noise-related-rfi",
      rfiReceivedAt: "2026-10-10",
      responseDeadline: "2026-10-20",
      leadQuality: "excellent",
      leadDisposition: "active",
      emailRelationshipStatus: "no-confirmed-match",
      routedTo: "Owen",
      crmExternalId: "helmonic-lead:unmatched-rfi-rank",
    }),
    planningLead({
      id: "buildinginfo-unmatched-rfi-rank",
      sourceSystem: "BuildingInfo",
      sourceRecordId: "424563",
      classification: "noise-related-rfi",
      rfiReceivedAt: "2026-10-10",
      responseDeadline: "2026-10-20",
      leadQuality: "excellent",
      leadDisposition: "active",
      emailRelationshipStatus: "no-confirmed-match",
      routedTo: "Owen",
      crmExternalId: "helmonic-lead:buildinginfo-unmatched-rfi-rank",
    }),
    planningLead({
      id: "newer-unmatched-rfi-rank",
      classification: "noise-related-rfi",
      rfiReceivedAt: "2026-10-11",
      responseDeadline: "2026-10-20",
      leadQuality: "excellent",
      leadDisposition: "active",
      emailRelationshipStatus: "no-confirmed-match",
      routedTo: "Owen",
      crmExternalId: "helmonic-lead:newer-unmatched-rfi-rank",
    }),
    planningLead({
      id: "earlier-unmatched-rfi-rank",
      classification: "noise-related-rfi",
      rfiReceivedAt: "2026-10-01",
      responseDeadline: "2026-10-19",
      leadQuality: "excellent",
      leadDisposition: "active",
      emailRelationshipStatus: "no-confirmed-match",
      routedTo: "Owen",
      crmExternalId: "helmonic-lead:earlier-unmatched-rfi-rank",
    }),
    planningLead({
      id: "matched-standard-rank",
      classification: "design-construction-potential",
      leadQuality: "good",
      leadDisposition: "active",
      emailRelationshipStatus: "verified-single-owner",
      emailRelationshipOwner: "Glen",
      routedTo: "Glen",
      crmExternalId: "helmonic-lead:matched-standard-rank",
    }),
  ];
  const payloads = buildOdooDryRun(records, new Date("2026-10-12T12:00:00.000Z"));
  const ranks = Object.fromEntries(payloads.map((payload) => [payload.matchValue, payload.values.x_pipeline_priority_rank]));
  assert.ok(ranks["helmonic-lead:buildinginfo-matched-rfi-rank"] > ranks["helmonic-lead:buildinginfo-unmatched-rfi-rank"]);
  assert.ok(ranks["helmonic-lead:matched-rfi-rank"] > ranks["helmonic-lead:unmatched-rfi-rank"]);
  assert.ok(ranks["helmonic-lead:matched-rfi-rank"] > ranks["helmonic-lead:buildinginfo-unmatched-rfi-rank"]);
  assert.ok(ranks["helmonic-lead:buildinginfo-unmatched-rfi-rank"] > ranks["helmonic-lead:unmatched-rfi-rank"]);
  assert.ok(ranks["helmonic-lead:buildinginfo-matched-rfi-rank"] > ranks["helmonic-lead:newer-unmatched-rfi-rank"]);
  assert.ok(ranks["helmonic-lead:earlier-unmatched-rfi-rank"] > ranks["helmonic-lead:buildinginfo-matched-rfi-rank"]);
  assert.ok(ranks["helmonic-lead:earlier-unmatched-rfi-rank"] > ranks["helmonic-lead:newer-unmatched-rfi-rank"]);
  assert.equal(ranks["helmonic-lead:matched-standard-rank"], 900);
});

test("Odoo orders recent undated RFIs by their received or published activity date", () => {
  const payloads = buildOdooDryRun([
    planningLead({
      id: "older-undated-buildinginfo-match",
      sourceSystem: "BuildingInfo",
      classification: "noise-related-rfi",
      rfiReceivedAt: "2026-10-01",
      responseDeadline: "",
      leadQuality: "excellent",
      leadDisposition: "active",
      emailRelationshipStatus: "verified-single-owner",
      emailRelationshipOwner: "Glen",
      routedTo: "Glen",
      crmExternalId: "helmonic-lead:older-undated-buildinginfo-match",
    }),
    planningLead({
      id: "newer-undated-unmatched",
      classification: "noise-related-rfi",
      rfiPublishedAt: "2026-10-11",
      responseDeadline: "",
      leadQuality: "excellent",
      leadDisposition: "active",
      emailRelationshipStatus: "no-confirmed-match",
      routedTo: "Owen",
      crmExternalId: "helmonic-lead:newer-undated-unmatched",
    }),
  ], new Date("2026-10-12T12:00:00.000Z"));
  const ranks = Object.fromEntries(payloads.map((payload) => [payload.matchValue, payload.values.x_pipeline_priority_rank]));
  assert.ok(ranks["helmonic-lead:newer-undated-unmatched"] > ranks["helmonic-lead:older-undated-buildinginfo-match"]);
  assert.ok(payloads.every((payload) => payload.values.active === true));
});

test("Odoo keeps a live confirmed RFI ahead of an undated BuildingInfo discovery lead", () => {
  const payloads = buildOdooDryRun([
    planningLead({
      id: "buildinginfo-potential-first",
      sourceSystem: "BuildingInfo",
      sourceRecordId: "BI-1",
      evidenceStatus: "discovery-only",
      classification: "design-construction-potential",
      leadQuality: "medium",
      leadDisposition: "nurture",
      crmExternalId: "helmonic-lead:buildinginfo-potential-first",
    }),
    planningLead({
      id: "other-live-rfi-after-bi",
      sourceSystem: "National Planning Register",
      evidenceStatus: "official-text",
      evidenceExcerpt: "Submit an acoustic report and noise impact assessment.",
      matchedTerms: ["acoustic report", "noise impact assessment"],
      classification: "noise-related-rfi",
      responseDeadline: "2026-10-20",
      leadQuality: "excellent",
      leadDisposition: "active",
      crmExternalId: "helmonic-lead:other-live-rfi-after-bi",
    }),
  ], new Date("2026-10-12T12:00:00.000Z"));
  const ranks = Object.fromEntries(payloads.map((payload) => [payload.matchValue, payload.values.x_pipeline_priority_rank]));
  assert.ok(ranks["helmonic-lead:other-live-rfi-after-bi"] > ranks["helmonic-lead:buildinginfo-potential-first"]);
  assert.ok(Math.max(...Object.values(ranks)) <= 2_147_483_647);
});

test("Odoo makes current acoustic RFIs primary, granted acoustic conditions second, and potentials secondary", () => {
  const payloads = buildOdooDryRun([
    planningLead({
      id: "live-current-acoustic-rfi",
      classification: "noise-related-rfi",
      evidenceStatus: "official-text",
      evidenceExcerpt: "Further information requested: submit a noise impact assessment.",
      matchedTerms: ["noise impact assessment"],
      responseDeadline: "2026-10-24",
      crmExternalId: "helmonic-lead:live-current-acoustic-rfi",
    }),
    planningLead({
      id: "granted-acoustic-condition",
      classification: "granted-with-noise-conditions",
      projectStage: "GRANT PERMISSION WITH CONDITIONS",
      sourceMajorUpdatedAt: "2026-10-20",
      evidenceStatus: "official-text",
      evidenceExcerpt: "Permission granted subject to a condition requiring an acoustic report and plant noise limits.",
      matchedTerms: ["acoustic report", "plant noise"],
      crmExternalId: "helmonic-lead:granted-acoustic-condition",
    }),
    planningLead({
      id: "planning-potential-secondary",
      classification: "design-construction-potential",
      evidenceStatus: "discovery-only",
      deadline: "2026-10-23",
      projectStage: "NEW APPLICATION",
      sourceMajorUpdatedAt: "2026-10-20",
      leadQuality: "good",
      leadDisposition: "nurture",
      crmExternalId: "helmonic-lead:planning-potential-secondary",
    }),
  ], new Date("2026-10-21T12:00:00.000Z"));
  const values = Object.fromEntries(payloads.map((payload) => [payload.matchValue, payload.values]));
  assert.equal(values["helmonic-lead:live-current-acoustic-rfi"].x_lead_panel, "Urgent Acoustic RFI");
  assert.equal(values["helmonic-lead:granted-acoustic-condition"].x_lead_panel, "Granted with Acoustic Conditions");
  assert.equal(values["helmonic-lead:planning-potential-secondary"].x_lead_panel, "Potential Acoustic Fit");
  assert.equal(values["helmonic-lead:planning-potential-secondary"].active, true);
  assert.ok(values["helmonic-lead:live-current-acoustic-rfi"].x_pipeline_priority_rank
    > values["helmonic-lead:granted-acoustic-condition"].x_pipeline_priority_rank);
  assert.ok(values["helmonic-lead:granted-acoustic-condition"].x_pipeline_priority_rank
    > values["helmonic-lead:planning-potential-secondary"].x_pipeline_priority_rank);
});

test("Odoo keeps every confirmed granted acoustic condition in the second primary category and orders them newest first", () => {
  const payloads = buildOdooDryRun([
    planningLead({
      id: "newest-granted-acoustic-condition",
      classification: "granted-with-noise-conditions",
      projectStage: "GRANT PERMISSION WITH CONDITIONS",
      deadline: "2026-10-20",
      sourceMajorUpdatedAt: "2026-10-20",
      evidenceStatus: "official-text",
      evidenceExcerpt: "Permission granted with a condition requiring an acoustic report.",
      matchedTerms: ["acoustic report"],
      crmExternalId: "helmonic-lead:newest-granted-acoustic-condition",
    }),
    planningLead({
      id: "older-current-granted-acoustic-condition",
      classification: "granted-with-noise-conditions",
      projectStage: "GRANT PERMISSION WITH CONDITIONS",
      deadline: "2026-10-01",
      sourceMajorUpdatedAt: "2026-09-20",
      evidenceStatus: "official-text",
      evidenceExcerpt: "Permission granted with a condition requiring a noise impact assessment.",
      matchedTerms: ["noise impact assessment"],
      crmExternalId: "helmonic-lead:older-current-granted-acoustic-condition",
    }),
    planningLead({
      id: "stale-granted-acoustic-condition",
      classification: "granted-with-noise-conditions",
      projectStage: "GRANT PERMISSION WITH CONDITIONS",
      deadline: "2026-09-15",
      sourceMajorUpdatedAt: "2026-01-10",
      evidenceStatus: "official-text",
      evidenceExcerpt: "Permission granted with a condition requiring an acoustic report.",
      matchedTerms: ["acoustic report"],
      crmExternalId: "helmonic-lead:stale-granted-acoustic-condition",
    }),
  ], new Date("2026-10-21T12:00:00.000Z"));
  const values = Object.fromEntries(payloads.map((payload) => [payload.matchValue, payload.values]));
  assert.equal(values["helmonic-lead:newest-granted-acoustic-condition"].x_lead_panel, "Granted with Acoustic Conditions");
  assert.equal(values["helmonic-lead:older-current-granted-acoustic-condition"].x_lead_panel, "Granted with Acoustic Conditions");
  assert.ok(values["helmonic-lead:newest-granted-acoustic-condition"].x_pipeline_priority_rank
    > values["helmonic-lead:older-current-granted-acoustic-condition"].x_pipeline_priority_rank);
  assert.equal(values["helmonic-lead:stale-granted-acoustic-condition"].x_lead_panel, "Granted / Follow-up");
  assert.ok(values["helmonic-lead:stale-granted-acoustic-condition"].x_pipeline_priority_rank < 1_000);
  assert.equal(values["helmonic-lead:stale-granted-acoustic-condition"].active, true);
});

test("Odoo keeps all potential acoustic fits together while Part E leads retain commercial priority", () => {
  const records = [
    planningLead({
      id: "part-e-higher-value",
      evidenceStatus: "discovery-metadata",
      evidenceExcerpt: "",
      classification: "design-construction-potential",
      leadQuality: "good",
      leadDisposition: "nurture",
      residentialScale: "attached-4-plus",
      residentialUnitCount: 40,
      projectValue: 12_000_000,
      crmExternalId: "helmonic-lead:part-e-higher-value",
    }),
    planningLead({
      id: "part-e-lower-value",
      evidenceStatus: "discovery-metadata",
      evidenceExcerpt: "",
      classification: "design-construction-potential",
      leadQuality: "good",
      leadDisposition: "nurture",
      residentialScale: "attached-4-plus",
      residentialUnitCount: 8,
      projectValue: 2_000_000,
      crmExternalId: "helmonic-lead:part-e-lower-value",
    }),
    planningLead({
      id: "general-potential-fit",
      evidenceStatus: "discovery-metadata",
      evidenceExcerpt: "",
      classification: "design-construction-potential",
      leadQuality: "medium",
      leadDisposition: "monitor",
      residentialScale: "not-residential",
      projectValue: 20_000_000,
      crmExternalId: "helmonic-lead:general-potential-fit",
    }),
  ];
  const payloads = buildOdooDryRun(records, new Date("2026-10-12T12:00:00.000Z"));
  for (const payload of payloads) {
    assert.equal(payload.values.x_lead_panel, "Potential Acoustic Fit");
    assert.equal(payload.values.x_lead_quality, "potential");
    assert.equal(payload.values.active, true);
  }
  for (const payload of payloads.filter((payload) => payload.matchValue.includes("part-e"))) {
    assert.equal(payload.values.x_pipeline_priority_rank, 500);
    assert.match(payload.values.x_pipeline_priority_reason, /ordered by project value/i);
    assert.ok(payload.statusTagNames.includes("Part E Commercial"));
  }
  const generalPotential = payloads.find((payload) => payload.matchValue === "helmonic-lead:general-potential-fit");
  assert.equal(generalPotential.values.x_pipeline_priority_rank, 220);
  assert.ok(!generalPotential.statusTagNames.includes("Part E Commercial"));
  const sorted = [...payloads].sort((left, right) =>
    right.values.x_pipeline_priority_rank - left.values.x_pipeline_priority_rank
      || Number(right.values.x_project_value) - Number(left.values.x_project_value));
  assert.equal(sorted[0].matchValue, "helmonic-lead:part-e-higher-value");
  assert.equal(sorted[1].matchValue, "helmonic-lead:part-e-lower-value");
  assert.equal(sorted[2].matchValue, "helmonic-lead:general-potential-fit");
});

test("Odoo archives expired RFIs out of active Leads while retaining their audit context", () => {
  const records = [
    planningLead({
      id: "live-buildinginfo-rfi",
      sourceSystem: "BuildingInfo",
      classification: "noise-related-rfi",
      responseDeadline: "2026-10-18",
      leadQuality: "excellent",
      leadDisposition: "active",
      crmExternalId: "helmonic-lead:live-buildinginfo-rfi",
    }),
    planningLead({
      id: "expired-matched-rfi",
      sourceSystem: "BuildingInfo",
      classification: "noise-related-rfi",
      responseDeadline: "2026-09-15",
      leadQuality: "excellent",
      leadDisposition: "active",
      emailRelationshipStatus: "verified-single-owner",
      emailRelationshipOwner: "Glen",
      routedTo: "Glen",
      crmExternalId: "helmonic-lead:expired-matched-rfi",
    }),
    planningLead({
      id: "recently-expired-unmatched-rfi",
      classification: "noise-related-rfi",
      responseDeadline: "2026-10-10",
      leadQuality: "excellent",
      leadDisposition: "active",
      emailRelationshipStatus: "no-confirmed-match",
      routedTo: "Owen",
      crmExternalId: "helmonic-lead:recently-expired-unmatched-rfi",
    }),
    planningLead({
      id: "answered-rfi",
      classification: "noise-related-rfi",
      responseDeadline: "2026-10-18",
      rfiResponseReceivedAt: "2026-10-11",
      leadQuality: "excellent",
      leadDisposition: "active",
      crmExternalId: "helmonic-lead:answered-rfi",
    }),
    planningLead({
      id: "stale-undated-rfi",
      classification: "noise-related-rfi",
      rfiPublishedAt: "2026-07-01",
      responseDeadline: "",
      leadQuality: "excellent",
      leadDisposition: "active",
      crmExternalId: "helmonic-lead:stale-undated-rfi",
    }),
    planningLead({
      id: "expired-planning-decision",
      deadline: "2026-09-15",
      projectStage: "Plans Applied",
      leadQuality: "excellent",
      leadDisposition: "active",
      emailRelationshipStatus: "verified-single-owner",
      emailRelationshipOwner: "Glen",
      routedTo: "Glen",
      crmExternalId: "helmonic-lead:expired-planning-decision",
    }),
    planningLead({
      id: "granted-post-decision",
      deadline: "2026-09-15",
      projectStage: "Plans Granted",
      leadQuality: "excellent",
      leadDisposition: "active",
      crmExternalId: "helmonic-lead:granted-post-decision",
    }),
    planningLead({
      id: "expired-formal-tender",
      type: "formal-public-tender",
      deadline: "2026-10-01",
      crmExternalId: "helmonic-lead:expired-formal-tender",
    }),
    planningLead({
      id: "live-formal-tender",
      type: "formal-public-tender",
      deadline: "2026-10-20",
      crmExternalId: "helmonic-lead:live-formal-tender",
    }),
  ];
  const payloads = buildOdooDryRun(records, new Date("2026-10-12T12:00:00.000Z"));
  const values = Object.fromEntries(payloads.map((payload) => [payload.matchValue, payload.values]));
  assert.ok(values["helmonic-lead:live-buildinginfo-rfi"].x_pipeline_priority_rank > 500_000_000);
  assert.equal(values["helmonic-lead:live-buildinginfo-rfi"].x_lead_panel, "Urgent Acoustic RFI");
  assert.equal(values["helmonic-lead:live-buildinginfo-rfi"].active, true);
  assert.ok(values["helmonic-lead:recently-expired-unmatched-rfi"].x_pipeline_priority_rank < 0);
  assert.ok(values["helmonic-lead:expired-matched-rfi"].x_pipeline_priority_rank < 0);
  assert.ok(
    values["helmonic-lead:recently-expired-unmatched-rfi"].x_pipeline_priority_rank
      > values["helmonic-lead:expired-matched-rfi"].x_pipeline_priority_rank,
  );
  assert.equal(values["helmonic-lead:recently-expired-unmatched-rfi"].x_lead_panel, "Competitive / Re-engagement");
  assert.equal(values["helmonic-lead:expired-matched-rfi"].x_lead_panel, "Competitive / Re-engagement");
  assert.equal(values["helmonic-lead:recently-expired-unmatched-rfi"].active, false);
  assert.equal(values["helmonic-lead:expired-matched-rfi"].active, false);
  assert.equal(values["helmonic-lead:answered-rfi"].active, false);
  assert.equal(values["helmonic-lead:stale-undated-rfi"].active, false);
  assert.match(values["helmonic-lead:answered-rfi"].x_pipeline_priority_reason, /archived from active Leads/i);
  assert.equal(values["helmonic-lead:recently-expired-unmatched-rfi"].x_rfi_response_due_at, "2026-10-10 00:00:00");
  assert.equal(values["helmonic-lead:expired-matched-rfi"].x_rfi_response_due_at, "2026-09-15 00:00:00");
  assert.match(values["helmonic-lead:expired-matched-rfi"].x_pipeline_priority_reason, /archived from active Leads/i);
  assert.equal(values["helmonic-lead:expired-planning-decision"].active, false);
  assert.equal(values["helmonic-lead:expired-planning-decision"].x_pipeline_priority_rank, 180);
  assert.match(values["helmonic-lead:expired-planning-decision"].x_pipeline_priority_reason, /refresh required/i);
  assert.equal(values["helmonic-lead:granted-post-decision"].x_pipeline_priority_rank, 100);
  assert.equal(values["helmonic-lead:granted-post-decision"].x_lead_panel, "Competitive / Re-engagement");
  assert.equal(values["helmonic-lead:expired-formal-tender"].active, false);
  assert.equal(values["helmonic-lead:live-formal-tender"].active, true);
  assert.equal(values["helmonic-lead:expired-planning-decision"].date_deadline, false);
  assert.equal(values["helmonic-lead:expired-planning-decision"].x_deadline, false);
  assert.equal(values["helmonic-lead:expired-planning-decision"].x_action_days_remaining, false);
  assert.match(values["helmonic-lead:expired-planning-decision"].x_deadline_urgency, /not an RFI response deadline/i);
  assert.equal(values["helmonic-lead:expired-planning-decision"].x_decision_due_at, "2026-09-15 00:00:00");
});

test("Odoo orders only live planning decisions by date and demotes decided or expired applications", () => {
  const payloads = buildOdooDryRun([
    planningLead({
      id: "live-planning-sooner",
      deadline: "2026-10-15",
      projectStage: "Plans Applied",
      leadQuality: "medium",
      leadDisposition: "nurture",
      crmExternalId: "helmonic-lead:live-planning-sooner",
    }),
    planningLead({
      id: "live-planning-later",
      sourceSystem: "BuildingInfo",
      deadline: "2026-10-20",
      projectStage: "Plans Applied",
      leadQuality: "excellent",
      leadDisposition: "active",
      emailRelationshipStatus: "verified-single-owner",
      emailRelationshipOwner: "Glen",
      crmExternalId: "helmonic-lead:live-planning-later",
    }),
    planningLead({
      id: "expired-conditional-planning",
      deadline: "2026-09-15",
      projectStage: "CONDITIONAL",
      leadQuality: "excellent",
      leadDisposition: "active",
      crmExternalId: "helmonic-lead:expired-conditional-planning",
    }),
  ], new Date("2026-10-12T12:00:00.000Z"));
  const values = Object.fromEntries(payloads.map((payload) => [payload.matchValue, payload.values]));
  assert.ok(values["helmonic-lead:live-planning-sooner"].x_pipeline_priority_rank
    > values["helmonic-lead:live-planning-later"].x_pipeline_priority_rank);
  assert.ok(values["helmonic-lead:live-planning-later"].x_pipeline_priority_rank
    > values["helmonic-lead:expired-conditional-planning"].x_pipeline_priority_rank);
  assert.equal(values["helmonic-lead:expired-conditional-planning"].x_lead_panel, "Competitive / Re-engagement");
  assert.equal(values["helmonic-lead:expired-conditional-planning"].active, false);
  assert.match(values["helmonic-lead:expired-conditional-planning"].x_pipeline_priority_reason, /demoted below live work/i);
});

test("Odoo promotes exact evidence-backed relationship emails into visible CRM contacts", () => {
  const payload = buildOdooDryRun([planningLead({
    id: "relationship-contact-promotion",
    parties: [{
      role: "applicant",
      name: "Ashcroft Private Limited",
      organisation: "Ashcroft Private Limited",
      phone: "+353 1 555 0100",
    }],
    emailRelationshipStatus: "verified-single-owner",
    emailRelationshipOwner: "Glen",
    routedTo: "Glen",
    routingEvidence: [{
      party: "Ashcroft Private Limited",
      matchedEntity: "Mark Bridley",
      matchedEmail: "mark.bridley@example.ie",
      historicalEmails: ["projects@example.ie"],
      historicalPhones: ["+353 1 555 0100"],
      previousProjects: ["Ashcroft Offices", "Ashcroft Apartments"],
      emailSubject: "Ashcroft acoustic review",
      emailContext: "Glen discussed the earlier acoustic review and next steps with Mark.",
      matchType: "exact-name",
      evidenceOwners: ["Glen"],
      evidenceRefs: ["[E:glen:ashcroft-1]"],
      emailSentAt: "2025-04-03T09:30:00Z",
    }],
    projectHistoryStatus: "matched",
    historicalProjectMatches: [{
      title: "Ashcroft Office Acoustic Design",
      relationship: "same-organisation",
      matchedOn: ["organisation Ashcroft Private Limited"],
      sourceId: "project-history-ashcroft",
      sourceUri: "rag://project-history-ashcroft",
      excerpt: "iAcoustics completed the acoustic design review for Ashcroft Offices.",
      score: 4.2,
    }],
    crmExternalId: "helmonic-lead:relationship-contact-promotion",
  })], new Date("2026-10-12T12:00:00.000Z"))[0];
  assert.equal(payload.values.contact_name, "Mark Bridley");
  assert.equal(payload.values.partner_name, "Ashcroft Private Limited");
  assert.equal(payload.values.email_from, "mark.bridley@example.ie");
  assert.match(payload.values.x_party_details, /projects@example\.ie/);
  assert.match(payload.values.x_party_details, /\+353 1 555 0100/);
  assert.match(payload.values.x_party_details, /verified iAcoustics email-history contact/);
  assert.match(payload.values.description, /Verified iAcoustics email-history match/);
  assert.match(payload.values.description, /Glen Plunkett previously corresponded with Mark Bridley/);
  assert.match(payload.values.description, /2 earlier or similar projects: Ashcroft Offices, Ashcroft Apartments/);
  assert.doesNotMatch(payload.values.description, /Full Matched Email Evidence/);
  assert.match(payload.values.x_relationship_summary, /mark\.bridley@example\.ie/);
  assert.match(payload.values.x_relationship_summary, /Glen discussed the earlier acoustic review and next steps with Mark/);
  assert.match(payload.values.x_relationship_evidence, /\[E:glen:ashcroft-1\]/);
  assert.match(payload.values.x_project_history_summary, /Ashcroft Office Acoustic Design/);
  assert.match(payload.values.x_project_history_evidence, /rag:\/\/project-history-ashcroft/);
});

test("controlled Azure RAG history identifies same-project and related iAcoustics project evidence", async () => {
  const previous = {
    enabled: process.env.HELMONIC_PROJECT_HISTORY_SEARCH_ENABLED,
    endpoint: process.env.AZURE_PROJECT_HISTORY_SEARCH_ENDPOINT,
    index: process.env.AZURE_PROJECT_HISTORY_SEARCH_INDEX,
  };
  process.env.HELMONIC_PROJECT_HISTORY_SEARCH_ENABLED = "true";
  process.env.AZURE_PROJECT_HISTORY_SEARCH_ENDPOINT = "https://search.example.test";
  process.env.AZURE_PROJECT_HISTORY_SEARCH_INDEX = "iacoustics-project-history";
  try {
    const result = await enrichWithHistoricalProjectMatches([planningLead({
      id: "rag-history-1",
      title: "Ashcroft Office Development in Dublin",
      projectReference: "DCC-1234-26",
      projectSector: "Commercial office",
      location: "Dublin",
      parties: [{
        role: "architect",
        name: "Reddy Architecture",
        organisation: "Reddy Architecture",
        email: "projects@reddyarchitecture.ie",
      }],
    })], {
      accessToken: "test-token",
      fetcher: async (_request, options = {}) => {
        const request = JSON.parse(String(options.body));
        assert.match(request.search, /Ashcroft Office Development/);
        assert.equal(request.filter, "permission_scope eq 'iAcoustics'");
        return Response.json({ value: [{
          "@search.score": 9.5,
          source_id: "historical-project-1",
          source_uri: "rag://historical-project-1",
          title: "Ashcroft Office Development — acoustic design",
          section: "Project history",
          content: "Reference DCC-1234-26. iAcoustics worked with Reddy Architecture on the acoustic design.",
        }] });
      },
    });
    assert.equal(result.enabled, true);
    assert.equal(result.queriedRecords, 1);
    assert.equal(result.matchedRecords, 1);
    assert.equal(result.records[0].projectHistoryStatus, "matched");
    assert.equal(result.records[0].historicalProjectMatches[0].relationship, "same-project");
    assert.equal(result.records[0].historicalProjectMatches[0].sourceId, "historical-project-1");
  } finally {
    if (previous.enabled === undefined) delete process.env.HELMONIC_PROJECT_HISTORY_SEARCH_ENABLED;
    else process.env.HELMONIC_PROJECT_HISTORY_SEARCH_ENABLED = previous.enabled;
    if (previous.endpoint === undefined) delete process.env.AZURE_PROJECT_HISTORY_SEARCH_ENDPOINT;
    else process.env.AZURE_PROJECT_HISTORY_SEARCH_ENDPOINT = previous.endpoint;
    if (previous.index === undefined) delete process.env.AZURE_PROJECT_HISTORY_SEARCH_INDEX;
    else process.env.AZURE_PROJECT_HISTORY_SEARCH_INDEX = previous.index;
  }
});

test("Odoo never promotes unverified relationship email claims into contact fields", () => {
  const payload = buildOdooDryRun([planningLead({
    id: "unverified-contact-not-promoted",
    emailRelationshipStatus: "no-confirmed-match",
    routingEvidence: [{
      party: "Example Applicant",
      matchedEntity: "Unverified Person",
      matchedEmail: "unverified@example.ie",
      matchType: "exact-domain",
      evidenceOwners: [],
      evidenceRefs: [],
    }],
    crmExternalId: "helmonic-lead:unverified-contact-not-promoted",
  })])[0];
  assert.equal(payload.values.email_from, "");
  assert.equal(payload.values.contact_name, "");
});

test("Odoo clears only legacy source IDs from Lead Reference and preserves A/L/Q/J numbers", () => {
  assert.equal(legacySourceReferenceInLeadReference(
    { x_studio_reference: "NPR-2660381", x_source_reference: "NPR-2660381" },
    "NPR-2660381",
    "2660381",
  ), true);
  for (const reference of ["A-0001", "L-0001", "Q-0001", "J-0001", "Human reference"]) {
    assert.equal(legacySourceReferenceInLeadReference(
      { x_studio_reference: reference, x_source_reference: "NPR-2660381" },
      "NPR-2660381",
      "2660381",
    ), false);
  }
});

test("Odoo synchronization can create missing attribution records, link the primary contact and update one existing lead", async () => {
  const records = annotateOpportunityDuplicates([qualifyLead(planningLead({
    id: "buildinginfo-contact-sync",
    sourceSystem: "BuildingInfo",
    sourceRecordId: "424562",
    projectReference: "2660722",
    planningAuthority: "Wicklow County Council",
    title: "€3.2m Industrial Unit Development in Arklow",
    description: "Single-storey industrial unit",
    location: "Kish Business Park, Clogga Road, Arklow, Co. Wicklow",
    projectSector: "Industrial",
    classification: "noise-related-rfi",
    parties: [{
      role: "applicant",
      name: "Alan Armstrong",
      organisation: "Armstrong Timber Engineering Ltd.",
      email: "sales@ate.ie",
      phone: "0402 33477",
    }],
    routedTo: "Glen",
    emailRelationshipStatus: "verified-single-owner",
    emailRelationshipOwner: "Glen",
  }), new Date("2026-10-07T12:00:00.000Z"))]);
  const payloads = buildOdooDryRun(records);
  const createdModels = [];
  let writtenValues;
  const fetcher = async (request, options = {}) => {
    const url = String(request);
    const body = options.body ? JSON.parse(String(options.body)) : {};
    if (url.endsWith("/web/version")) return Response.json({ version_info: [19, 0, 0, "final"] });
    if (url.endsWith("/crm.lead/fields_get")) {
      return Response.json(Object.fromEntries(body.allfields.map((field) => [field, {
        type: ODOO_TENDER_FIELD_TYPES[field] ?? ({
          name: "char",
          active: "boolean",
          description: "html",
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
          type: "selection",
          team_id: "many2one",
          user_id: "many2one",
          priority: "selection",
        }[field] ?? "char"),
        ...(field === "x_studio_project_sector" ? { selection: [["industrial", "Industrial"], ["other", "Other"]] } : {}),
      }])));
    }
    if (url.endsWith("/crm.lead/search_read")) return Response.json([{
      id: 69,
      x_studio_reference: "BI-2660722",
      x_source_reference: "BI-2660722",
      x_project_reference: "2660722",
    }]);
    if (url.endsWith("/utm.campaign/search_read")
      || url.endsWith("/utm.medium/search_read")
      || url.endsWith("/utm.source/search_read")
      || url.endsWith("/crm.tag/search_read")
      || url.endsWith("/res.partner/search_read")) return Response.json([]);
    if (url.endsWith("/utm.campaign/create")) {
      createdModels.push("campaign");
      return Response.json([101]);
    }
    if (url.endsWith("/utm.medium/create")) {
      createdModels.push("medium");
      return Response.json([102]);
    }
    if (url.endsWith("/utm.source/create")) {
      createdModels.push("source");
      return Response.json([103]);
    }
    if (url.endsWith("/crm.tag/create")) {
      const name = body.vals_list[0].name;
      if (name === "BI") {
        createdModels.push("source-tag");
        return Response.json([105]);
      }
      createdModels.push("email-tag");
      assert.equal(name, "Email Match: Glen");
      return Response.json([106]);
    }
    if (url.endsWith("/res.partner/create")) {
      createdModels.push("contact");
      assert.equal(body.vals_list[0].email, "sales@ate.ie");
      return Response.json([104]);
    }
    if (url.endsWith("/crm.lead/write")) {
      writtenValues = body.vals;
      return Response.json(true);
    }
    return new Response("Unexpected request", { status: 500 });
  };
  const result = await syncOdooLeads(payloads, {
    enabled: true,
    baseUrl: "https://odoo.example.test",
    database: "test",
    apiKey: "test-only-key",
    salesTeamId: 1,
    glenUserId: 7,
    populateAttribution: true,
    createMissingAttribution: true,
    populateEmailMatchTags: true,
    createMissingEmailMatchTags: true,
    populateSourceTags: true,
    createMissingSourceTags: true,
    linkPrimaryContact: true,
    createMissingContacts: true,
    requestIntervalMs: 0,
  }, fetcher);
  assert.deepEqual(createdModels, ["campaign", "medium", "source", "source-tag", "email-tag", "contact"]);
  assert.equal(writtenValues.partner_id, 104);
  assert.equal(writtenValues.campaign_id, 101);
  assert.equal(writtenValues.medium_id, 102);
  assert.equal(writtenValues.source_id, 103);
  assert.deepEqual(writtenValues.tag_ids, [[4, 105], [4, 106]]);
  assert.equal(writtenValues.x_studio_project_sector, "industrial");
  assert.equal(writtenValues.x_source_reference, "BI-2660722");
  assert.equal(writtenValues.x_studio_reference, false);
  assert.equal(result.updated, 1);
  assert.equal(result.contactsCreated, 1);
  assert.equal(result.attributionRecordsCreated, 3);
  assert.equal(result.emailMatchTagsCreated, 1);
  assert.equal(result.emailMatchTagsLinked, 1);
  assert.equal(result.sourceTagsCreated, 1);
  assert.equal(result.sourceTagsLinked, 1);
});

test("Odoo normalization upgrades every retained lead without touching manual tags", async () => {
  const records = annotateOpportunityDuplicates([qualifyLead(planningLead({
    id: "current-source-code-record",
    sourceRecordId: "Dublin City:WEB2000/26",
    projectReference: "WEB2000/26",
    planningAuthority: "Dublin City Council",
  }), new Date("2026-10-09T12:00:00.000Z"))]);
  const payloads = buildOdooDryRun(records);
  const writes = [];
  const fetcher = async (request, options = {}) => {
    const url = String(request);
    const body = options.body ? JSON.parse(String(options.body)) : {};
    if (url.endsWith("/web/version")) return Response.json({ version_info: [19, 0, 0, "final"] });
    if (url.endsWith("/crm.lead/fields_get")) {
      return Response.json(Object.fromEntries(body.allfields.map((field) => [field, {
        type: ODOO_TENDER_FIELD_TYPES[field] ?? ({
          name: "char",
          active: "boolean",
          description: "html",
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
          type: "selection",
          team_id: "many2one",
          user_id: "many2one",
          priority: "selection",
        }[field] ?? "char"),
      }])));
    }
    if (url.endsWith("/crm.tag/search_read")) return Response.json([
      { id: 1, name: "Source: National Planning Register" },
      { id: 2, name: "Email Match - Multiple Owners" },
      { id: 3, name: "NPR" },
      { id: 4, name: "Email Match: Glen + Eoghan" },
      { id: 5, name: "Manual outreach tag" },
      { id: 6, name: "DCC" },
      { id: 7, name: "BI" },
    ]);
    if (url.endsWith("/crm.lead/search_read")) {
      if (body.domain?.[0]?.[1] === "!=") return Response.json([
        {
          id: 69,
          active: true,
          name: "J-current",
          tag_ids: [3],
          x_helmonic_external_id: payloads[0].matchValue,
          x_source_systems: "DCC",
          x_project_reference: "WEB2000/26",
          x_studio_reference: "DCC-WEB2000/26",
          x_warm_connection_verified: false,
        },
        {
          id: 70,
          active: false,
          type: "opportunity",
          name: "J-1256",
          street: "Unit 4 Greenacres Shopping Centre, Dundalk, Co. Louth",
          tag_ids: [1, 2, 5],
          x_helmonic_external_id: "helmonic-lead:retained-history",
          x_source_systems: "National Planning Register",
          x_project_reference: "WEB1999/26",
          x_source_urls: "https://planning.localgov.ie/",
          x_studio_reference: "WEB1999/26",
          x_warm_connection_verified: true,
          x_lead_quality: "good",
          x_pipeline_bucket: "nurture",
          x_pipeline_priority_rank: 0,
          x_pipeline_priority_reason: false,
          x_classification: "needs-council-evidence",
          x_opportunity_type: "planning-pipeline-lead",
          x_decision_due_at: "2099-10-20 00:00:00",
          x_first_seen_at: new Date().toISOString(),
          x_assigned_person: false,
          user_id: [7, "Glen Plunkett"],
          x_routing_reason: "exact-party-match-supported-by-glen-email-evidence",
        },
        {
          id: 71,
          active: false,
          type: "opportunity",
          name: "[BI] J-buildinginfo-rfi",
          tag_ids: [4, 7],
          x_helmonic_external_id: "helmonic-lead:buildinginfo-rfi-history",
          x_source_systems: "BuildingInfo",
          x_project_reference: "424562",
          x_project_link: "https://app.buildinginfo.com/p-OTNsZQ==-",
          x_studio_reference: "BI-424562",
          x_warm_connection_verified: true,
          x_lead_quality: "excellent",
          x_pipeline_bucket: "active",
          x_pipeline_priority_rank: 0,
          x_pipeline_priority_reason: false,
          x_classification: "noise-related-rfi",
          x_evidence_status: "official-text",
          x_evidence_excerpt: "The applicant shall submit a noise impact assessment.",
          x_matched_terms: "noise",
          x_opportunity_type: "planning-pipeline-lead",
          x_rfi_response_due_at: "2099-10-20 00:00:00",
        },
        {
          id: 72,
          active: true,
          type: "opportunity",
          name: "Part E residential scheme",
          tag_ids: [3],
          x_helmonic_external_id: "helmonic-lead:part-e-history",
          x_source_systems: "National Planning Register",
          x_project_reference: "PART-E-26",
          x_studio_reference: "NPR-PART-E-26",
          x_warm_connection_verified: false,
          x_lead_quality: "potential",
          x_lead_panel: "Part E Commercial Review",
          x_pipeline_bucket: "nurture",
          x_pipeline_priority_rank: 220,
          x_pipeline_priority_reason: false,
          x_classification: "design-construction-potential",
          x_evidence_status: "official-text",
          x_evidence_excerpt: "Residential scheme with attached units; no current acoustic requirement confirmed.",
          x_matched_terms: false,
          x_opportunity_type: "planning-pipeline-lead",
          x_project_value: 12_000_000,
          x_residential_scale: "attached-4-plus",
        },
        {
          id: 73,
          active: true,
          type: "lead",
          name: "Expired managed acoustic RFI",
          tag_ids: [6],
          x_helmonic_external_id: "helmonic-lead:expired-managed-rfi",
          x_source_systems: "DCC",
          x_project_reference: "EXPIRED-RFI-26",
          x_studio_reference: "DCC-EXPIRED-RFI-26",
          x_warm_connection_verified: false,
          x_lead_quality: "excellent",
          x_pipeline_bucket: "active",
          x_classification: "noise-related-rfi",
          x_evidence_status: "official-text",
          x_evidence_excerpt: "Submit a noise impact assessment.",
          x_matched_terms: "noise impact assessment",
          x_opportunity_type: "planning-pipeline-lead",
          x_rfi_response_due_at: "2026-01-15 00:00:00",
        },
      ]);
      if (body.domain?.[0]?.[2] === false) {
        return Response.json([{ id: 74, name: "New Hotel Project, Dublin 2" }]);
      }
      return Response.json([{ id: 69, tag_ids: [3] }]);
    }
    if (url.endsWith("/crm.lead/write")) {
      writes.push({ ids: body.ids, vals: body.vals });
      return Response.json(true);
    }
    return new Response("Unexpected request", { status: 500 });
  };
  const result = await syncOdooLeads(payloads, {
    enabled: true,
    baseUrl: "https://odoo.example.test",
    database: "test",
    apiKey: "test-only-key",
    salesTeamId: 1,
    glenUserId: 7,
    eoghanUserId: 6,
    populateEmailMatchTags: true,
    createMissingEmailMatchTags: true,
    populateSourceTags: true,
    createMissingSourceTags: true,
    normalizeHistoricalRecords: true,
    migrateManagedRecordsToLeads: true,
    archiveUnmanagedTestFixtures: true,
    requestIntervalMs: 0,
  }, fetcher);
  const historical = writes.find((write) => write.ids[0] === 70);
  const buildingInfoHistorical = writes.find((write) => write.ids[0] === 71);
  const partEHistorical = writes.find((write) => write.ids[0] === 72);
  const expiredHistorical = writes.find((write) => write.ids[0] === 73);
  assert.equal(result.historicalRecordsNormalized, 5);
  assert.equal(result.managedRecordsMovedToLeads, 3);
  assert.equal(writes.some((write) => write.ids[0] === 69 && Object.hasOwn(write.vals, "name")), false);
  assert.equal(historical.vals.name, "Unit 4 Greenacres Shopping Centre, Dundalk, Co. Louth");
  assert.equal(historical.vals.x_source_reference, "NPR-WEB1999/26");
  assert.equal(historical.vals.x_studio_reference, false);
  assert.equal(historical.vals.x_pipeline_priority_rank, 20_020);
  assert.equal(historical.vals.x_lead_panel, "Potential Acoustic Fit");
  assert.equal(historical.vals.x_lead_quality, "potential");
  assert.equal(historical.vals.priority, "2");
  assert.equal(historical.vals.active, true);
  assert.match(historical.vals.x_project_link, /planning\.localgov\.ie\/search\/application\?/);
  assert.equal(historical.vals.x_assigned_person, "");
  assert.equal(historical.vals.user_id, false);
  assert.equal(historical.vals.type, "lead");
  assert.match(historical.vals.x_routing_reason, /historical email relationship retained for context/i);
  assert.match(historical.vals.x_routing_reason, /Prior route: exact-party-match-supported-by-glen-email-evidence/);
  assert.match(
    historical.vals.x_pipeline_priority_reason,
    /Secondary planning monitor: decision due in \d+ days;.*verified historical relationship retained/i,
  );
  assert.deepEqual(historical.vals.tag_ids, [[3, 1], [3, 2], [4, 3], [4, 4]]);
  assert.ok(!historical.vals.tag_ids.some(([, id]) => id === 5));
  assert.equal(buildingInfoHistorical.vals.x_pipeline_priority_rank, 1_600_075_000);
  assert.equal(buildingInfoHistorical.vals.x_lead_panel, "Urgent Acoustic RFI");
  assert.equal(buildingInfoHistorical.vals.name, "J-buildinginfo-rfi");
  assert.equal(buildingInfoHistorical.vals.type, "lead");
  assert.equal(buildingInfoHistorical.vals.priority, "3");
  assert.equal(buildingInfoHistorical.vals.active, true);
  assert.match(
    buildingInfoHistorical.vals.x_pipeline_priority_reason,
    /^Active acoustic RFI due in \d+ days; response deadline takes precedence; RFI received\/published date unavailable; human-reviewed BuildingInfo source; verified acoustic consultant email relationship$/,
  );
  assert.equal(partEHistorical.vals.x_lead_panel, "Potential Acoustic Fit");
  assert.equal(partEHistorical.vals.x_pipeline_priority_rank, 500);
  assert.match(partEHistorical.vals.x_pipeline_priority_reason, /ordered by project value/i);
  assert.equal(partEHistorical.vals.type, "lead");
  assert.equal(Object.hasOwn(partEHistorical.vals, "active"), false);
  assert.equal(expiredHistorical.vals.x_lead_panel, "Competitive / Re-engagement");
  assert.ok(expiredHistorical.vals.x_pipeline_priority_rank < 0);
  assert.match(expiredHistorical.vals.x_pipeline_priority_reason, /competitive follow-up/i);
  assert.equal(expiredHistorical.vals.priority, "0");
  assert.equal(expiredHistorical.vals.active, false);
  assert.equal(writes.find((write) => write.ids[0] === 74).vals.active, false);
  assert.equal(result.unmanagedTestFixturesArchived, 1);
  assert.equal(result.managedRfisArchived, 1);
  assert.equal(result.managedRfisReactivated, 1);
  assert.ok(result.managedLeadsArchived >= 1);
  assert.equal(result.managedLeadsReactivated, 2);
});

test("Odoo never assigns a consultant when only historical email evidence exists", () => {
  const [payload] = buildOdooDryRun([{
    ...planningLead({
      id: "relationship-only-not-acoustic",
      evidenceStatus: "discovery-only",
      evidenceExcerpt: "Mixed-use development with an architect previously known to iAcoustics.",
      classification: "design-construction-potential",
      matchedTerms: [],
      routedTo: "Glen",
      routingStatus: "routed",
      routingReason: "exact-party-match-supported-by-glen-email-evidence",
      emailRelationshipStatus: "verified-single-owner",
      emailRelationshipOwner: "Glen",
    }),
    crmExternalId: "helmonic-lead:relationship-only-not-acoustic",
  }], new Date("2026-10-14T12:00:00Z"));
  assert.equal(payload.values.x_warm_connection_verified, true);
  assert.equal(payload.emailMatchTagName, "Email Match: Glen");
  assert.equal(payload.values.x_assigned_person, "");
  assert.equal(payload.values.x_lead_quality, "potential");
  assert.match(payload.values.x_routing_reason, /historical email relationship retained for context/i);
  assert.match(payload.values.x_routing_reason, /Match context: exact-party-match-supported-by-glen-email-evidence/);
  assert.match(payload.values.description, /Potential only.*current-project acoustic evidence unconfirmed/i);
  assert.ok(payload.values.x_pipeline_priority_rank < 600);
});

test("Odoo refreshes enrich source evidence without overwriting human CRM decisions", async () => {
  const records = annotateOpportunityDuplicates([qualifyLead(planningLead({
    id: "national-cross-run-source",
    sourceSystem: "National Planning Register",
    sourceRecordId: "Wicklow:2660722",
    projectReference: "2660722",
    planningAuthority: "Wicklow County Council",
    title: "Industrial Unit Development in Arklow",
    parties: [{
      role: "applicant",
      name: "New Source Contact",
      organisation: "New Source Organisation",
      email: "new-source@example.ie",
      phone: "01 555 9999",
    }],
    routedTo: "Owen",
  }), new Date("2026-10-09T12:00:00.000Z"))]);
  const payloads = buildOdooDryRun(records);
  let writtenValues;
  const fetcher = async (request, options = {}) => {
    const url = String(request);
    const body = options.body ? JSON.parse(String(options.body)) : {};
    if (url.endsWith("/web/version")) return Response.json({ version_info: [19, 0, 0, "final"] });
    if (url.endsWith("/crm.lead/fields_get")) {
      return Response.json(Object.fromEntries(body.allfields.map((field) => [field, {
        type: ODOO_TENDER_FIELD_TYPES[field] ?? ({
          name: "char",
          active: "boolean",
          description: "html",
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
          type: "selection",
          team_id: "many2one",
          user_id: "many2one",
          priority: "selection",
        }[field] ?? "char"),
        ...(field === "x_studio_project_sector" ? { selection: [["industrial", "Industrial"], ["other", "Other"]] } : {}),
      }])));
    }
    if (url.endsWith("/crm.lead/search_read")) return Response.json([{
      id: 69,
      type: "opportunity",
      partner_id: [501, "Manually selected contact"],
      partner_name: "Armstrong Timber Engineering Ltd.",
      contact_name: "Manually Corrected Contact",
      email_from: "manual-correction@example.ie",
      phone: "01 555 0101",
      function: "Applicant",
      street: "Kish Business Park, Arklow",
      x_applicant: "Armstrong Timber Engineering Ltd.",
      x_party_details: "applicant | Alan Armstrong | Armstrong Timber Engineering Ltd. | sales@ate.ie | 0402 33477",
      x_source_systems: "BuildingInfo",
      x_source_ledger: "Source: BuildingInfo | Record ID: 424562 | URL: https://app.buildinginfo.com/p-OTNsZQ==-",
      x_source_record_ids: "BuildingInfo:424562",
      x_source_urls: "https://app.buildinginfo.com/p-OTNsZQ==-\nhttps://planning.localgov.ie/",
      x_project_link: "https://planning.localgov.ie/",
      x_evidence_document_urls: "https://buildinginfo.example/evidence.pdf",
      x_assigned_person: "Glen Plunkett",
      x_warm_connection_verified: true,
      x_routing_reason: "exact-party-match-supported-by-glen-email-evidence",
      x_relationship_summary: "Matched project party: Armstrong Timber Engineering Ltd. | Matched email contact: Alan Armstrong | Verified consultant history: Glen | Matched email date: 2026-09-18 | Matched email subject: Arklow quote | Earlier job(s): Earlier Arklow project | Evidence source: Restricted iAcoustics consultant email evidence index | Source message URI: email-evidence://glen/1 | Evidence reference(s): [E:glen:1]",
      x_acoustic_appointment_status: "iacoustics-appointed",
      x_appointed_acoustician: "iAcoustics",
      x_appointment_evidence: "iAcoustics has been appointed as acoustic consultant.",
      x_appointment_evidence_source_url: "https://buildinginfo.example/appointment.pdf",
      x_competitive_quote_opportunity: false,
      x_outreach_eligibility: "suppressed-already-won",
      x_outreach_suppression_reason: "Already won; cold outreach blocked.",
      x_outreach_key: "planning-outreach:existing-key",
    }]);
    if (url.endsWith("/utm.campaign/search_read")) return Response.json([{ id: 201, name: "Planning Outreach - Acoustics" }]);
    if (url.endsWith("/utm.medium/search_read")) return Response.json([{ id: 202, name: "Planning Intelligence" }]);
    if (url.endsWith("/utm.source/search_read")) {
      assert.equal(body.domain[0][2], "Helmonic Tender Intelligence");
      return Response.json([{ id: 203, name: "Helmonic Tender Intelligence" }]);
    }
    if (url.endsWith("/crm.lead/write")) {
      writtenValues = body.vals;
      return Response.json(true);
    }
    return new Response("Unexpected request", { status: 500 });
  };
  const result = await syncOdooLeads(payloads, {
    enabled: true,
    baseUrl: "https://odoo.example.test",
    database: "test",
    apiKey: "test-only-key",
    salesTeamId: 1,
    glenUserId: 7,
    eoghanUserId: 6,
    populateAttribution: true,
    requestIntervalMs: 0,
  }, fetcher);
  assert.equal(result.updated, 1);
  assert.equal(writtenValues.x_source_systems, "BuildingInfo; National Planning Register");
  assert.match(writtenValues.x_source_ledger, /Source: BuildingInfo|Observation \d+: BuildingInfo/);
  assert.match(writtenValues.x_source_ledger, /Observation \d+: National Planning Register/);
  assert.match(writtenValues.x_source_record_ids, /BuildingInfo:424562/);
  assert.match(writtenValues.x_source_record_ids, /National Planning Register:Wicklow:2660722/);
  assert.match(writtenValues.x_source_urls, /app\.buildinginfo\.com/);
  assert.doesNotMatch(writtenValues.x_source_urls, /planning\.localgov\.ie\/$/);
  assert.notEqual(writtenValues.x_project_link, "https://planning.localgov.ie/");
  assert.ok(writtenValues.x_relationship_summary.length <= 1_600);
  assert.match(writtenValues.x_relationship_summary, /Glen previously corresponded with Alan Armstrong/);
  assert.doesNotMatch(writtenValues.x_relationship_summary, /Evidence source:|Source message URI:|Evidence reference\(s\):/);
  assert.equal(writtenValues.partner_name, "Armstrong Timber Engineering Ltd.");
  assert.equal(writtenValues.contact_name, "Manually Corrected Contact");
  assert.equal(writtenValues.email_from, "manual-correction@example.ie");
  assert.equal(writtenValues.phone, "01 555 0101");
  assert.equal(writtenValues.source_id, 203);
  assert.equal(writtenValues.x_warm_connection_verified, true);
  assert.equal(Object.hasOwn(writtenValues, "partner_id"), false);
  assert.equal(Object.hasOwn(writtenValues, "type"), false);
  assert.equal(Object.hasOwn(writtenValues, "team_id"), false);
  assert.equal(Object.hasOwn(writtenValues, "user_id"), false);
  assert.equal(Object.hasOwn(writtenValues, "priority"), false);
  assert.equal(Object.hasOwn(writtenValues, "stage_id"), false);
  assert.equal(Object.hasOwn(writtenValues, "name"), false);
  assert.equal(Object.hasOwn(writtenValues, "date_deadline"), false);
  assert.equal(Object.hasOwn(writtenValues, "x_studio_reference"), false);
  assert.equal(writtenValues.x_acoustic_appointment_status, "iacoustics-appointed");
  assert.equal(writtenValues.x_appointed_acoustician, "iAcoustics");
  assert.equal(writtenValues.x_outreach_eligibility, "suppressed-already-won");
  assert.equal(writtenValues.x_lead_quality, "existing-project");
  assert.equal(writtenValues.x_pipeline_bucket, "already-won");
});

test("Odoo preflight refuses every write when a required field is missing", async () => {
  const records = annotateOpportunityDuplicates([qualifyLead(planningLead({
    id: "odoo-missing-field",
    sourceRecordId: "WEB1001/26",
    projectReference: "WEB1001/26",
    planningAuthority: "Dublin City Council",
  }), new Date("2026-09-30T12:00:00.000Z"))]);
  const payloads = buildOdooDryRun(records);
  let writeCalls = 0;
  await assert.rejects(() => syncOdooLeads(payloads, {
    enabled: true,
    baseUrl: "https://odoo.example.test",
    apiKey: "test-only-key",
    salesTeamId: 41,
  }, async (request) => {
    const url = String(request);
    if (url.endsWith("/web/version")) return Response.json({ version_info: [19, 0, 0, "final"] });
    if (url.endsWith("/fields_get")) return Response.json({ name: { type: "char" } });
    writeCalls += 1;
    return Response.json({});
  }), /required fields are missing/i);
  assert.equal(writeCalls, 0);
});

test("BuildingInfo parser retains commercial enrichment and company contacts as discovery evidence", () => {
  const [record] = parseBuildingInfoProjects({ data: [{
    planning_id: "364777",
    planning_number: "2443414",
    planning_title: "Residential Development in Dublin",
    planning_category: "Residential",
    planning_subcategory: "Apartments",
    planning_type: "New Build",
    planning_stage: "Commencement",
    planning_value: "88000000",
    planning_units: "550",
    planning_region: "Leinster",
    planning_county: "Dublin",
    council_name: "Dublin City",
    planning_description: "Large Residential Development comprising 550 residential units.",
    planning_url: "https://planning.example.test/2443414",
    planning_application_date: "2026-01-05",
    planning_public_updated: "2026-09-21",
    api_date: "2026-09-21 12:36:58",
    companies: [{
      company_name: "Example Architects Ltd",
      planning_company_type_name: { company_type_name: "Architect" },
      planning_company_contact_name: "A. Architect",
      company_email: "contact@example.test",
    }],
  }] });
  assert.equal(record.sourceSystem, "BuildingInfo");
  assert.equal(record.evidenceStatus, "discovery-only");
  assert.equal(record.projectReference, "2443414");
  assert.equal(record.projectUnits, 550);
  assert.equal(record.projectValue, 88_000_000);
  assert.equal(record.projectStage, "Commencement");
  assert.equal(record.sourceUpdatedAt, "2026-09-21 12:36:58");
  assert.equal(record.parties[0].role, "architect");
  assert.equal(record.parties[0].organisation, "Example Architects Ltd");
});

test("BuildingInfo request builder uses bounded 1000-record pagination and environment-supplied credentials", async () => {
  const config = {
    enabled: true,
    endpoint: "https://api.example.test/projects",
    apiKey: "test-api-key",
    userKey: "test-user-key",
    updateWindow: "0.7",
    pageSize: 2,
    maxPages: 3,
  };
  const url = buildBuildingInfoPageUrl(config, 2);
  assert.equal(url.searchParams.get("api_key"), "test-api-key");
  assert.equal(url.searchParams.get("ukey"), "test-user-key");
  assert.equal(url.searchParams.get("_apion"), "0.7");
  assert.equal(url.searchParams.get("more"), "limit 2,2");
  const offsets = [];
  const result = await collectBuildingInfoProjects(config, async (request) => {
    const requested = new URL(request);
    offsets.push(requested.searchParams.get("more"));
    const offset = Number.parseInt(requested.searchParams.get("more").split(/[ ,]/)[1], 10);
    const count = offset === 0 ? 2 : 1;
    return Response.json({ data: Array.from({ length: count }, (_, index) => ({
      planning_id: String(offset + index + 1),
      planning_title: "Dublin apartment project",
      planning_category: "Residential",
      planning_subcategory: "Apartments",
      planning_url: `https://planning.example.test/${offset + index + 1}`,
    })) });
  });
  assert.deepEqual(offsets, ["limit 0,2", "limit 2,2"]);
  assert.equal(result.records.length, 3);
  assert.equal(result.pagesFetched, 2);
});

test("BuildingInfo agriculture stays excluded and self-build housing remains retained as background", () => {
  const [agriculture] = parseBuildingInfoProjects([{ planning_id: "ag-1", planning_category: "Agriculture", planning_title: "Farm building" }]);
  assert.equal(applyTargetScope(agriculture).scopeStatus, "excluded");
  assert.equal(applyTargetScope(agriculture).scopeExclusionReason, "excluded-agriculture");
  const [selfBuild] = parseBuildingInfoProjects([{
    planning_id: "self-1",
    planning_category: "Self Build",
    planning_subcategory: "House",
    planning_title: "Self-build house in Dublin",
    planning_county: "Dublin",
  }]);
  const qualified = qualifyLead(selfBuild, new Date("2026-09-30T12:00:00.000Z"));
  assert.equal(qualified.leadQuality, "poor");
  assert.equal(qualified.leadDisposition, "background");
});

test("BuildingInfo authenticated browser extraction preserves exact project, RFI and contact evidence", () => {
  const snapshot = {
    projectUrl: "https://app.buildinginfo.com/p-example-token",
    pageTitle: "€3.2m Industrial Unit Development in Arklow | BuildingInfo",
    bodyText: [
      "Project ID 424562",
      "Stage: Further Information Requested",
      "Sector: Industrial",
      "Planning Reference: 2660722",
      "Planning Authority: Wicklow County Council",
      "Site Address: Kish Business Park, Arklow, Co. Wicklow",
      "RFI Published: 20/10/2026",
      "RFI Received: 21/10/2026",
      "RFI Response Due: 12/11/2026",
      "Planning Decision Due: 30/11/2026",
      "Applicant",
      "Armstrong Timber Engineering Ltd.",
      "Alan Armstrong",
      "0402 33477",
      "sales@ate.ie",
      "Architect",
      "Conor McCarthy & Associates Ltd.",
      "Conor McCarthy",
      "040 224660",
      "cmcagroup@gmail.com",
      "The applicant is requested to submit a noise impact assessment prepared by a suitably qualified acoustic consultant.",
    ].join("\n"),
    links: [{ text: "Noise assessment request", href: "https://app.buildinginfo.com/doc/noise-424562.pdf" }],
    observedAt: "2026-10-23T07:00:00.000Z",
  };
  assert.equal(buildingInfoProjectCategory(snapshot), "acoustic-rfi");
  const row = extractBuildingInfoBrowserRow(snapshot);
  assert.ok(row);
  assert.equal(row.building_info_project_id, "424562");
  assert.equal(row.county, "Wicklow");
  assert.equal(row.rfi_published_date, "2026-10-20");
  assert.equal(row.rfi_received_date, "2026-10-21");
  assert.equal(row.rfi_response_due_date, "2026-11-12");
  assert.equal(row.planning_decision_due_date, "2026-11-30");
  assert.equal(row.applicant_email, "sales@ate.ie");
  assert.equal(row.architect_email, "cmcagroup@gmail.com");
  assert.match(row.evidence_document_url, /noise-424562\.pdf/);
  assert.equal(isCurrentBuildingInfoBrowserTarget(row, "acoustic-rfi", new Date("2026-10-23T07:00:00Z")), true);
  const [parsed] = parseBuildingInfoCsv(buildingInfoBrowserRowsToCsv([row]), "buildinginfo-browser-latest.csv");
  assert.equal(parsed.classification, "noise-related-rfi");
  assert.equal(parsed.responseDeadline, "2026-11-12");
  assert.ok(parsed.parties.some((party) => party.email === "sales@ate.ie"));
});

test("BuildingInfo browser guard rejects expired or fulfilled RFIs and accepts acoustic grants", () => {
  const base = {
    projectUrl: "https://app.buildinginfo.com/p-example",
    pageTitle: "Housing Development in Co. Dublin (429657) | BuildingInfo",
    bodyText: "Project ID: 429657\nStage: Further Information Requested\nRFI Response Due: 01/10/2026\nSubmit an acoustic report and noise impact assessment.",
  };
  const expiredRow = extractBuildingInfoBrowserRow(base);
  assert.ok(expiredRow);
  assert.equal(isCurrentBuildingInfoBrowserTarget(expiredRow, buildingInfoProjectCategory(base), new Date("2026-10-23T07:00:00Z")), false);
  const fulfilled = { ...base, bodyText: `${base.bodyText}\nFurther Information Received: 10/10/2026` };
  assert.equal(buildingInfoProjectCategory(fulfilled), "fulfilled-rfi");
  const granted = { ...base, bodyText: "Project ID: 429657\nStage: Plans Granted\nPermission granted subject to an acoustic condition requiring a noise assessment." };
  const grantedRow = extractBuildingInfoBrowserRow(granted);
  assert.ok(grantedRow);
  assert.equal(buildingInfoProjectCategory(granted), "acoustic-grant");
  assert.equal(isCurrentBuildingInfoBrowserTarget(grantedRow, "acoustic-grant", new Date("2026-10-23T07:00:00Z")), true);
});

test("BuildingInfo browser utilities enforce the host and parse local dates and bounded result counts", () => {
  assert.equal(normalizeBuildingInfoDate("6/10/2026"), "2026-10-06");
  assert.deepEqual(parseBuildingInfoResultCount("50 of 70,389 Projects"), { loaded: 50, total: 70_389 });
  assert.match(assertBuildingInfoUrl("https://app.buildinginfo.com/p-example"), /^https:\/\/app\.buildinginfo\.com/);
  assert.throws(() => assertBuildingInfoUrl("https://example.test/phishing"), /Refusing non-BuildingInfo/i);
});

test("BuildingInfo emailed CSV retains exact RFI evidence and project-team contacts", () => {
  const csv = [
    "building_info_project_id,project_title,county,project_url,trigger_type,evidence_document,evidence_excerpt,project_stage,sector,rfi_deadline,planning_reference,planning_authority,unit_count,applicant,applicant_contact,applicant_email,applicant_phone,architect,architect_contact,architect_email,architect_phone",
    "343012,€9.6m Residential Development in Co. Kildare,Kildare,https://app.buildinginfo.test/p-343012,Further Information Request,noise-report.pdf,The developer shall submit a noise impact assessment and acoustic report.,Plans Applied,Residential,2026-10-28,26/1234,Kildare County Council,120,Example Developments Ltd,A. Applicant,applicant@example.test,+35315550000,Example Architects Ltd,A. Architect,architect@example.test,+35310000000",
  ].join("\n");
  const [record] = parseBuildingInfoCsv(csv, "weekly.csv");
  assert.equal(record.sourceSystem, "BuildingInfo");
  assert.equal(record.evidenceStatus, "official-text");
  assert.equal(record.classification, "noise-related-rfi");
  assert.equal(record.responseDeadline, "2026-10-28");
  assert.equal(record.projectSector, "Residential");
  assert.equal(record.triggerType, "Further Information Request");
  assert.equal(record.evidenceDocuments.length, 1);
  assert.match(record.evidenceExcerpt, /noise impact assessment/);
  assert.equal(record.parties[0].role, "applicant");
  assert.equal(record.parties[0].phone, "+35315550000");
  assert.equal(applyTargetScope(record).scopeStatus, "eligible");
  const qualified = qualifyLead(record, new Date("2026-10-07T12:00:00.000Z"));
  assert.equal(qualified.leadQuality, "excellent");
  assert.equal(qualified.leadDisposition, "active");
});

test("BuildingInfo XLSX accepts vendor headers and separates every contact for relationship matching", () => {
  const escapeXml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const column = (index) => {
    let output = "";
    for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
      output = String.fromCharCode(65 + ((value - 1) % 26)) + output;
    }
    return output;
  };
  const headers = [
    "bi_project_id", "project_title", "county", "bi_project_url", "report_type",
    "evidence_document", "evidence_excerpt", "project_stage", "sector", "subsector",
    "residential_units", "last_updated_date", "first_detected_date", "developer_company",
    "developer_contact", "developer_email", "developer_phone", "architect_company",
    "architect_contact", "architect_email", "architect_phone", "other_parties", "planning_portal_url",
  ];
  const serial = (iso) => (Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000;
  const values = [
    424562, "€3.2m Industrial Unit Development in Arklow", "Wicklow",
    "https://app.buildinginfo.com/p-OTNsZQ==-", "acoustic", "noise-report.pdf",
    "Submit a noise impact assessment prepared by a suitably qualified professional.", "Plans Applied",
    "Industrial", "Light Industrial", 0, serial("2026-10-05"), serial("2026-10-04"),
    "Armstrong Timber Engineering Ltd.", "Alan Armstrong", "sales@ate.ie", "0402 33477",
    "Conor McCarthy & Associates Ltd.; Reddy Architecture & Urbanism - Dublin",
    "Conor McCarthy; B. Gilroy", "cmcagroup@gmail.com; info@reddyarchitecture.com",
    "040 224660; 014 987000", "Consultant: Uisce Éireann Irish Water (newconnections@water.ie, 017 072828)",
    "https://www.eplanning.ie/WicklowCC/AppFileRefDetails/2660722/0",
  ];
  const row = (rowNumber, entries) => `<row r="${rowNumber}">${entries.map((value, index) => {
    const ref = `${column(index)}${rowNumber}`;
    return typeof value === "number"
      ? `<c r="${ref}"><v>${value}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
  }).join("")}</row>`;
  const archive = zipSync({
    "xl/workbook.xml": strToU8(`<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Leads" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><worksheet><sheetData>${row(1, headers)}${row(2, values)}</sheetData></worksheet>`),
  });
  const [record] = parseBuildingInfoCsv(xlsxFirstSheetToCsv(archive), "weekly.xlsx");
  assert.equal(record.sourceRecordId, "424562");
  assert.equal(record.triggerType, "acoustic");
  assert.equal(record.sourceUpdatedAt, "2026-10-05");
  assert.equal(record.firstSeenAt, "2026-10-04");
  assert.equal(record.evidenceDocuments[0].sourceUrl, "https://www.eplanning.ie/WicklowCC/AppFileRefDetails/2660722/0");
  assert.equal(record.parties.filter((party) => party.role === "architect").length, 2);
  assert.ok(record.parties.some((party) => party.email === "sales@ate.ie"));
  assert.ok(record.parties.some((party) => party.email === "info@reddyarchitecture.com"));
  assert.ok(record.parties.some((party) => party.email === "newconnections@water.ie"));
});

test("BuildingInfo's dedicated RFI export contract classifies reviewed acoustic rows as RFIs even when report type is generic", () => {
  const csv = [
    "bi_project_id,project_title,county,bi_project_url,report_type,evidence_document,evidence_excerpt,project_stage,rfi_reference,rfi_deadline,first_detected_date",
    "424562,Industrial Unit Development in Arklow,Wicklow,https://app.buildinginfo.com/p-OTNsZQ==-,acoustic,noise-report.pdf,The applicant is requested to submit a noise impact assessment.,Plans Applied,,,2026-10-07",
  ].join("\n");
  const [record] = parseBuildingInfoCsv(csv, "buildinginfo-acoustic-rfi.csv");
  assert.equal(record.classification, "noise-related-rfi");
  assert.equal(record.firstSeenAt, "2026-10-07");
  assert.equal(record.responseDeadline, undefined);
});

test("BuildingInfo weekly CSV keeps RFI received, RFI response due and planning decision dates separate", () => {
  const csv = [
    "bi_project_id,project_title,county,bi_project_url,report_type,evidence_document,evidence_excerpt,project_stage,rfi_reference,rfi_published_date,rfi_received_date,rfi_response_due_date,planning_decision_due_date",
    "424562,Industrial Unit Development in Arklow,Wicklow,https://app.buildinginfo.com/p-OTNsZQ==-,acoustic,noise-report.pdf,The applicant is requested to submit a noise impact assessment.,Plans Applied,RFI-424562,2026-10-04,2026-10-05,2026-11-02,2026-12-14",
  ].join("\n");
  const [record] = parseBuildingInfoCsv(csv, "buildinginfo-acoustic-rfi-dates.csv");
  assert.equal(record.classification, "noise-related-rfi");
  assert.equal(record.sourceMajorUpdatedAt, "2026-10-05");
  assert.equal(record.rfiPublishedAt, "2026-10-04");
  assert.equal(record.county, "Wicklow");
  assert.equal(record.rfiReceivedAt, "2026-10-05");
  assert.equal(record.rfiDateConfidence, "exact");
  assert.equal(record.responseDeadline, "2026-11-02");
  assert.equal(record.deadline, "2026-12-14");
  const [payload] = buildOdooDryRun([{ ...record, crmExternalId: "helmonic-lead:buildinginfo-rfi-dates" }], new Date("2026-10-14T12:00:00.000Z"));
  assert.equal(payload.values.x_rfi_published_at, "2026-10-04 00:00:00");
  assert.equal(payload.values.x_rfi_received_at, "2026-10-05 00:00:00");
  assert.equal(payload.values.x_rfi_response_due_at, "2026-11-02 00:00:00");
  assert.equal(payload.values.x_rfi_date_confidence, "exact");
  assert.equal(payload.values.x_decision_due_at, "2026-12-14 00:00:00");
});

test("BuildingInfo marks a supplied RFI due date as exact even when no received date is provided", () => {
  const csv = [
    "bi_project_id,project_title,county,bi_project_url,report_type,evidence_document,evidence_excerpt,project_stage,rfi_response_due_date",
    "424563,Warehouse Development,Wicklow,https://app.buildinginfo.com/p-example,acoustic,noise-rfi.pdf,Submit a noise impact assessment.,Plans Applied,2026-11-09",
  ].join("\n");
  const [record] = parseBuildingInfoCsv(csv, "buildinginfo-due-only.csv");
  assert.equal(record.responseDeadline, "2026-11-09");
  assert.equal(record.rfiDateConfidence, "exact");
  assert.match(record.rfiDateSource, /supplied RFI date columns/i);
});

test("repeated BuildingInfo weekly rows collapse to one stable project while preserving distinct evidence", () => {
  const header = "project_id,project_title,county,project_url,trigger_type,evidence_document,evidence_excerpt,last_updated";
  const first = parseBuildingInfoCsv([
    header,
    "BI-100,Apartment Development,Dublin,https://app.buildinginfo.test/p-100,RFI,first.pdf,Submit an acoustic assessment.,2026-10-01",
  ].join("\n"), "week-1.csv");
  const second = parseBuildingInfoCsv([
    header,
    "BI-100,Apartment Development,Dublin,https://app.buildinginfo.test/p-100,RFI,first.pdf,Submit an acoustic assessment.,2026-10-01",
    "BI-100,Apartment Development,Dublin,https://app.buildinginfo.test/p-100,RFI,second.pdf,Provide a construction noise and vibration report.,2026-10-07",
  ].join("\n"), "week-2.csv");
  const records = mergeBuildingInfoCsvRecords([...first, ...second]);
  assert.equal(records.length, 1);
  assert.equal(records[0].sourceRecordId, "BI-100");
  assert.equal(records[0].evidenceDocuments.length, 2);
  assert.deepEqual(records[0].sourceObservationFiles, ["week-1.csv row 2", "week-2.csv row 2", "week-2.csv row 3"]);
  assert.match(records[0].evidenceExcerpt, /acoustic assessment/);
  assert.match(records[0].evidenceExcerpt, /vibration report/);
});

test("BuildingInfo export carries appointment evidence and the saved-search identity", () => {
  const csv = [
    "project_id,project_title,county,project_url,trigger_type,evidence_document,evidence_excerpt,appointed_acoustician,appointment_evidence,appointment_evidence_url,appointment_evidence_date,source_search_name",
    "BI-AP-1,Office Development,Dublin,https://app.buildinginfo.test/p-ap-1,RFI,noise.pdf,Submit an acoustic report.,Example Acoustics Ltd,Example Acoustics Ltd has been appointed as acoustic consultant.,https://example.test/appointment,2026-10-10,iAcoustics acoustic opportunity watch",
  ].join("\n");
  const [record] = parseBuildingInfoCsv(csv, "appointments.csv");
  assert.equal(record.appointedAcoustician, "Example Acoustics Ltd");
  assert.match(record.appointmentEvidenceExcerpt, /appointed as acoustic consultant/);
  assert.equal(record.appointmentEvidenceSourceUrl, "https://example.test/appointment");
  assert.equal(record.appointmentEvidenceDate, "2026-10-10");
  assert.equal(record.buildingInfoSearchProfile, "iAcoustics acoustic opportunity watch");
});

test("BuildingInfo CSV fails closed on missing contract columns or malformed row widths", () => {
  assert.throws(() => parseBuildingInfoCsv([
    "project_id,project_title,county,project_url,evidence_document,evidence_excerpt",
    "1,Project,Dublin,https://example.test/1,report.pdf,Acoustic report required",
  ].join("\n"), "missing-trigger.csv"), /missing required.*triggerType/i);
  assert.throws(() => parseBuildingInfoCsv([
    "project_id,project_title,county,project_url,trigger_type,evidence_document,evidence_excerpt",
    "1,Project,Dublin,https://example.test/1,RFI,report.pdf",
  ].join("\n"), "short-row.csv"), /has 6 columns; expected 7/i);
});

test("TED collector uses the official Irish acoustic query and retains official links", () => {
  const request = buildTedSearchRequest();
  assert.match(request.query, /buyer-country=IRL/);
  assert.match(request.query, /classification-cpv=71313100/);
  assert.equal(request.scope, "ACTIVE");
  const records = parseTedNotices({ notices: [{
    "publication-number": "123456-2026",
    "notice-title": { eng: ["Building acoustics consultancy"] },
    "buyer-name": { eng: ["Example County Council"] },
    "classification-cpv": ["71313200"],
    "description-lot": { eng: ["Acoustic design and noise assessment"] },
  }] });
  assert.equal(records.length, 1);
  assert.match(records[0].sourceUrl, /123456-2026/);
});

test("formal tender confirmation requires both approved CPV and acoustic wording in the authoritative notice", async () => {
  const xml = `<?xml version="1.0"?><Notice><CPV>71313200</CPV><Description>Building acoustic consultancy and environmental noise assessment.</Description></Notice>`;
  assert.deepEqual(approvedCpvCodesFromOfficialNotice(xml), ["71313200"]);
  assert.match(textFromOfficialNoticeXml(xml), /acoustic consultancy/);
  const enriched = await enrichFormalTenderEvidence({
    id: "ted-1",
    type: "formal-public-tender",
    sourceSystem: "TED",
    sourceRecordId: "123456-2026",
    title: "Discovery title",
    description: "Discovery summary",
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/123456-2026",
    evidenceStatus: "discovery-only",
    cpvCodes: [],
    matchedTerms: [],
    fitScore: 0,
  }, async () => new Response(xml, { status: 200, headers: { "content-type": "application/xml" } }));
  assert.equal(enriched.evidenceStatus, "official-text");
  assert.notEqual(enriched.classification, "no-relevant-opportunity");
  assert.deepEqual(enriched.cpvCodes, ["71313200"]);
  assert.match(enriched.evidenceDocuments[0].sourceUrl, /\/xml$/);
});

test("formal tender stays unqualified when the authoritative notice lacks an approved CPV", async () => {
  const enriched = await enrichFormalTenderEvidence({
    id: "ted-2",
    type: "formal-public-tender",
    sourceSystem: "TED",
    sourceRecordId: "123457-2026",
    title: "Noise consultancy",
    description: "Noise consultancy",
    sourceUrl: "https://ted.europa.eu/en/notice/-/detail/123457-2026",
    evidenceStatus: "discovery-only",
    cpvCodes: ["71313200"],
    matchedTerms: ["noise"],
    fitScore: 0,
  }, async () => new Response("<Notice><CPV>99999999</CPV><Description>Noise consultancy</Description></Notice>", {
    status: 200,
    headers: { "content-type": "application/xml" },
  }));
  assert.equal(enriched.evidenceStatus, "official-text");
  assert.equal(enriched.classification, "no-relevant-opportunity");
  assert.equal(enriched.routingStatus, "not-qualified");
});

test("TED collector follows every result page and reports the scanned scale", async () => {
  const requestedPages = [];
  const fetcher = async (_url, init) => {
    const request = JSON.parse(init.body);
    requestedPages.push(request.page);
    const notices = request.page === 1
      ? ["100001-2026", "100002-2026"]
      : ["100003-2026"];
    return Response.json({
      totalNoticeCount: 3,
      timedOut: false,
      notices: notices.map((publicationNumber) => ({
        "publication-number": publicationNumber,
        "notice-title": { eng: ["Noise consultancy"] },
        "buyer-name": { eng: ["Kildare County Council"] },
        "classification-cpv": ["71313100"],
        "description-lot": { eng: ["Environmental noise assessment"] },
      })),
    });
  };
  const result = await collectTedOpportunities(fetcher, 2);
  assert.deepEqual(requestedPages, [1, 2]);
  assert.equal(result.scannedRecords, 3);
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.records.length, 3);
});

test("eTenders CSV keeps acoustic notices and ignores irrelevant competitions", () => {
  const records = parseEtendersCsv(
    'CfT Id,CfT Title,Description,Contracting Authority,CPV Code,Notice URL\n' +
      '1,Noise consultancy,Environmental noise assessment,OPW,71313100,https://example.test/1\n' +
      '2,Office stationery,Supply of pens,Example,30192000,https://example.test/2\n',
  );
  assert.equal(records.length, 1);
  assert.equal(records[0].sourceSystem, "eTenders");
});

test("formal tender filter rejects AV, telemetry and component false positives", () => {
  const records = parseEtendersCsv(
    'CfT Id,CfT Title,Description,Contracting Authority,CPV Code,Notice URL,Tender Submission Deadline\n' +
      '1,Audio Visual Services,Sound and video equipment support,Example,92370000,https://example.test/1,01/01/2030\n' +
      '2,Acoustic telemetry equipment,Supply of acoustic telemetry devices,Example,32342400,https://example.test/2,01/01/2030\n' +
      '3,Anti-Vibration Components,Supply of metal rubber anti-vibration components,Example,19500000,https://example.test/3,01/01/2030\n' +
      '4,Building acoustics consultancy,Acoustic design and environmental noise assessment,Example,71313200,https://example.test/4,01/01/2030\n',
  );
  assert.deepEqual(records.map((record) => record.sourceRecordId), ["4"]);
});

test("national register records are discovery-only until council wording is inspected", () => {
  const records = parseNationalPlanningFeatures({ features: [{ attributes: {
    PlanningAuthority: "Example County Council",
    ApplicationNumber: "26/100",
    DevelopmentDescription: "Construction of a 120-unit residential development",
    DevelopmentAddress: "Main Street",
    Decision: "GRANT PERMISSION",
    ReceivedDate: Date.now(),
    DecisionDueDate: Date.parse("2026-11-30T00:00:00Z"),
    FIRequestDate: Date.parse("2026-10-10T00:00:00Z"),
    FIRecDate: Date.parse("2026-10-18T00:00:00Z"),
    LinkAppDetails: "https://example.test/26-100",
  } }] });
  assert.equal(records.length, 1);
  assert.equal(records[0].evidenceStatus, "discovery-only");
  assert.notEqual(records[0].classification, "granted-with-noise-conditions");
  assert.match(records[0].planningReceivedAt, /^20/);
  assert.equal(records[0].deadline, "2026-11-30T00:00:00.000Z");
  assert.equal(records[0].rfiPublishedAt, "2026-10-10T00:00:00.000Z");
  assert.equal(records[0].rfiReceivedAt, "2026-10-10T00:00:00.000Z");
  assert.equal(records[0].rfiResponseReceivedAt, "2026-10-18T00:00:00.000Z");
});

test("national planning links are always project-specific and never a generic portal homepage", () => {
  assert.equal(genericPlanningPortalUrl("https://planning.localgov.ie/"), true);
  assert.equal(
    nationalPlanningProjectUrl("Kildare County Council", "2660381", ""),
    "https://www.eplanning.ie/KildareCC/AppFileRefDetails/2660381/0",
  );
  const dublinUrl = nationalPlanningProjectUrl("Dún Laoghaire-Rathdown County Council", "D26A/0190/WEB", "");
  assert.match(dublinUrl, /^https:\/\/planning\.agileapplications\.ie\/dunlaoghaire\/search-applications\/results\?/);
  assert.match(decodeURIComponent(dublinUrl), /D26A\/0190\/WEB/);
  const [record] = parseNationalPlanningFeatures({ features: [{ attributes: {
    PlanningAuthority: "Kildare County Council",
    ApplicationNumber: "2660381",
    DevelopmentDescription: "Example project requiring a noise assessment",
    ReceivedDate: Date.parse("2026-10-20T00:00:00Z"),
    LinkAppDetails: "https://planning.localgov.ie/",
  } }] });
  assert.equal(record.sourceUrl, "https://www.eplanning.ie/KildareCC/AppFileRefDetails/2660381/0");
});

test("national register live query is bounded to current weekly discovery activity", () => {
  const where = buildNationalPlanningWhere(Date.parse("2026-09-25T12:00:00Z"));
  assert.match(where, /ReceivedDate >= DATE '2026-08-21'/);
  assert.match(where, /DecisionDate >= DATE '2026-08-21'/);
  assert.match(where, /FIRequestDate >= DATE '2026-08-21'/);
  assert.match(where, /PlanningAuthority IN/);
  assert.match(where, /Kildare County Council/);
  assert.doesNotMatch(where, /Cavan County Council/);
  assert.doesNotMatch(where, /ETL_DATE/);
});

test("target scope requires Leinster and the approved formal-tender buyer class", () => {
  const base = {
    id: "scope-test",
    type: "formal-public-tender",
    sourceSystem: "TED",
    sourceRecordId: "123-2026",
    title: "Noise consultancy in Kildare",
    description: "Acoustic consultancy",
    sourceUrl: "https://example.test/123",
    evidenceStatus: "discovery-only",
    cpvCodes: ["71313100"],
    matchedTerms: ["noise"],
    fitScore: 60,
  };
  assert.equal(approvedTenderBuyer("Office of Public Works"), true);
  assert.equal(approvedTenderBuyer("Kildare County Council"), true);
  assert.equal(approvedTenderBuyer("University of Limerick"), false);
  assert.equal(applyTargetScope({ ...base, buyer: "Kildare County Council" }).scopeStatus, "eligible");
  assert.equal(applyTargetScope({ ...base, buyer: "University of Limerick" }).scopeExclusionReason, "buyer-is-not-opw-or-a-local-authority");
  assert.equal(targetRegionStatus({ ...base, buyer: "Limerick City and County Council", title: "Noise consultancy" }), "out-of-region");
});

test("national register collector exhausts the ArcGIS transfer limit", async () => {
  const offsets = [];
  const fetcher = async (url) => {
    const offset = Number(new URL(url).searchParams.get("resultOffset"));
    offsets.push(offset);
    return Response.json({
      exceededTransferLimit: offset === 0,
      features: offset === 0
        ? [{ attributes: { OBJECTID: 1 } }, { attributes: { OBJECTID: 2 } }]
        : [{ attributes: { OBJECTID: 3 } }],
    });
  };
  const result = await collectNationalPlanningFeatures(fetcher, 2, Date.parse("2026-09-25T12:00:00Z"));
  assert.deepEqual(offsets, [0, 2]);
  assert.equal(result.features.length, 3);
  assert.equal(result.pagesFetched, 2);
});

test("national register collector retries a transient timeout without widening the query", async () => {
  const urls = [];
  const fetcher = async (url) => {
    urls.push(String(url));
    if (urls.length === 1) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    return Response.json({ exceededTransferLimit: false, features: [{ attributes: { OBJECTID: 1 } }] });
  };
  const result = await collectNationalPlanningFeatures(fetcher, 1, Date.parse("2026-09-25T12:00:00Z"));
  assert.equal(urls.length, 2);
  assert.equal(urls[0], urls[1]);
  assert.equal(result.features.length, 1);
});

test("DCC further-information wording can prove a noise-related RFI", () => {
  const base = 'APNID,REG_REF,LONG_PROPOSAL,LOCATION,APPTYPE DECISION\n42,WEB1000/26,"Hotel development",Dublin,"Further Information"\n';
  const fi = 'APNID,REQDATE,RECDDATE,FI_DESC\n42,2026-09-01,2027-03-01,"Submit an acoustic report addressing plant noise and vibration."\n';
  const records = parseDccPlanningCsv(base, fi);
  assert.equal(records.length, 1);
  assert.equal(records[0].classification, "noise-related-rfi");
  assert.equal(records[0].evidenceStatus, "official-text");
  assert.match(records[0].evidenceExcerpt, /acoustic report/);
  assert.equal(records[0].rfiPublishedAt, "2026-09-01");
  assert.equal(records[0].rfiReceivedAt, "2026-09-01");
  assert.equal(records[0].rfiResponseReceivedAt, "2027-03-01");
  assert.equal(records[0].responseDeadline, undefined);
});

test("DCC weekly collector selects the newest official document for every area", () => {
  const links = parseDccWeeklyDocumentLinks(`
    <a href="/sites/default/files/2026-09/a1-wpl-36-26.docx">old</a>
    <a href="/sites/default/files/2026-09/a1-wpl-37-26.docx">new</a>
    <a href="/sites/default/files/2026-09/a2-wpl-37-26.docx">area two</a>
  `);
  assert.deepEqual(links, [
    "https://www.dublincity.ie/sites/default/files/2026-09/a1-wpl-37-26.docx",
    "https://www.dublincity.ie/sites/default/files/2026-09/a2-wpl-37-26.docx",
  ]);
});

test("DCC weekly applications with acoustic wording remain discovery-only", () => {
  const text = "Area 1 - South East Application Number WEB1000/26 Application Type Permission Applicant Example Developments Location Main Street Registration Date 22/09/2026 Proposal: A hotel with rooftop plant requiring an acoustic and noise assessment.";
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
  const docx = zipSync({ "word/document.xml": strToU8(xml) });
  const records = parseDccWeeklyDocx(docx, "https://www.dublincity.ie/example.docx");
  assert.equal(records.length, 1);
  assert.equal(records[0].sourceRecordId, "WEB1000/26");
  assert.equal(records[0].evidenceStatus, "discovery-only");
  assert.notEqual(records[0].classification, "granted-with-noise-conditions");
});

test("DCC weekly sector leads advance to document inspection even without summary keywords", () => {
  const text = "Area 1 - South East Application Number WEB1001/26 Application Type Permission Applicant Example Developments Location Main Street Registration Date 22/09/2026 Additional Information Proposal: Construction of 120 apartments in two residential blocks.";
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
  const docx = zipSync({ "word/document.xml": strToU8(xml) });
  const records = parseDccWeeklyDocx(docx, "https://www.dublincity.ie/example.docx");
  assert.equal(countDccWeeklyApplications(docx), 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].classification, "design-construction-potential");
  assert.equal(records[0].evidenceStatus, "discovery-only");
});

test("DCC application archive parser retains the authoritative evidence document set", () => {
  const html = `<script>var model =${JSON.stringify({ Rows: [
    { Guid: "A".repeat(32), Doc_Type: "Decision Notices", Date_Received: "09/24/2026", Doc_Ref2: "Decision Notice" },
    { Guid: "B".repeat(32), Doc_Type: "Planner's Report Published", Date_Received: "09/24/2026", Doc_Ref2: "Planner Report" },
    { Guid: "C".repeat(32), Doc_Type: "Floor Plans", Date_Received: "09/20/2026", Doc_Ref2: "Proposed" },
    { Guid: "D".repeat(32), Doc_Type: "Additional Info Response Correspondence", Date_Received: "09/21/2026", Doc_Ref2: "Request for Additional Information" },
  ] })}; var data = JSON.stringify(model.Rows);</script>`;
  const documents = parseDccDocumentIndex(html);
  assert.equal(documents.length, 4);
  assert.deepEqual(documents.filter(isDccEvidenceDocument).map((document) => document.id), [
    "A".repeat(32),
    "B".repeat(32),
    "D".repeat(32),
  ]);
  assert.match(documents[0].sourceUrl, /Document\/ViewDocument\?id=/);
});

test("DCC document classifier only confirms opportunities from the real document wording", () => {
  const decision = {
    id: "A".repeat(32),
    documentType: "Decision Notices",
    description: "Decision Notice",
    receivedAt: "09/24/2026",
    sourceUrl: "https://example.test/decision.pdf",
  };
  assert.equal(
    classifyDccDocumentText(
      decision,
      "NOTIFICATION OF DECISION TO GRANT PERMISSION. Condition 8: An acoustic report shall demonstrate that plant noise meets the applicable limits. The applicant may appeal if permission is refused for any later amendment.",
    ).classification,
    "granted-with-noise-conditions",
  );
  assert.equal(
    classifyDccDocumentText(
      { ...decision, description: "Refusal Decision" },
      "NOTIFICATION OF DECISION TO REFUSE PERMISSION. Reason for refusal: the proposal would cause unacceptable noise impacts at nearby dwellings.",
    ).classification,
    "refused-on-noise-grounds",
  );
  assert.equal(
    classifyDccDocumentText(
      { ...decision, documentType: "Additional Info Response Correspondence", description: "Request for Additional Information" },
      "Further information is required. Submit an acoustic assessment of operational noise and vibration.",
    ).classification,
    "noise-related-rfi",
  );
  assert.equal(
    classifyDccDocumentText(decision, "NOTIFICATION OF DECISION TO GRANT PERMISSION. Standard drainage condition.").classification,
    undefined,
  );
});

test("DCC evidence enrichment fetches the actual document and cites it", async () => {
  const guid = "E".repeat(32);
  const indexHtml = `<script>var model =${JSON.stringify({ Rows: [
    { Guid: guid, Doc_Type: "Decision Notices", Date_Received: "09/24/2026", Doc_Ref2: "Decision Notice" },
  ] })}; var data = JSON.stringify(model.Rows);</script>`;
  const fetcher = async (url) => {
    if (String(url).includes("RunThirdPartySearch")) return new Response(indexHtml, { status: 200, headers: { "content-type": "text/html" } });
    return new Response(
      "NOTIFICATION OF DECISION TO GRANT PERMISSION. Condition 12: A detailed acoustic report shall be submitted to control plant noise.",
      { status: 200, headers: { "content-type": "text/plain" } },
    );
  };
  const enriched = await enrichDccPlanningOpportunity({
    id: "discovery",
    type: "planning-pipeline-lead",
    sourceSystem: "DCC",
    sourceRecordId: "WEB1000/26",
    projectReference: "WEB1000/26",
    title: "Example Hotel",
    description: "Hotel development",
    sourceUrl: "https://example.test/discovery",
    evidenceStatus: "discovery-only",
    classification: "needs-council-evidence",
    cpvCodes: [],
    matchedTerms: [],
    fitScore: 0,
  }, fetcher);
  assert.equal(enriched.evidenceStatus, "official-text");
  assert.equal(enriched.classification, "granted-with-noise-conditions");
  assert.equal(enriched.evidenceDocuments?.length, 1);
  assert.match(enriched.sourceUrl, /RunThirdPartySearch/);
  assert.match(enriched.evidenceDocuments?.[0].sourceUrl, new RegExp(guid));
  assert.match(enriched.evidenceExcerpt, /acoustic report/i);
});

test("official RFI documents provide exact or derived received and response dates without guessing", () => {
  const descriptor = {
    guid: "A".repeat(32),
    documentType: "Further Information",
    description: "Request for Further Information",
    receivedAt: "09/24/2026",
    sourceUrl: "https://example.test/rfi-document",
  };
  const exact = extractRfiDocumentDates(
    descriptor,
    "The further information response must be submitted no later than 28 October 2026.",
  );
  assert.equal(exact.rfiPublishedAt, "2026-09-24");
  assert.equal(exact.responseDeadline, "2026-10-28");
  assert.equal(exact.rfiDateConfidence, "exact");

  const derived = extractRfiDocumentDates(
    descriptor,
    "The requested further information must be submitted within 6 months of this notice.",
  );
  assert.equal(derived.rfiPublishedAt, "2026-09-24");
  assert.equal(derived.responseDeadline, "2027-03-24");
  assert.equal(derived.rfiDateConfidence, "derived");
});

test("DCC evidence enrichment fails closed when the application documents are unavailable", async () => {
  const enriched = await enrichDccPlanningOpportunity({
    id: "discovery",
    type: "planning-pipeline-lead",
    sourceSystem: "DCC",
    sourceRecordId: "WEB404/26",
    projectReference: "WEB404/26",
    title: "Unavailable application",
    description: "Residential development",
    sourceUrl: "https://example.test/discovery",
    evidenceStatus: "discovery-only",
    classification: "needs-council-evidence",
    cpvCodes: [],
    matchedTerms: [],
    fitScore: 0,
  }, async () => new Response("missing", { status: 404 }));
  assert.equal(enriched.evidenceStatus, "evidence-unavailable");
  assert.equal(enriched.classification, "needs-council-evidence");
  assert.match(enriched.evidenceUnavailableReason, /document-index-http-404/);
});

test("planning classes fail closed without actual acoustic wording", () => {
  assert.equal(
    classifyPlanningEvidence({ stage: "Refused", description: "Residential development" }),
    "needs-council-evidence",
  );
});

test("legacy ePlanning document index parser retains direct evidence-viewer rows", () => {
  const html = `<table><tr><td>42</td><td>Decision Notice</td><td>Decision Notice with Conditions</td><td><a href='ViewFiles.aspx?docid=42&format=djvu'>View</a></td></tr></table>`;
  const rows = parseEplanningDocumentRows(html, "https://idocs.example.ie/iDocsWebDPSS/listFiles.aspx?id=100");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].documentType, "Decision Notice");
  assert.match(rows[0].sourceUrl, /docid=42/);
});

test("Agile council adapter reads the real further-information endpoint and preserves party details", async () => {
  const fetcher = async (url) => {
    const value = String(url);
    if (value.includes("/api/client/get")) return Response.json({ code: "SD" });
    if (value.endsWith("/application/70996")) return Response.json({ applicantSurname: "Example Developments Ltd" });
    if (value.endsWith("/further-info")) return Response.json([{ description: "Submit an acoustic report addressing operational noise and vibration." }]);
    if (value.endsWith("/conditions")) return Response.json({ decisionText: "" });
    if (value.endsWith("/document")) return Response.json([]);
    return new Response("missing", { status: 404 });
  };
  const enriched = await enrichNationalPlanningOpportunity({
    id: "national-1",
    type: "planning-pipeline-lead",
    sourceSystem: "National Planning Register",
    sourceRecordId: "South Dublin:ED26/0099",
    projectReference: "ED26/0099",
    planningAuthority: "South Dublin County Council",
    title: "Example development",
    description: "Mixed-use development",
    sourceUrl: "https://planning.agileapplications.ie/southdublin/application-details/70996",
    evidenceStatus: "discovery-only",
    classification: "needs-council-evidence",
    cpvCodes: [],
    matchedTerms: [],
    fitScore: 0,
  }, fetcher);
  assert.equal(enriched.evidenceStatus, "official-text");
  assert.equal(enriched.classification, "noise-related-rfi");
  assert.equal(enriched.applicant, "Example Developments Ltd");
  assert.equal(enriched.sourceUrl, "https://planning.agileapplications.ie/southdublin/application-details/70996");
  assert.match(enriched.evidenceExcerpt, /acoustic report/i);
});

test("Agile council adapter retains a traceable official excerpt for design-stage opportunities", async () => {
  const fetcher = async (url) => {
    const value = String(url);
    if (value.includes("/api/client/get")) return Response.json({ code: "SD" });
    if (value.endsWith("/application/70997")) return Response.json({ applicantSurname: "Example Homes Ltd" });
    if (value.endsWith("/further-info")) return Response.json([]);
    if (value.endsWith("/conditions")) return Response.json({
      decisionText: "Permission is granted for a mixed-use development of 120 apartments and retail space.",
    });
    if (value.endsWith("/document")) return Response.json([]);
    return new Response("missing", { status: 404 });
  };
  const enriched = await enrichNationalPlanningOpportunity({
    id: "national-design-1",
    type: "planning-pipeline-lead",
    sourceSystem: "National Planning Register",
    sourceRecordId: "South Dublin:ED26/0100",
    projectReference: "ED26/0100",
    planningAuthority: "South Dublin County Council",
    title: "Example mixed-use development",
    description: "Mixed-use development of 120 apartments",
    sourceUrl: "https://planning.agileapplications.ie/southdublin/application-details/70997",
    evidenceStatus: "discovery-only",
    classification: "needs-council-evidence",
    cpvCodes: [],
    matchedTerms: [],
    fitScore: 0,
  }, fetcher);
  assert.equal(enriched.evidenceStatus, "official-text");
  assert.equal(enriched.classification, "design-construction-potential");
  assert.match(enriched.evidenceExcerpt, /120 apartments/i);
});

test("restricted Search lookup uses exact party evidence and retains only a bounded conversation excerpt", async () => {
  const previous = {
    enabled: process.env.HELMONIC_EMAIL_RELATIONSHIP_SEARCH_ENABLED,
    endpoint: process.env.AZURE_EMAIL_SEARCH_ENDPOINT,
    index: process.env.AZURE_EMAIL_SEARCH_INDEX,
    identity: process.env.AZURE_EMAIL_SEARCH_CLIENT_ID,
  };
  process.env.HELMONIC_EMAIL_RELATIONSHIP_SEARCH_ENABLED = "true";
  process.env.AZURE_EMAIL_SEARCH_ENDPOINT = "https://search.example.test";
  process.env.AZURE_EMAIL_SEARCH_INDEX = "restricted-email-index";
  process.env.AZURE_EMAIL_SEARCH_CLIENT_ID = "identity-client-id";
  try {
    let requestBody;
    const fetcher = async (_url, init) => {
      requestBody = JSON.parse(String(init.body));
      return Response.json({ value: [{
        message_id: "remote-1",
        evidence_ref: "[E:glen:remote-1]",
        subject: "Example Architect",
        body_text: "Previous correspondence with contact@example-architect.ie. Phone +353 1 555 0199.",
        mailbox_owner: "Glen",
        sent_at: "2025-02-03T09:15:00Z",
        participants: ["contact@example-architect.ie", "glen.plunkett@iacoustics.net"],
        project_names: ["Earlier Architect Project"],
        source_uri: "restricted-email://remote-1",
      }] });
    };
    const result = await loadSearchRelationshipLookup([planningLead({
      applicant: "Example Architect Ltd",
      parties: [{
        name: "Example Architect Ltd",
        role: "architect",
        email: "contact@example-architect.ie",
      }],
    })], { fetcher, accessToken: "test-token" });
    assert.equal(result.enabled, true);
    assert.equal(result.queriedParties, 1);
    assert.equal(result.matchedEntities, 1);
    assert.match(requestBody.select, /evidence_ref/);
    assert.match(requestBody.select, /participants/);
    assert.match(requestBody.select, /project_names/);
    const routed = routeOpportunityByRelationships(planningLead({
      applicant: "Example Architect Ltd",
      parties: [{
        name: "Example Architect Ltd",
        role: "architect",
        email: "contact@example-architect.ie",
      }],
    }), result.lookup);
    assert.equal(routed.routedTo, "Glen");
    assert.deepEqual(routed.routingEvidence[0].evidenceRefs, ["[E:glen:remote-1]"]);
    assert.deepEqual(routed.routingEvidence[0].historicalEmails, ["contact@example-architect.ie"]);
    assert.equal(routed.routingEvidence[0].emailSubject, "Example Architect");
    assert.equal(routed.routingEvidence[0].emailSentAt, "2025-02-03T09:15:00Z");
    assert.equal(routed.routingEvidence[0].emailContext, "Previous correspondence with contact@example-architect.ie. Phone +353 1 555 0199.");
    assert.ok(routed.routingEvidence[0].emailContext.length <= 422);
    assert.deepEqual(routed.routingEvidence[0].historicalPhones, ["+353 1 555 0199"]);
    assert.deepEqual(routed.routingEvidence[0].previousProjects, ["Earlier Architect Project"]);
    assert.equal(routed.routingEvidence[0].emailSourceUri, "restricted-email://remote-1");
  } finally {
    if (previous.enabled === undefined) delete process.env.HELMONIC_EMAIL_RELATIONSHIP_SEARCH_ENABLED;
    else process.env.HELMONIC_EMAIL_RELATIONSHIP_SEARCH_ENABLED = previous.enabled;
    if (previous.endpoint === undefined) delete process.env.AZURE_EMAIL_SEARCH_ENDPOINT;
    else process.env.AZURE_EMAIL_SEARCH_ENDPOINT = previous.endpoint;
    if (previous.index === undefined) delete process.env.AZURE_EMAIL_SEARCH_INDEX;
    else process.env.AZURE_EMAIL_SEARCH_INDEX = previous.index;
    if (previous.identity === undefined) delete process.env.AZURE_EMAIL_SEARCH_CLIENT_ID;
    else process.env.AZURE_EMAIL_SEARCH_CLIENT_ID = previous.identity;
  }
});

test("party routing uses exact evidence and balanced batch assignment for everything else", () => {
  const lookup = buildRelationshipLookup([
    { name: "Example Developments Ltd", evidence_refs: ["[E:glen:100]"] },
    { name: "Dual Contact", evidence_refs: ["[E:glen:101]", "[E:owen:202]"] },
  ]);
  const base = {
    id: "confirmed",
    type: "planning-pipeline-lead",
    sourceSystem: "DCC",
    sourceRecordId: "WEB1/26",
    title: "Confirmed lead",
    description: "Residential development",
    sourceUrl: "https://example.test/decision.pdf",
    evidenceStatus: "official-text",
    evidenceExcerpt: "The applicant shall submit a noise assessment.",
    classification: "noise-related-rfi",
    cpvCodes: [],
    matchedTerms: ["noise"],
    fitScore: 95,
  };
  const routed = routeOpportunityByRelationships({ ...base, applicant: "Example Developments Limited" }, lookup);
  assert.equal(routed.routedTo, "Glen");
  assert.equal(routed.routingEvidence[0].evidenceRefs[0], "[E:glen:100]");
  assert.deepEqual(routed.routingEvidence[0].evidenceOwners, ["Glen"]);
  const ambiguous = routeOpportunityByRelationships({ ...base, applicant: "Dual Contact" }, lookup);
  assert.equal(ambiguous.routedTo, "unassigned");
  assert.equal(ambiguous.routingStatus, "needs-triage");

  const sameDomainLookup = buildRelationshipLookup([
    { name: "Known Person", email: "known@example.test", evidence_refs: ["[E:glen:303]"] },
  ]);
  const domainOnly = routeOpportunityByRelationships({
    ...base,
    applicant: "Different Company",
    parties: [{
      name: "Different Person",
      role: "architect",
      email: "different@example.test",
    }],
  }, sameDomainLookup);
  assert.equal(domainOnly.routedTo, "unassigned");
  assert.equal(domainOnly.routingStatus, "needs-triage");
  assert.deepEqual(domainOnly.routingEvidence, []);

  const distributed = routeOpportunitiesByRelationships([
    { ...base, id: "exact", applicant: "Example Developments Limited" },
    { ...base, id: "unmatched-1", applicant: "Unknown One" },
    { ...base, id: "unmatched-2", applicant: "Unknown Two" },
    { ...base, id: "ambiguous", applicant: "Dual Contact" },
  ], lookup);
  assert.equal(distributed.filter((record) => record.routedTo === "Glen").length, 2);
  assert.equal(distributed.filter((record) => record.routedTo === "Owen").length, 2);
  assert.equal(distributed.filter((record) => record.routingStatus === "needs-triage").length, 0);
  assert.equal(distributed.find((record) => record.id === "exact").routingReason, "exact-party-match-supported-by-glen-email-evidence");
  assert.ok(distributed.filter((record) => record.id !== "exact").every((record) => record.routingReason.startsWith("balanced-assignment-")));
});

test("email relationship matching checks every lead without promoting an unqualified lead", () => {
  const lookup = buildRelationshipLookup([{
    name: "Known Architect",
    email: "known@example.test",
    evidence_refs: ["[E:owen:900]"],
  }]);
  const routed = routeOpportunityByRelationships(planningLead({
    id: "unqualified-email-match",
    evidenceStatus: "discovery-only",
    classification: "design-construction-potential",
    parties: [{
      name: "Known Architect",
      role: "architect",
      email: "known@example.test",
    }],
  }), lookup);
  assert.equal(routed.routingStatus, "not-qualified");
  assert.equal(routed.routedTo, "unassigned");
  assert.equal(routed.emailRelationshipStatus, "verified-single-owner");
  assert.equal(routed.emailRelationshipOwner, "Owen");
  assert.equal(routed.routingEvidence[0].evidenceRefs[0], "[E:owen:900]");
  assert.equal(routed.routingEvidence[0].matchedEmail, "known@example.test");
  assert.deepEqual(routed.routingEvidence[0].evidenceOwners, ["Owen"]);
});

test("a hotel-sector relationship match remains visible but cannot prove a current acoustic opportunity", () => {
  const lookup = buildRelationshipLookup([{
    name: "Example Hotel Architects",
    email: "projects@example-hotel.ie",
    evidence_refs: ["[E:glen:hotel-history-1]"],
    email_subject: "Earlier hotel project",
    email_sent_at: "2025-03-14T10:00:00Z",
    email_context: "Earlier correspondence about a completed hotel fit-out.",
  }]);
  const qualified = qualifyLead(planningLead({
    id: "hotel-sector-with-history-only",
    title: "Hunter's Yard Hotel Development",
    description: "Hotel extension and alterations",
    evidenceStatus: "evidence-unavailable",
    evidenceExcerpt: "",
    matchedTerms: [],
    classification: "design-construction-potential",
    deadline: "2026-09-15",
    parties: [{
      name: "Example Hotel Architects",
      role: "architect",
      email: "projects@example-hotel.ie",
    }],
  }), new Date("2026-10-12T12:00:00Z"));
  const routed = routeOpportunityByRelationships(qualified, lookup);
  const [payload] = buildOdooDryRun([{
    ...routed,
    crmExternalId: "helmonic-lead:hotel-sector-with-history-only",
  }], new Date("2026-10-12T12:00:00Z"));
  assert.equal(routed.leadQuality, "medium");
  assert.equal(routed.leadDisposition, "monitor");
  assert.equal(routed.emailRelationshipStatus, "verified-single-owner");
  assert.equal(routed.routedTo, "unassigned");
  assert.equal(routed.routingStatus, "not-qualified");
  assert.equal(confirmedLedgerRecords([routed]).length, 0);
  assert.equal(payload.values.x_warm_connection_verified, true);
  assert.equal(payload.values.x_assigned_person, "");
  assert.equal(payload.values.x_pipeline_priority_rank, 180);
  assert.equal(payload.values.date_deadline, false);
  assert.equal(payload.values.x_deadline, false);
  assert.equal(payload.values.x_decision_due_at, "2026-09-15 00:00:00");
  assert.match(payload.values.x_deadline_urgency, /planning decision date passed/i);
  assert.doesNotMatch(payload.values.x_deadline_urgency, /within the 28-day RFI/i);
  assert.match(payload.values.description, /Potential only — current-project acoustic evidence unconfirmed/);
  assert.match(payload.values.description, /historical email match does not prove/i);
  assert.match(payload.values.x_relationship_summary, /Useful conversation context: Earlier correspondence about a completed hotel fit-out/);
  assert.match(payload.values.x_relationship_evidence, /Email conversation context \(bounded excerpt\)/);
});

test("PlanningLeads free connector stays within the bounded search contract", () => {
  const urls = buildPlanningLeadsSearchUrls({
    enabled: true,
    endpoint: "https://planningleads.ie/api/v1/",
    pageSize: 500,
  });
  assert.equal(urls.length, 3);
  assert.ok(urls.every((url) => url.startsWith("https://planningleads.ie/api/v1/leads?")));
  assert.ok(urls.every((url) => url.includes("page_size=100")));
  assert.ok(urls.some((url) => url.includes("q=noise")));
  assert.ok(urls.some((url) => url.includes("q=acoustic")));
  assert.ok(urls.some((url) => url.includes("q=vibration")));
});

test("PlanningLeads records are discovery-only even when their summary sounds conclusive", () => {
  const records = parsePlanningLeads({
    results: [{
      planning_reference: "WEB1234/26",
      project_name: "Mixed-use development at Example Quay",
      development_description: "Permission granted subject to a detailed acoustic and noise condition.",
      planning_authority: "Dublin City Council",
      application_status: "GRANT PERMISSION WITH CONDITIONS",
      source_url: "https://planning.agileapplications.ie/dublincity/application-details/WEB1234-26",
      updated_at: "2026-09-22",
    }],
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].sourceSystem, "PlanningLeads");
  assert.equal(records[0].evidenceStatus, "discovery-only");
  assert.equal(records[0].classification, "design-construction-potential");
  assert.notEqual(records[0].classification, "granted-with-noise-conditions");
});

test("PlanningLeads parser accepts a bare array and filters irrelevant records", () => {
  const records = parsePlanningLeads([
    {
      id: 42,
      address: "Example School",
      description: "New education building requiring vibration assessment",
      authority: "Example County Council",
      url: "https://example.test/42",
    },
    {
      id: 43,
      address: "Farm shed",
      description: "Agricultural storage building",
      authority: "Example County Council",
    },
    {
      id: 44,
      address: "Unlinked hotel",
      description: "Noise assessment required",
      authority: "Example County Council",
    },
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].sourceRecordId, "42");
  assert.deepEqual(records[0].matchedTerms, ["vibration"]);
});

test("PlanningLeads live field names preserve the council reference and authoritative link", () => {
  const records = parsePlanningLeads({ results: [{
    id: "opaque-internal-id",
    application_reference: "F23A/0258",
    planning_authority: "Fingal County Council",
    development_description: "Installation of an aircraft noise monitoring terminal.",
    decision_status: "granted",
    date_received: "2023-05-16",
    decision_due_date: "2023-07-10",
    public_url: "https://planningleads.ie/planning/fingal/F23A-0258",
    raw_source_url: "https://planning.agileapplications.ie/fingal/application-details/F23A-0258",
  }] });
  assert.equal(records.length, 1);
  assert.equal(records[0].sourceRecordId, "F23A/0258");
  assert.equal(records[0].title, "Fingal County Council · F23A/0258");
  assert.match(records[0].sourceUrl, /^https:\/\/planning\.agileapplications\.ie\//);
  assert.equal(records[0].publishedAt, "2023-05-16");
  assert.equal(records[0].deadline, "2023-07-10");
  assert.equal(records[0].evidenceStatus, "discovery-only");
});

test("PlanningLeads weekly discovery excludes historical and undated records", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");
  const records = [
    { id: "recent", publishedAt: "2026-09-21" },
    { id: "boundary", publishedAt: "2026-05-26T12:00:00Z" },
    { id: "historical", publishedAt: "2023-07-06" },
    { id: "undated" },
  ];
  assert.deepEqual(
    filterRecentPlanningLeads(records, 120, now).map((record) => record.id),
    ["recent", "boundary"],
  );
});

test("confirmed records missing from the new window are retained with prior evidence", () => {
  const prior = {
    id: "prior-dcc",
    type: "planning-pipeline-lead",
    sourceSystem: "DCC",
    sourceRecordId: "WEB1749/26",
    title: "Prior DCC lead",
    description: "Residential development",
    sourceUrl: "https://example.test/decision.pdf",
    evidenceStatus: "official-text",
    evidenceExcerpt: "Condition 8 requires an acoustic report for plant noise.",
    evidenceDocuments: [{
      id: "decision",
      documentType: "Decision Notice",
      sourceUrl: "https://example.test/decision.pdf",
      fetchStatus: "fetched",
      matchedTerms: ["acoustic", "noise"],
      excerpt: "Condition 8 requires an acoustic report for plant noise.",
      classification: "granted-with-noise-conditions",
    }],
    classification: "granted-with-noise-conditions",
    cpvCodes: [],
    matchedTerms: ["acoustic", "noise"],
    fitScore: 94,
    routedTo: "Glen",
    routingStatus: "routed",
    routingReason: "balanced-assignment-to-glen-without-confirmed-warm-connection",
    lastConfirmedAt: "2026-09-25T12:17:44.917Z",
  };
  const [merged] = mergeCurrentSnapshotWithLedger({
    current: [],
    priorConfirmed: [prior],
    now: new Date("2026-09-28T09:00:00Z"),
  });
  assert.equal(merged.cycleStatus, "unconfirmed-this-cycle");
  assert.equal(merged.carryForwardReason, "absent-from-current-discovery-window");
  assert.equal(merged.evidenceExcerpt, prior.evidenceExcerpt);
  assert.deepEqual(merged.evidenceDocuments, prior.evidenceDocuments);
  assert.equal(merged.routedTo, "Glen");
  assert.equal(confirmedLedgerRecords([merged]).length, 1);
});

test("existing balanced owners stay sticky while only new records are balanced", () => {
  const existing = {
    id: "existing",
    type: "planning-pipeline-lead",
    sourceSystem: "DCC",
    sourceRecordId: "WEB1000/26",
    title: "Existing lead",
    description: "Residential development",
    sourceUrl: "https://example.test/existing",
    evidenceStatus: "official-text",
    evidenceExcerpt: "The applicant shall submit an acoustic assessment.",
    classification: "design-construction-potential",
    cpvCodes: [],
    matchedTerms: ["acoustic"],
    fitScore: 60,
    routedTo: "Glen",
    routingStatus: "routed",
    routingReason: "balanced-assignment-to-glen-without-confirmed-warm-connection",
  };
  const incoming = {
    ...existing,
    id: "incoming",
    sourceRecordId: "WEB1001/26",
    title: "Incoming lead",
    sourceUrl: "https://example.test/incoming",
    routedTo: "unassigned",
    routingStatus: "needs-triage",
    routingReason: "no-exact-party-level-email-evidence-match",
  };
  const routed = routeOpportunitiesByRelationships(
    [existing, incoming],
    buildRelationshipLookup([]),
    { preserveExistingRoutes: true },
  );
  assert.equal(routed.find((record) => record.id === "existing").routedTo, "Glen");
  assert.equal(routed.find((record) => record.id === "incoming").routedTo, "Owen");
});

test("a prior balanced owner survives a confirmed refresh unless a new exact email route exists", () => {
  const prior = {
    id: "prior-route",
    type: "planning-pipeline-lead",
    sourceSystem: "DCC",
    sourceRecordId: "WEB2000/26",
    title: "Existing project",
    description: "Residential development",
    sourceUrl: "https://example.test/prior",
    evidenceStatus: "official-text",
    evidenceExcerpt: "The applicant shall submit an acoustic assessment.",
    classification: "design-construction-potential",
    cpvCodes: [],
    matchedTerms: ["acoustic"],
    fitScore: 60,
    routedTo: "Glen",
    routingStatus: "routed",
    routingReason: "balanced-assignment-to-glen-without-confirmed-warm-connection",
  };
  const current = {
    ...prior,
    sourceUrl: "https://example.test/current",
    routedTo: "Owen",
    routingReason: "balanced-assignment-to-owen-without-confirmed-warm-connection",
  };
  const [merged] = mergeCurrentSnapshotWithLedger({
    current: [current],
    priorConfirmed: [prior],
    now: new Date("2026-09-30T09:00:00Z"),
  });
  assert.equal(merged.routedTo, "Glen");
  assert.equal(merged.routingReason, prior.routingReason);
});

test("the durable ledger owner takes precedence over an older legacy audit owner", () => {
  const durable = {
    id: "durable-owner",
    type: "planning-pipeline-lead",
    sourceSystem: "DCC",
    sourceRecordId: "WEB3000/26",
    title: "Durable owner project",
    description: "Residential development",
    sourceUrl: "https://example.test/durable",
    evidenceStatus: "official-text",
    evidenceExcerpt: "The applicant shall submit an acoustic assessment.",
    classification: "design-construction-potential",
    cpvCodes: [],
    matchedTerms: ["acoustic"],
    fitScore: 60,
    routedTo: "Owen",
    routingStatus: "routed",
    routingReason: "balanced-assignment-to-owen-without-confirmed-warm-connection",
  };
  const legacy = {
    ...durable,
    routedTo: "Glen",
    routingReason: "balanced-assignment-to-glen-without-confirmed-warm-connection",
  };
  assert.deepEqual(routingMetadataWithDurablePrecedence(durable, legacy), {
    routedTo: "Owen",
    routingStatus: "routed",
    routingEvidence: undefined,
    routingReason: durable.routingReason,
  });
});

test("a new exact email-evidence match supersedes a sticky balanced owner", () => {
  const lookup = buildRelationshipLookup([{
    name: "Exact Owen Contact",
    email: "exact.owen@example.test",
    evidence_refs: ["[E:owen:message-1]"],
  }]);
  const [routed] = routeOpportunitiesByRelationships([{
    id: "new-exact-route",
    type: "planning-pipeline-lead",
    sourceSystem: "DCC",
    sourceRecordId: "WEB3001/26",
    title: "New exact route project",
    description: "Residential development",
    sourceUrl: "https://example.test/new-exact-route",
    evidenceStatus: "official-text",
    evidenceExcerpt: "The applicant shall submit an acoustic assessment.",
    classification: "design-construction-potential",
    cpvCodes: [],
    matchedTerms: ["acoustic"],
    fitScore: 60,
    parties: [{ name: "Exact Owen Contact", email: "exact.owen@example.test", role: "applicant" }],
    routedTo: "Glen",
    routingStatus: "routed",
    routingReason: "balanced-assignment-to-glen-without-confirmed-warm-connection",
  }], lookup, { preserveExistingRoutes: true });
  assert.equal(routed.routedTo, "Owen");
  assert.equal(routed.routingReason, "exact-party-match-supported-by-owen-email-evidence");
});

test("a retained national lead becomes confirmed again only after fresh official evidence", () => {
  const previous = {
    id: "national-prior",
    type: "planning-pipeline-lead",
    sourceSystem: "National Planning Register",
    sourceRecordId: "Council:26/100",
    title: "Retained project",
    description: "Residential development",
    sourceUrl: "https://example.test/prior-document",
    evidenceStatus: "official-text",
    evidenceExcerpt: "An acoustic assessment shall be submitted.",
    classification: "design-construction-potential",
    cpvCodes: [],
    matchedTerms: ["acoustic"],
    fitScore: 60,
    cycleStatus: "unconfirmed-this-cycle",
    firstSeenAt: "2026-09-25T09:00:00.000Z",
    missingSince: "2026-09-28T09:00:00.000Z",
  };
  const refreshed = {
    ...previous,
    sourceUrl: "https://example.test/current-document",
    evidenceExcerpt: "Current acoustic assessment wording.",
  };
  const result = applyEvidenceRefresh(previous, refreshed, new Date("2026-09-30T09:00:00.000Z"));
  assert.equal(result.cycleStatus, "confirmed-this-cycle");
  assert.equal(result.firstSeenAt, previous.firstSeenAt);
  assert.equal(result.lastConfirmedAt, "2026-09-30T09:00:00.000Z");
  assert.equal(result.sourceUrl, refreshed.sourceUrl);
  assert.equal(result.missingSince, undefined);
});

test("failed re-verification keeps prior official evidence in carry-forward", () => {
  const previous = {
    id: "national-prior",
    type: "planning-pipeline-lead",
    sourceSystem: "National Planning Register",
    sourceRecordId: "Council:26/101",
    title: "Retained project",
    description: "Residential development",
    sourceUrl: "https://example.test/prior-document",
    evidenceStatus: "official-text",
    evidenceExcerpt: "An acoustic assessment shall be submitted.",
    classification: "design-construction-potential",
    cpvCodes: [],
    matchedTerms: ["acoustic"],
    fitScore: 60,
    cycleStatus: "unconfirmed-this-cycle",
  };
  const refreshed = {
    ...previous,
    sourceUrl: "https://example.test/application",
    evidenceStatus: "evidence-unavailable",
    evidenceExcerpt: undefined,
    evidenceUnavailableReason: "document-index-timeout",
    classification: "needs-council-evidence",
  };
  const result = applyEvidenceRefresh(previous, refreshed, new Date("2026-09-30T09:00:00.000Z"));
  assert.equal(result.cycleStatus, "unconfirmed-this-cycle");
  assert.equal(result.evidenceStatus, "official-text");
  assert.equal(result.evidenceExcerpt, previous.evidenceExcerpt);
  assert.equal(result.sourceUrl, previous.sourceUrl);
  assert.equal(result.evidenceUnavailableReason, "document-index-timeout");
});

test("weaker current evidence cannot erase a previously proven opportunity", () => {
  const prior = {
    id: "prior-dcc",
    type: "planning-pipeline-lead",
    sourceSystem: "DCC",
    sourceRecordId: "WEB2137/26",
    title: "Prior title",
    description: "Prior description",
    sourceUrl: "https://example.test/decision.pdf",
    evidenceStatus: "official-text",
    evidenceExcerpt: "An acoustic report shall be submitted.",
    classification: "granted-with-noise-conditions",
    cpvCodes: [],
    matchedTerms: ["acoustic"],
    fitScore: 91,
  };
  const current = {
    ...prior,
    title: "Refreshed title",
    sourceUrl: "https://example.test/application",
    evidenceStatus: "evidence-unavailable",
    evidenceExcerpt: undefined,
    evidenceUnavailableReason: "document-index-timeout",
    classification: "needs-council-evidence",
    matchedTerms: [],
    fitScore: 48,
  };
  const [merged] = mergeCurrentSnapshotWithLedger({
    current: [current],
    priorConfirmed: [prior],
    now: new Date("2026-09-28T09:00:00Z"),
  });
  assert.equal(merged.title, "Refreshed title");
  assert.equal(merged.evidenceStatus, "official-text");
  assert.equal(merged.classification, "granted-with-noise-conditions");
  assert.equal(merged.sourceUrl, prior.sourceUrl);
  assert.equal(merged.cycleStatus, "unconfirmed-this-cycle");
  assert.equal(merged.routedTo, prior.routedTo);
});

test("records resolve only from explicit source status or an applicable expired deadline", () => {
  const base = {
    id: "tender",
    type: "formal-public-tender",
    sourceSystem: "TED",
    sourceRecordId: "1-2026",
    title: "Tender",
    description: "Acoustic consultancy",
    sourceUrl: "https://example.test/tender",
    evidenceStatus: "official-text",
    cpvCodes: ["71313200"],
    matchedTerms: ["acoustic"],
    fitScore: 90,
  };
  assert.equal(positiveResolution({ ...base, deadline: "2026-09-27" }, new Date("2026-09-28T09:00:00Z")), "confirmed-deadline-expired");
  assert.equal(positiveResolution({ ...base, deadline: "2026-09-29" }, new Date("2026-09-28T09:00:00Z")), undefined);
  assert.equal(positiveResolution({ ...base, deadline: "2026-09-29", sourceStatus: "withdrawn" }, new Date("2026-09-28T09:00:00Z")), "source-status-withdrawn");
  assert.equal(positiveResolution({ ...base, scopeStatus: "excluded", scopeExclusionReason: "outside-leinster" }), "target-scope-outside-leinster");

  const planning = {
    ...base,
    type: "planning-pipeline-lead",
    sourceSystem: "DCC",
    classification: "granted-with-noise-conditions",
    deadline: "2020-01-01",
  };
  assert.equal(positiveResolution(planning, new Date("2026-09-28T09:00:00Z")), undefined);
});
