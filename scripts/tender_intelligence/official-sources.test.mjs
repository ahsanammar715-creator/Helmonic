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
  selectOdooValidationLead,
  summarizeOdooDryRun,
} from "../../src/lib/tender-intelligence/odoo-payload.ts";
import { preflightOdoo, syncOdooLeads } from "../../src/lib/tender-intelligence/odoo-client.ts";
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
import { fetchWithTimeout } from "../../src/lib/tender-intelligence/fetch-with-timeout.ts";

test("referenced timeout aborts a pending fetch instead of leaving top-level await unsettled", async () => {
  let observedSignal;
  const pendingFetch = (_input, init) => new Promise((_resolve, reject) => {
    observedSignal = init?.signal;
    observedSignal?.addEventListener("abort", () => reject(observedSignal.reason), { once: true });
  });

  await assert.rejects(
    () => fetchWithTimeout(pendingFetch, "https://example.test/hanging", {}, 10),
    { name: "TimeoutError" },
  );
  assert.equal(observedSignal?.aborted, true);
});

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
    classification: "design-construction-potential",
    cpvCodes: [],
    matchedTerms: [],
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
  assert.equal(payloads[0].operation, "upsert");
  assert.equal(payloads[0].matchField, "x_helmonic_external_id");
  assert.equal(summarizeOdooDryRun(payloads).uniqueExternalIds, 1);
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

test("one-record Odoo validation selects one strong in-scope official-evidence lead", () => {
  const base = buildOdooDryRun(annotateOpportunityDuplicates([
    qualifyLead(planningLead({
      id: "odoo-validation",
      sourceRecordId: "WEB9000/26",
      projectReference: "WEB9000/26",
      planningAuthority: "Dublin City Council",
      evidenceStatus: "official-text",
      evidenceExcerpt: "The applicant shall submit an acoustic report.",
      classification: "noise-related-rfi",
      routedTo: "Glen",
      scopeStatus: "eligible",
    }), new Date("2026-09-30T12:00:00.000Z")),
  ]))[0];
  const discoveryOnly = structuredClone(base);
  discoveryOnly.matchValue = "discovery-only";
  discoveryOnly.values.x_helmonic_external_id = "discovery-only";
  discoveryOnly.values.x_evidence_status = "discovery-only";
  const outsideRegion = structuredClone(base);
  outsideRegion.matchValue = "outside-region";
  outsideRegion.values.x_helmonic_external_id = "outside-region";
  outsideRegion.values.x_scope_status = "excluded";
  const selected = selectOdooValidationLead([discoveryOnly, outsideRegion, base]);
  assert.equal(selected.matchValue, base.matchValue);
  assert.equal([selected].length, 1);
});

test("one-record Odoo validation fails closed without an eligible lead", () => {
  const payload = buildOdooDryRun(annotateOpportunityDuplicates([
    qualifyLead(planningLead({
      id: "odoo-validation-ineligible",
      evidenceStatus: "discovery-only",
      scopeStatus: "excluded",
    }), new Date("2026-09-30T12:00:00.000Z")),
  ]))[0];
  assert.throws(() => selectOdooValidationLead([payload]), /No in-scope, official-evidence lead/);
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
          description: "html",
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

test("Odoo JSON-2 upsert creates once and updates on a repeated run", async () => {
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
  const fetcher = async (request, options = {}) => {
    const url = String(request);
    const body = options.body ? JSON.parse(String(options.body)) : {};
    if (url.endsWith("/web/version")) return Response.json({ version_info: [19, 0, 0, "final"] });
    if (url.endsWith("/fields_get")) {
      return Response.json(Object.fromEntries(body.allfields.map((field) => [field, {
        type: ODOO_TENDER_FIELD_TYPES[field] ?? ({
          name: "char",
          description: "html",
          type: "selection",
          team_id: "many2one",
          user_id: "many2one",
          priority: "selection",
          stage_id: "many2one",
        }[field] ?? "char"),
      }])));
    }
    if (url.endsWith("/search_read")) return Response.json(existingId ? [{ id: existingId }] : []);
    if (url.endsWith("/create")) {
      assert.equal(body.vals_list[0].x_helmonic_external_id, payloads[0].matchValue);
      assert.equal(body.vals_list[0].team_id, 41);
      assert.equal(body.vals_list[0].x_assigned_person, "Eoghan Tyrrell");
      assert.equal(body.vals_list[0].user_id, 6);
      assert.equal(body.vals_list[0].type, "opportunity");
      creates += 1;
      existingId = 731;
      return Response.json([existingId]);
    }
    if (url.endsWith("/write")) {
      assert.deepEqual(body.ids, [existingId]);
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
  assert.equal(first.created, 1);
  assert.equal(second.updated, 1);
  assert.equal(creates, 1);
  assert.equal(writes, 1);
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

test("BuildingInfo emailed CSV retains exact RFI evidence and project-team contacts", () => {
  const csv = [
    "building_info_project_id,project_title,county,project_url,trigger_type,evidence_document,evidence_excerpt,project_stage,rfi_deadline,planning_reference,planning_authority,unit_count,architect,architect_contact,architect_email,architect_phone",
    "343012,€9.6m Residential Development in Co. Kildare,Kildare,https://app.buildinginfo.test/p-343012,Further Information Request,noise-report.pdf,The developer shall submit a noise impact assessment and acoustic report.,Plans Applied,2026-10-28,26/1234,Kildare County Council,120,Example Architects Ltd,A. Architect,architect@example.test,+35310000000",
  ].join("\n");
  const [record] = parseBuildingInfoCsv(csv, "weekly.csv");
  assert.equal(record.sourceSystem, "BuildingInfo");
  assert.equal(record.evidenceStatus, "official-text");
  assert.equal(record.classification, "noise-related-rfi");
  assert.equal(record.responseDeadline, "2026-10-28");
  assert.equal(record.evidenceDocuments.length, 1);
  assert.match(record.evidenceExcerpt, /noise impact assessment/);
  assert.equal(record.parties[0].role, "architect");
  assert.equal(record.parties[0].phone, "+35310000000");
  assert.equal(applyTargetScope(record).scopeStatus, "eligible");
  const qualified = qualifyLead(record, new Date("2026-10-07T12:00:00.000Z"));
  assert.equal(qualified.leadQuality, "excellent");
  assert.equal(qualified.leadDisposition, "active");
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
  assert.match(records[0].evidenceExcerpt, /acoustic assessment/);
  assert.match(records[0].evidenceExcerpt, /vibration report/);
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
    LinkAppDetails: "https://example.test/26-100",
  } }] });
  assert.equal(records.length, 1);
  assert.equal(records[0].evidenceStatus, "discovery-only");
  assert.notEqual(records[0].classification, "granted-with-noise-conditions");
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
  assert.match(enriched.sourceUrl, new RegExp(guid));
  assert.match(enriched.evidenceExcerpt, /acoustic report/i);
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

test("restricted Search lookup uses exact party evidence without exposing message bodies", async () => {
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
        body_text: "Previous correspondence with contact@example-architect.ie",
        mailbox_owner: "Glen",
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
    classification: "noise-related-rfi",
    cpvCodes: [],
    matchedTerms: ["noise"],
    fitScore: 95,
  };
  const routed = routeOpportunityByRelationships({ ...base, applicant: "Example Developments Limited" }, lookup);
  assert.equal(routed.routedTo, "Glen");
  assert.equal(routed.routingEvidence[0].evidenceRefs[0], "[E:glen:100]");
  const ambiguous = routeOpportunityByRelationships({ ...base, applicant: "Dual Contact" }, lookup);
  assert.equal(ambiguous.routedTo, "unassigned");
  assert.equal(ambiguous.routingStatus, "needs-triage");

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
    classification: "design-construction-potential",
    cpvCodes: [],
    matchedTerms: [],
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
    classification: "design-construction-potential",
    cpvCodes: [],
    matchedTerms: [],
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
    classification: "design-construction-potential",
    cpvCodes: [],
    matchedTerms: [],
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
    classification: "design-construction-potential",
    cpvCodes: [],
    matchedTerms: [],
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
