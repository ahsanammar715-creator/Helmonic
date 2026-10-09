import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectBuildingInfoCsvProjects } from "../../src/lib/tender-intelligence/building-info-csv.ts";
import { annotateOpportunityDuplicates } from "../../src/lib/tender-intelligence/deduplication.ts";
import { qualifyLead } from "../../src/lib/tender-intelligence/lead-qualification.ts";
import { buildOdooDryRun, summarizeOdooDryRun } from "../../src/lib/tender-intelligence/odoo-payload.ts";
import { loadRelationshipLookup, routeOpportunitiesByRelationships } from "../../src/lib/tender-intelligence/relationship-routing.ts";
import { applyTargetScope, withinTargetScope } from "../../src/lib/tender-intelligence/source-scope.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const inputDirectory = process.env.HELMONIC_BUILDINGINFO_CSV_DIRECTORY
  ? path.resolve(process.env.HELMONIC_BUILDINGINFO_CSV_DIRECTORY)
  : path.join(repoRoot, "local-artifacts", "tender-intelligence", "incoming", "buildinginfo");
const outputRoot = process.env.HELMONIC_BUILDINGINFO_TEST_ROOT
  ? path.resolve(process.env.HELMONIC_BUILDINGINFO_TEST_ROOT)
  : path.join(repoRoot, "local-artifacts", "tender-intelligence", "buildinginfo-test");
const relationshipDirectory = process.env.HELMONIC_RELATIONSHIP_INDEX_DIR
  ? path.resolve(process.env.HELMONIC_RELATIONSHIP_INDEX_DIR)
  : path.join(repoRoot, "local-artifacts", "pst-index", "relationships");
const now = new Date();
const runId = now.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const outputDirectory = path.join(outputRoot, "runs", runId);

const collected = await collectBuildingInfoCsvProjects({
  enabled: true,
  directory: inputDirectory,
  maxFiles: 100,
  maxFileBytes: 10 * 1024 * 1024,
});
const scoped = collected.records.map(applyTargetScope);
const eligible = scoped.filter(withinTargetScope);
const qualified = annotateOpportunityDuplicates(eligible.map((record) => qualifyLead(record, now)));
const relationshipLookup = loadRelationshipLookup(relationshipDirectory);
const routed = routeOpportunitiesByRelationships(qualified, relationshipLookup);
const payloads = buildOdooDryRun(routed);
const pipelineState = {
  status: "complete",
  startedAt: now.toISOString(),
  completedAt: now.toISOString(),
  updatedAt: now.toISOString(),
  sources: [{
    name: "BuildingInfo",
    status: "ok",
    records: eligible.length,
    scannedRecords: collected.scannedRecords,
    inputFiles: collected.importedFiles,
    duplicatesCollapsed: collected.duplicatesCollapsed,
  }],
  opportunities: routed,
  nationalProcessed: 0,
};
const summary = {
  status: "completed",
  runId,
  inputFiles: collected.importedFiles,
  scannedRecords: collected.scannedRecords,
  duplicatesCollapsed: collected.duplicatesCollapsed,
  excludedOutsideLeinster: scoped.length - eligible.length,
  leinsterRecords: eligible.length,
  exactRelationshipRoutes: routed.filter((record) => record.routingReason?.startsWith("exact-party-match-supported-by-")).length,
  balancedAssignments: routed.filter((record) => record.routingReason?.startsWith("balanced-assignment-")).length,
  relationshipIndexAvailable: Boolean(relationshipLookup),
  odoo: summarizeOdooDryRun(payloads),
};

await mkdir(path.join(outputRoot, "document-proven"), { recursive: true });
await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputRoot, "document-proven", "pipeline-state.json"), `${JSON.stringify(pipelineState, null, 2)}\n`, "utf8");
await writeFile(path.join(outputDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
await writeFile(path.join(outputDirectory, "odoo-lead-upserts.json"), `${JSON.stringify(payloads, null, 2)}\n`, "utf8");
await writeFile(path.join(outputDirectory, "relationship-routing.json"), `${JSON.stringify(routed.map((record) => ({
  sourceRecordId: record.sourceRecordId,
  title: record.title,
  routedTo: record.routedTo,
  routingStatus: record.routingStatus,
  routingReason: record.routingReason,
  routingEvidence: record.routingEvidence,
})), null, 2)}\n`, "utf8");

console.log(JSON.stringify({ ...summary, outputDirectory, pipelineStatePath: path.join(outputRoot, "document-proven", "pipeline-state.json") }, null, 2));
