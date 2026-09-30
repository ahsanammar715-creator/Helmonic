import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const artifactRoot = path.join(repoRoot, "local-artifacts", "tender-intelligence");
const documentProvenRoot = path.join(artifactRoot, "document-proven");
const ledgerPath = path.join(documentProvenRoot, "confirmed-ledger.json");
const auditPath = path.join(documentProvenRoot, "latest-audit.json");
const statePath = path.join(documentProvenRoot, "pipeline-state.json");

const confirmedPlanningClasses = new Set([
  "noise-related-rfi",
  "granted-with-noise-conditions",
  "refused-on-noise-grounds",
  "design-construction-potential",
]);

function isQualified(record) {
  if (record.cycleStatus === "resolved" || record.evidenceStatus !== "official-text") return false;
  if (["poor", "closed-background"].includes(record.leadQuality) || record.leadDisposition === "background") return false;
  if (record.type === "formal-public-tender") return record.classification !== "no-relevant-opportunity";
  return confirmedPlanningClasses.has(record.classification ?? "");
}

function category(record) {
  return record.type === "formal-public-tender"
    ? "formal-public-tender"
    : record.classification ?? "unclassified";
}

function actionableDeadline(record) {
  if (record.classification === "noise-related-rfi") return record.responseDeadline ?? "";
  if (record.type === "formal-public-tender") return record.deadline ?? "";
  return "";
}

function urgency(record, now = new Date()) {
  const recordCategory = category(record);
  if (recordCategory === "noise-related-rfi") return "urgent";
  if (recordCategory === "granted-with-noise-conditions" || recordCategory === "refused-on-noise-grounds") {
    return "high";
  }
  if (recordCategory !== "formal-public-tender") return "normal";
  const deadline = Date.parse(actionableDeadline(record));
  if (!Number.isFinite(deadline)) return "normal";
  const days = Math.ceil((deadline - now.getTime()) / 86_400_000);
  if (days <= 7) return "urgent";
  if (days <= 14) return "high";
  return "normal";
}

function urgencyWeight(record) {
  return { urgent: 3, high: 2, normal: 1 }[urgency(record)] ?? 0;
}

function qualityWeight(record) {
  return { excellent: 5, good: 4, medium: 3, poor: 2, "closed-background": 1 }[record.leadQuality] ?? 0;
}

function freshnessWeight(record) {
  return {
    "published-today": 6,
    "published-1-3-days": 5,
    "published-4-7-days": 4,
    "published-8-30-days": 3,
    "newly-detected-date-unknown": 2,
    "published-over-30-days": 1,
    "date-unknown": 0,
  }[record.leadFreshness] ?? 0;
}

function evidenceNote(record) {
  if (record.evidenceExcerpt) return "exact excerpt retained";
  if (record.classification === "design-construction-potential") {
    return "design/construction lead; no acoustic planning-stage excerpt required";
  }
  return "legacy confirmed record; exact excerpt not retained - re-verification required";
}

function relationshipStatus(record) {
  return /^exact-party-match-supported-by-(?:glen|owen)-email-evidence$/i.test(record.routingReason ?? "")
    ? "verified warm connection"
    : "no confirmed warm connection";
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function isoDate(value) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : value;
}

const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
const audit = JSON.parse(await readFile(auditPath, "utf8"));
const state = JSON.parse(await readFile(statePath, "utf8"));
const qualified = (ledger.opportunities ?? ledger).filter(isQualified);
const auditCount = audit?.totals?.qualifiedWorkingList;
if (Number.isFinite(auditCount) && auditCount !== qualified.length) {
  throw new Error(`Ledger/audit discrepancy: ledger has ${qualified.length} qualified records; audit reports ${auditCount}.`);
}

const headers = [
  "record_id",
  "source",
  "source_record_id",
  "title",
  "category",
  "lead_quality",
  "pipeline_bucket",
  "qualification_reason",
  "residential_unit_count",
  "residential_scale",
  "evidence_status",
  "source_published_at",
  "source_age_days",
  "freshness_band",
  "freshness_reason",
  "urgency",
  "deadline",
  "deadline_type",
  "source_due_date",
  "evidence_excerpt",
  "evidence_note",
  "document_url",
  "routed_to",
  "routing_reason",
  "relationship_status",
  "status",
  "carry_forward_reason",
  "date_first_seen",
  "date_last_seen",
];

const rows = qualified
  .sort((left, right) => urgencyWeight(right) - urgencyWeight(left)
    || qualityWeight(right) - qualityWeight(left)
    || freshnessWeight(right) - freshnessWeight(left)
    || left.sourceSystem.localeCompare(right.sourceSystem)
    || left.sourceRecordId.localeCompare(right.sourceRecordId))
  .map((record) => {
    const deadline = actionableDeadline(record);
    return [
      record.id,
      record.sourceSystem,
      record.sourceRecordId,
      record.title,
      category(record),
      record.leadQuality ?? "",
      record.leadDisposition ?? "",
      record.qualificationReason ?? "",
      record.residentialUnitCount ?? "",
      record.residentialScale ?? "",
      record.evidenceStatus ?? "",
      record.publishedAt ?? "",
      record.sourceAgeDays ?? "",
      record.leadFreshness ?? "",
      record.freshnessReason ?? "",
      urgency(record),
      deadline,
      deadline ? (record.classification === "noise-related-rfi" ? "RFI response deadline" : "tender submission deadline") : "",
      record.type === "formal-public-tender" || record.classification === "noise-related-rfi" ? "" : record.deadline ?? "",
      record.evidenceExcerpt ?? "",
      evidenceNote(record),
      record.sourceUrl,
      record.routedTo,
      record.routingReason,
      relationshipStatus(record),
      record.cycleStatus,
      record.carryForwardReason ?? "",
      isoDate(record.firstSeenAt),
      isoDate(record.lastSeenAt),
    ];
  });

const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
const allLeadRows = (state.opportunities ?? [])
  .sort((left, right) => qualityWeight(right) - qualityWeight(left)
    || freshnessWeight(right) - freshnessWeight(left)
    || left.sourceSystem.localeCompare(right.sourceSystem)
    || left.sourceRecordId.localeCompare(right.sourceRecordId))
  .map((record) => {
    const deadline = actionableDeadline(record);
    return [
      record.id,
      record.sourceSystem,
      record.sourceRecordId,
      record.title,
      category(record),
      record.leadQuality ?? "",
      record.leadDisposition ?? "",
      record.qualificationReason ?? "",
      record.residentialUnitCount ?? "",
      record.residentialScale ?? "",
      record.evidenceStatus ?? "",
      record.publishedAt ?? "",
      record.sourceAgeDays ?? "",
      record.leadFreshness ?? "",
      record.freshnessReason ?? "",
      urgency(record),
      deadline,
      deadline ? (record.classification === "noise-related-rfi" ? "RFI response deadline" : "tender submission deadline") : "",
      record.type === "formal-public-tender" || record.classification === "noise-related-rfi" ? "" : record.deadline ?? "",
      record.evidenceExcerpt ?? "",
      evidenceNote(record),
      record.sourceUrl,
      record.routedTo,
      record.routingReason,
      relationshipStatus(record),
      record.cycleStatus,
      record.carryForwardReason ?? "",
      isoDate(record.firstSeenAt),
      isoDate(record.lastSeenAt),
    ];
  });
const allLeadCsv = [headers, ...allLeadRows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const outputDirectory = path.join(artifactRoot, "review-exports", timestamp);
const csvPath = path.join(outputDirectory, "tender-intelligence-working-list.csv");
const allLeadsCsvPath = path.join(outputDirectory, "tender-intelligence-all-leads.csv");
const auditCopyPath = path.join(outputDirectory, "latest-audit.json");
await mkdir(outputDirectory, { recursive: true });
await writeFile(csvPath, csv, "utf8");
await writeFile(allLeadsCsvPath, allLeadCsv, "utf8");
await copyFile(auditPath, auditCopyPath);

console.log(JSON.stringify({
  qualifiedRecords: qualified.length,
  csvPath,
  allLeadsCsvPath,
  retainedLeadInventory: allLeadRows.length,
  auditCopyPath,
  populatedEvidenceExcerpts: qualified.filter((record) => Boolean(record.evidenceExcerpt)).length,
  actionableDeadlines: qualified.filter((record) => Boolean(actionableDeadline(record))).length,
  firstSeenDates: qualified.filter((record) => Boolean(record.firstSeenAt)).length,
}, null, 2));
