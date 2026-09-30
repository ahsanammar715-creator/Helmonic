import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectOfficialSourceSnapshot } from "../../src/lib/tender-intelligence/official-sources.ts";
import { enrichFormalTenderOpportunities } from "../../src/lib/tender-intelligence/formal-document-evidence.ts";
import { enrichNationalPlanningOpportunities } from "../../src/lib/tender-intelligence/national-planning-evidence.ts";
import { routeOpportunitiesByRelationships } from "../../src/lib/tender-intelligence/relationship-routing.ts";
import {
  applyEvidenceRefresh,
  confirmedLedgerRecords,
  isConfirmedOpportunity,
  mergeCurrentSnapshotWithLedger,
  opportunityIdentity,
  routingMetadataWithDurablePrecedence,
} from "../../src/lib/tender-intelligence/carry-forward.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const artifactDirectory = path.join(repoRoot, "local-artifacts", "tender-intelligence", "document-proven");
const statePath = path.join(artifactDirectory, "pipeline-state.json");
const reportPath = path.join(artifactDirectory, "latest-audit.json");
const ledgerPath = path.join(artifactDirectory, "confirmed-ledger.json");
const runHistoryDirectory = path.join(artifactDirectory, "runs");
const envPath = path.join(repoRoot, ".env.local");
const batchSize = Math.max(1, Number.parseInt(process.env.HELMONIC_COUNCIL_EVIDENCE_BATCH_SIZE || "10", 10));
const retryUnavailable = process.argv.includes("--retry-unavailable");
const summarizeOnly = process.argv.includes("--summarize-only");

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/)
    .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
}

let localEnv = {};
try {
  localEnv = parseEnv(await readFile(envPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const value = (name) => process.env[name]?.trim() || localEnv[name]?.trim();

await mkdir(artifactDirectory, { recursive: true });
await mkdir(runHistoryDirectory, { recursive: true });

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function auditRecordToOpportunity(record, completedAt) {
  return {
    id: record.id,
    type: record.sourceSystem === "TED" || record.sourceSystem === "eTenders"
      ? "formal-public-tender"
      : "planning-pipeline-lead",
    sourceSystem: record.sourceSystem,
    sourceRecordId: record.sourceRecordId,
    projectReference: record.sourceRecordId,
    title: `${record.sourceSystem} · ${record.sourceRecordId}`,
    description: "Carried forward from an earlier authoritative-evidence audit.",
    sourceUrl: record.sourceUrl,
    evidenceStatus: record.evidenceStatus,
    evidenceDocuments: [{
      id: `${record.sourceSystem}:${record.sourceRecordId}:historical-audit-evidence`,
      documentType: "Authoritative source retained by historical audit",
      sourceUrl: record.sourceUrl,
      fetchStatus: "fetched",
      matchedTerms: [],
      classification: record.classification,
    }],
    classification: record.classification,
    cpvCodes: [],
    matchedTerms: [],
    fitScore: record.classification === "noise-related-rfi" ? 95
      : record.classification === "granted-with-noise-conditions" ? 88
        : record.classification === "refused-on-noise-grounds" ? 84
          : record.classification === "design-construction-potential" ? 60 : 35,
    routedTo: record.routedTo,
    routingStatus: record.routingStatus,
    routingReason: record.routingReason,
    firstSeenAt: completedAt,
    lastSeenAt: completedAt,
    lastConfirmedAt: completedAt,
  };
}

async function loadHistoricalConfirmedRecords() {
  const byIdentity = new Map();
  let files = [];
  try {
    files = (await readdir(runHistoryDirectory)).filter((name) => name.endsWith("-audit.json")).sort().reverse();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const name of files) {
    const audit = await readJsonIfPresent(path.join(runHistoryDirectory, name));
    for (const record of audit?.confirmedRecords ?? []) {
      // New-format audits are already represented by the durable ledger. This
      // loader exists only to migrate the older snapshot-only history once.
      if (record.cycleStatus) continue;
      const opportunity = auditRecordToOpportunity(record, audit.completedAt);
      const key = opportunityIdentity(opportunity);
      if (!byIdentity.has(key)) byIdentity.set(key, opportunity);
    }
  }
  return [...byIdentity.values()];
}

function mergePriorConfirmedRecords(fullRecords, legacyAuditRecords) {
  const byIdentity = new Map();
  for (const record of fullRecords) {
    const key = opportunityIdentity(record);
    if (!byIdentity.has(key)) byIdentity.set(key, record);
  }
  for (const legacy of legacyAuditRecords) {
    const key = opportunityIdentity(legacy);
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, legacy);
      continue;
    }
    // The durable ledger is authoritative. Legacy snapshot audits are only a
    // migration fallback for records that never received a durable owner.
    byIdentity.set(key, {
      ...legacy,
      ...existing,
      ...routingMetadataWithDurablePrecedence(existing, legacy),
    });
  }
  return [...byIdentity.values()];
}

function routeCurrentAndPreserveCarryForward(records) {
  const routeable = records.filter((record) => record.cycleStatus !== "unconfirmed-this-cycle");
  const routed = new Map(routeOpportunitiesByRelationships(
    routeable,
    undefined,
    { preserveExistingRoutes: true },
  ).map((record) => [opportunityIdentity(record), record]));
  return records.map((record) => routed.get(opportunityIdentity(record)) ?? record);
}

let state;
let previousCompletedState;
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
  if (!Array.isArray(state.opportunities)) state = undefined;
  else if (state.status === "complete" && !retryUnavailable && !summarizeOnly) {
    previousCompletedState = state;
    state = undefined;
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (!state) {
  console.log("Discovering current records and proving DCC/TED/eTenders documents...");
  const snapshot = await collectOfficialSourceSnapshot({
    planningLeads: {
      enabled: value("HELMONIC_PLANNINGLEADS_ENABLED") === "true",
      endpoint: value("PLANNINGLEADS_API_ENDPOINT") || "https://planningleads.ie/api/v1",
      apiKey: value("PLANNINGLEADS_API_KEY"),
      pageSize: Number.parseInt(value("HELMONIC_PLANNINGLEADS_PAGE_SIZE") || "100", 10),
      cacheHours: 1,
    },
    documentEvidence: { formal: true, nationalPlanningLimit: 0 },
  });
  const persistedLedger = await readJsonIfPresent(ledgerPath);
  const fullPriorRecords = [
    ...(persistedLedger?.opportunities ?? []),
    ...(previousCompletedState?.opportunities ?? []).filter(isConfirmedOpportunity),
  ];
  const priorConfirmed = mergePriorConfirmedRecords(fullPriorRecords, await loadHistoricalConfirmedRecords());
  const opportunities = mergeCurrentSnapshotWithLedger({
    current: snapshot.opportunities,
    priorConfirmed,
  });
  state = {
    status: "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sources: snapshot.sources,
    opportunities,
    nationalProcessed: 0,
  };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

if (retryUnavailable) {
  const formalIndexes = state.opportunities
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.type === "formal-public-tender" && record.evidenceStatus === "evidence-unavailable");
  if (formalIndexes.length > 0) {
    const repaired = await enrichFormalTenderOpportunities(formalIndexes.map(({ record }) => record));
    formalIndexes.forEach(({ index }, repairedIndex) => { state.opportunities[index] = repaired[repairedIndex]; });
  }
  state.status = "running";
  state.nationalProcessed = 0;
}

const nationalIndexes = summarizeOnly ? [] : state.opportunities
  .map((record, index) => ({ record, index }))
  .filter(({ record }) => record.sourceSystem === "National Planning Register" && (
    !retryUnavailable || record.evidenceStatus === "evidence-unavailable"
  ) && record.cycleStatus !== "resolved")
  .map(({ index }) => index);

for (let offset = state.nationalProcessed || 0; offset < nationalIndexes.length; offset += batchSize) {
  const indexes = nationalIndexes.slice(offset, offset + batchSize);
  const batch = indexes.map((index) => state.opportunities[index]);
  const enriched = await enrichNationalPlanningOpportunities(batch, {
    limit: batch.length,
    concurrency: 3,
  });
  indexes.forEach((index, batchIndex) => {
    state.opportunities[index] = applyEvidenceRefresh(
      state.opportunities[index],
      enriched[batchIndex],
    );
  });
  state.opportunities = routeCurrentAndPreserveCarryForward(state.opportunities);
  state.nationalProcessed = offset + indexes.length;
  state.updatedAt = new Date().toISOString();
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  console.log(`Council document evidence ${state.nationalProcessed}/${nationalIndexes.length}`);
}

state.opportunities = routeCurrentAndPreserveCarryForward(state.opportunities);
state.status = "complete";
state.completedAt = new Date().toISOString();
state.updatedAt = state.completedAt;

const confirmedClasses = new Set([
  "noise-related-rfi",
  "granted-with-noise-conditions",
  "refused-on-noise-grounds",
  "design-construction-potential",
]);
const planningStageClasses = new Set([
  "noise-related-rfi",
  "granted-with-noise-conditions",
  "refused-on-noise-grounds",
]);
const isFormalConfirmed = (record) => record.evidenceStatus === "official-text"
  && record.cycleStatus !== "resolved"
  && record.type === "formal-public-tender"
  && record.classification !== "no-relevant-opportunity";
const isPlanningStageConfirmed = (record) => record.evidenceStatus === "official-text"
  && record.cycleStatus !== "resolved"
  && planningStageClasses.has(record.classification);
const isConfirmed = (record) => isFormalConfirmed(record) || (
  record.evidenceStatus === "official-text"
  && record.cycleStatus !== "resolved"
  && confirmedClasses.has(record.classification)
);
const sourceNames = ["TED", "eTenders", "National Planning Register", "DCC", "PlanningLeads"];
const sources = sourceNames.map((name) => {
  const rows = state.opportunities.filter((record) => record.sourceSystem === name);
  const fetch = state.sources?.find((source) => source.name === name);
  return {
    name,
    fetchStatus: fetch?.status ?? "unknown",
    fetchError: fetch?.error,
    totalCandidates: rows.length,
    officialDocumentsInspected: rows.filter((record) => record.evidenceStatus === "official-text").length,
    confirmedFormalTender: rows.filter(isFormalConfirmed).length,
    confirmedPlanningStageOpportunity: rows.filter(isPlanningStageConfirmed).length,
    documentInspectedDesignPotential: rows.filter((record) => record.evidenceStatus === "official-text" && record.classification === "design-construction-potential").length,
    qualifiedWorkingList: rows.filter(isConfirmed).length,
    inspectedNotRelevant: rows.filter((record) => record.evidenceStatus === "official-text" && !isConfirmed(record)).length,
    discoveryOnly: rows.filter((record) => record.evidenceStatus === "discovery-only").length,
    evidenceUnavailable: rows.filter((record) => record.evidenceStatus === "evidence-unavailable").length,
    routedToGlen: rows.filter((record) => record.routedTo === "Glen").length,
    routedToOwen: rows.filter((record) => record.routedTo === "Owen").length,
    exactRelationshipRoutes: rows.filter((record) => record.routingReason?.startsWith("exact-party-match-supported-by-")).length,
    balancedAssignments: rows.filter((record) => record.routingReason?.startsWith("balanced-assignment-")).length,
    needsTriage: rows.filter((record) => record.routingStatus === "needs-triage").length,
    carriedForwardUnconfirmed: rows.filter((record) => record.cycleStatus === "unconfirmed-this-cycle").length,
    resolved: rows.filter((record) => record.cycleStatus === "resolved").length,
  };
});

const confirmed = state.opportunities.filter(isConfirmed);
const report = {
  startedAt: state.startedAt,
  completedAt: state.completedAt,
  acceptanceRule: "Discovery metadata never confirms an opportunity. Confirmation requires authoritative document text, an exact excerpt and source URL. Missing or unreadable evidence fails closed.",
  filters: {
    keywords: ["noise", "vibration", "sound", "acoustic", "acoustics", "acoustician"],
    cpvCodes: ["71313100", "71313200", "71313400", "90742000", "90742300", "90742400"],
    sectors: ["residential (multi-unit)", "commercial/retail", "education", "healthcare", "industrial", "mixed-use", "hospitality/hotel", "data centres", "transport/infrastructure"],
    excludedSectors: ["agriculture"],
  },
  sources,
  totals: {
    candidates: state.opportunities.length,
    officialDocumentsInspected: state.opportunities.filter((record) => record.evidenceStatus === "official-text").length,
    confirmedFormalTenders: confirmed.filter(isFormalConfirmed).length,
    confirmedPlanningStageOpportunities: confirmed.filter(isPlanningStageConfirmed).length,
    documentInspectedDesignPotential: confirmed.filter((record) => record.classification === "design-construction-potential").length,
    qualifiedWorkingList: confirmed.length,
    routedToGlen: confirmed.filter((record) => record.routedTo === "Glen").length,
    routedToOwen: confirmed.filter((record) => record.routedTo === "Owen").length,
    exactRelationshipRoutes: confirmed.filter((record) => record.routingReason?.startsWith("exact-party-match-supported-by-")).length,
    balancedAssignments: confirmed.filter((record) => record.routingReason?.startsWith("balanced-assignment-")).length,
    needsTriage: confirmed.filter((record) => record.routingStatus === "needs-triage").length,
    relationshipIndexUnavailable: confirmed.filter((record) => record.routingStatus === "relationship-index-unavailable").length,
    carriedForwardUnconfirmed: confirmed.filter((record) => record.cycleStatus === "unconfirmed-this-cycle").length,
    resolved: state.opportunities.filter((record) => record.cycleStatus === "resolved").length,
  },
  confirmedRecords: confirmed.map((record) => ({
    id: record.id,
    sourceSystem: record.sourceSystem,
    sourceRecordId: record.sourceRecordId,
    classification: record.classification ?? "formal-public-tender",
    evidenceStatus: record.evidenceStatus,
    sourceUrl: record.sourceUrl,
    routedTo: record.routedTo,
    routingStatus: record.routingStatus,
    routingReason: record.routingReason,
    cycleStatus: record.cycleStatus,
    carryForwardReason: record.carryForwardReason,
    missingSince: record.missingSince,
  })),
};

const weeklyLists = {
  glen: confirmed.filter((record) => record.routedTo === "Glen"),
  owen: confirmed.filter((record) => record.routedTo === "Owen"),
  triage: confirmed.filter((record) => record.routedTo === "unassigned"),
  dailyUrgentRfi: confirmed.filter((record) => record.classification === "noise-related-rfi"),
};

function deliveryNote(record) {
  return record.routingReason?.startsWith("exact-party-match-supported-by-")
    ? "Verified warm connection in the restricted email relationship index."
    : "Balanced assignment only; no prior relationship is confirmed. Do not imply previous contact.";
}

function renderRecipientDigest(owner, records) {
  const items = records.map((record, index) => [
    `## ${index + 1}. ${record.title}`,
    `- Category: ${record.classification ?? "formal-public-tender"}`,
    `- Source: ${record.sourceSystem} · ${record.sourceRecordId}`,
    `- Deadline: ${record.responseDeadline || record.deadline || "Not published"}`,
    `- Fit: ${record.fitScore}`,
    `- Assignment note: ${deliveryNote(record)}`,
    `- Evidence: ${record.evidenceExcerpt || "Authoritative document inspected; open the source for the retained evidence."}`,
    `- Source document: ${record.sourceUrl}`,
  ].join("\n"));
  return [
    `# ${owner} — Tender Intelligence`,
    "",
    `Generated: ${state.completedAt}`,
    `Assigned opportunities: ${records.length}`,
    "",
    "These are internal opportunity assignments. Warm-connection wording is permitted only where the assignment note explicitly confirms it.",
    "",
    ...items,
    "",
  ].join("\n\n");
}

const runId = state.completedAt.replace(/[:.]/g, "-");
await Promise.all([
  writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8"),
  writeFile(ledgerPath, `${JSON.stringify({
    updatedAt: state.completedAt,
    opportunities: confirmedLedgerRecords(state.opportunities),
  }, null, 2)}\n`, "utf8"),
  writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(path.join(runHistoryDirectory, `${runId}-audit.json`), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  ...Object.entries(weeklyLists).map(([name, records]) =>
    writeFile(path.join(artifactDirectory, `${name}.json`), `${JSON.stringify(records, null, 2)}\n`, "utf8")),
  writeFile(path.join(artifactDirectory, "glen.md"), renderRecipientDigest("Glen", weeklyLists.glen), "utf8"),
  writeFile(path.join(artifactDirectory, "owen.md"), renderRecipientDigest("Owen", weeklyLists.owen), "utf8"),
]);

console.log(JSON.stringify({ ...report, reportPath, statePath }, null, 2));
