import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const artifactRoot = path.join(repoRoot, "local-artifacts", "tender-intelligence");
const ledgerPath = path.join(artifactRoot, "document-proven", "confirmed-ledger.json");
const planningClasses = new Set([
  "noise-related-rfi",
  "granted-with-noise-conditions",
  "refused-on-noise-grounds",
  "design-construction-potential",
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function qualified(record) {
  if (record.cycleStatus === "resolved" || record.evidenceStatus !== "official-text") return false;
  if (record.deduplicationStatus === "duplicate") return false;
  if (["poor", "closed-background"].includes(record.leadQuality) || record.leadDisposition === "background") return false;
  if (record.type === "formal-public-tender") return record.classification !== "no-relevant-opportunity";
  return planningClasses.has(record.classification ?? "");
}

function category(record) {
  return record.type === "formal-public-tender" ? "formal-public-tender" : record.classification;
}

function urgencyRank(record) {
  if (record.classification === "noise-related-rfi") return 0;
  if (record.classification === "granted-with-noise-conditions") return 1;
  if (record.classification === "refused-on-noise-grounds") return 2;
  if (record.type === "formal-public-tender") return 3;
  return 4;
}

function freshnessRank(record) {
  return {
    "updated-today": 0,
    "published-today": 0,
    "updated-1-3-days": 1,
    "published-1-3-days": 1,
    "updated-4-7-days": 2,
    "published-4-7-days": 2,
    "updated-8-30-days": 3,
    "published-8-30-days": 3,
    "newly-detected-date-unknown": 4,
    "updated-over-30-days": 5,
    "published-over-30-days": 5,
    "date-unknown": 6,
  }[record.leadFreshness] ?? 6;
}

function exactEvidenceRefs(record) {
  if (!/^exact-party-match-supported-by-(?:glen|owen)-email-evidence$/i.test(record.routingReason ?? "")) return [];
  return [...new Set((record.routingEvidence ?? []).flatMap((evidence) => evidence.evidenceRefs ?? []))];
}

function leadCard(record) {
  const deadline = record.responseDeadline || (record.type === "formal-public-tender" ? record.deadline : "");
  const refs = exactEvidenceRefs(record);
  const connection = refs.length > 0
    ? `<strong>Verified warm connection:</strong> ${escapeHtml(refs.join(", "))}`
    : "<strong>Connection:</strong> No confirmed warm connection";
  const evidence = record.evidenceExcerpt
    ? `<blockquote>${escapeHtml(record.evidenceExcerpt)}</blockquote>`
    : `<p class="warning">${record.classification === "design-construction-potential"
      ? "Design/construction potential; no acoustic planning-stage excerpt is claimed."
      : "Exact excerpt was not retained in the legacy audit; re-verification is required before outreach."}</p>`;
  return `<article>
    <h3>${escapeHtml(record.title)}</h3>
    <p><strong>${escapeHtml(record.sourceSystem)} · ${escapeHtml(record.sourceRecordId)}</strong></p>
    <p><strong>Category:</strong> ${escapeHtml(category(record))} · <strong>Lead quality:</strong> ${escapeHtml(record.leadQuality ?? "ungraded")} · <strong>Pipeline:</strong> ${escapeHtml(record.leadDisposition ?? "unassigned")}</p>
    <p><strong>Qualification:</strong> ${escapeHtml(record.qualificationReason ?? "No commercial qualification reason retained.")}</p>
    <p><strong>Freshness:</strong> ${escapeHtml(record.leadFreshness ?? "date-unknown")}${Number.isFinite(record.sourceAgeDays) ? ` · ${escapeHtml(record.sourceAgeDays)} day(s) since source publication` : ""}</p>
    <p>${escapeHtml(record.freshnessReason ?? "No reliable source publication date was retained.")}</p>
    <p><strong>CRM identity:</strong> ${escapeHtml(record.crmExternalId ?? record.id)} · ${escapeHtml(record.deduplicationStatus ?? "unique")}</p>
    <p><strong>Status:</strong> ${escapeHtml(record.cycleStatus)}</p>
    ${deadline ? `<p><strong>Deadline:</strong> ${escapeHtml(deadline)}</p>` : ""}
    <p><strong>Routing:</strong> ${escapeHtml(record.routingReason)}</p>
    <p>${connection}</p>
    ${evidence}
    <p><a href="${escapeHtml(record.sourceUrl)}">Open authoritative source</a></p>
  </article>`;
}

const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
const records = (ledger.opportunities ?? ledger).filter(qualified);
const owners = ["Glen", "Owen"];
const sections = owners.map((owner) => {
  const owned = records
    .filter((record) => record.routedTo === owner)
    .sort((left, right) => urgencyRank(left) - urgencyRank(right)
      || freshnessRank(left) - freshnessRank(right)
      || left.sourceSystem.localeCompare(right.sourceSystem)
      || left.sourceRecordId.localeCompare(right.sourceRecordId));
  return `<section><h2>${owner} (${owned.length})</h2>${owned.map(leadCard).join("\n")}</section>`;
}).join("\n");
const unassigned = records.filter((record) => !owners.includes(record.routedTo));
if (unassigned.length > 0) throw new Error(`${unassigned.length} qualified records are not routed to Glen or Owen.`);

const exact = records.filter((record) => exactEvidenceRefs(record).length > 0).length;
const carried = records.filter((record) => record.cycleStatus === "unconfirmed-this-cycle").length;
const generatedAt = new Date().toISOString();
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>iAcoustics Tender Intelligence review</title>
<style>
body{font-family:Arial,sans-serif;color:#172033;max-width:980px;margin:32px auto;padding:0 20px;line-height:1.45}
h1,h2{color:#164f8c}h2{border-bottom:2px solid #164f8c;padding-bottom:8px;margin-top:40px}
article{border:1px solid #dbe3ec;border-radius:8px;padding:16px;margin:14px 0;background:#fff}
h3{margin:0 0 8px}p{margin:6px 0}blockquote{margin:10px 0;padding:10px 14px;background:#f5f8fb;border-left:4px solid #5b89b8}
.warning{color:#8a4b00;background:#fff6e5;padding:8px 10px;border-radius:4px}.summary{background:#eef4fa;padding:14px;border-radius:8px}
</style></head><body>
<h1>iAcoustics Tender Intelligence review</h1>
<div class="summary"><strong>${records.length} qualified leads</strong> · ${exact} exact [E]-backed routes · ${records.length - exact} balanced without a confirmed warm connection · ${carried} carried forward<br>Generated ${escapeHtml(generatedAt)}. Review artifact only; nothing has been sent.</div>
${sections}
</body></html>`;

const timestamp = generatedAt.replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const outputDirectory = path.join(artifactRoot, "review-digests", timestamp);
const outputPath = path.join(outputDirectory, "tender-intelligence-review.html");
await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, html, "utf8");
console.log(JSON.stringify({ outputPath, records: records.length, exactEvidenceRoutes: exact, carriedForward: carried }, null, 2));
