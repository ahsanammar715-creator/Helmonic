import { readFile } from "node:fs/promises";
import path from "node:path";

import { hasConfirmedCurrentAcousticEvidence } from "../../src/lib/tender-intelligence/acoustic-evidence-guard.ts";
import { coalesceOdooRecords } from "../../src/lib/tender-intelligence/odoo-record-source.ts";
import {
  isRfiClassification,
  rfiRequestedAt,
  rfiResponseDueAt,
} from "../../src/lib/tender-intelligence/rfi.ts";

const artifactRoot = process.env.HELMONIC_TENDER_ARTIFACT_ROOT
  ? path.resolve(process.env.HELMONIC_TENDER_ARTIFACT_ROOT)
  : path.resolve("local-artifacts/tender-intelligence");
const ledgerPath = process.env.HELMONIC_RFI_AUDIT_LEDGER
  ? path.resolve(process.env.HELMONIC_RFI_AUDIT_LEDGER)
  : path.join(artifactRoot, "document-proven", "confirmed-ledger.json");
const now = process.env.HELMONIC_RFI_AUDIT_NOW
  ? new Date(process.env.HELMONIC_RFI_AUDIT_NOW)
  : new Date();

if (Number.isNaN(now.getTime())) throw new Error("HELMONIC_RFI_AUDIT_NOW is not a valid date.");

const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
const rawRecords = Array.isArray(ledger) ? ledger : ledger?.opportunities;
if (!Array.isArray(rawRecords)) throw new Error("Confirmed ledger does not contain an opportunities array.");

const records = coalesceOdooRecords(rawRecords);
const rfis = records.filter((record) => isRfiClassification(record.classification));
const auditDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

function day(value) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
}

function status(record) {
  if (record.rfiResponseReceivedAt) return "answered";
  const due = day(rfiResponseDueAt(record));
  if (due === undefined) return "live-undated";
  return due >= auditDay ? "live-dated" : "expired";
}

function isFiRequestDocument(document) {
  const label = `${document.documentType ?? ""} ${document.description ?? ""}`;
  return isRfiClassification(document.classification)
    || /\bf\.?\s*i\.?\s*(?:request|letter)\b|further\s+information\s+(?:request|letter)/i.test(label);
}

function acousticTerms(record) {
  return [...new Set([
    ...(record.matchedTerms ?? []),
    ...(record.evidenceDocuments ?? []).flatMap((document) => document.matchedTerms ?? []),
  ].map((term) => term.trim().toLowerCase()).filter(Boolean))];
}

const statuses = Object.fromEntries(["live-dated", "live-undated", "answered", "expired"]
  .map((value) => [value, rfis.filter((record) => status(record) === value).length]));
const liveRfis = rfis.filter((record) => status(record).startsWith("live-"));
const acousticRfis = rfis.filter((record) => record.classification === "noise-related-rfi"
  && hasConfirmedCurrentAcousticEvidence(record));
const liveAcousticRfis = acousticRfis.filter((record) => status(record).startsWith("live-"));
const generalRfis = rfis.filter((record) => record.classification === "further-information-request");
const liveGeneralRfis = generalRfis.filter((record) => status(record).startsWith("live-"));

const termCounts = new Map();
for (const record of acousticRfis) {
  for (const term of acousticTerms(record)) termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
}

function groupCounts(values, key) {
  const counts = new Map();
  for (const value of values) {
    const label = key(value) || "Unavailable";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) => right[1] - left[1]
    || left[0].localeCompare(right[0])));
}

const documentCoverage = {
  rfiRecordsWithAnyFiRequestDocument: rfis.filter((record) =>
    (record.evidenceDocuments ?? []).some(isFiRequestDocument)).length,
  rfiRecordsWithFetchedFiRequestDocument: rfis.filter((record) =>
    (record.evidenceDocuments ?? []).some((document) => isFiRequestDocument(document)
      && document.fetchStatus === "fetched")).length,
  rfiRecordsWithReadableFiText: rfis.filter((record) =>
    (record.evidenceDocuments ?? []).some((document) => isFiRequestDocument(document)
      && document.fetchStatus === "fetched"
      && Boolean(document.excerpt?.trim()))).length,
  rfiRecordsWithAcousticTermsInFiDocument: rfis.filter((record) =>
    (record.evidenceDocuments ?? []).some((document) => isFiRequestDocument(document)
      && document.fetchStatus === "fetched"
      && (document.matchedTerms?.length ?? 0) > 0)).length,
  rfiRecordsWithUnavailableOrUnsupportedFiDocument: rfis.filter((record) =>
    (record.evidenceDocuments ?? []).some((document) => isFiRequestDocument(document)
      && document.fetchStatus !== "fetched")).length,
};

const result = {
  schemaVersion: 1,
  auditGeneratedAt: now.toISOString(),
  grain: "One deduplicated Odoo opportunity per stable CRM external ID",
  source: "completed-confirmed-ledger",
  population: {
    ledgerRows: rawRecords.length,
    uniqueOpportunitiesAfterOdooCoalescing: records.length,
    repeatedLedgerRowsCoalesced: rawRecords.length - records.length,
    rfiOpportunities: rfis.length,
  },
  rfiStatus: {
    live: liveRfis.length,
    liveDated: statuses["live-dated"],
    liveUndated: statuses["live-undated"],
    answered: statuses.answered,
    expired: statuses.expired,
  },
  acousticFinding: {
    allAcousticallyConfirmedRfis: acousticRfis.length,
    liveAcousticallyConfirmedRfis: liveAcousticRfis.length,
    liveGeneralRfisWithoutConfirmedAcousticWording: liveGeneralRfis.length,
    allGeneralRfisWithoutConfirmedAcousticWording: generalRfis.length,
    percentOfLiveRfisAcousticallyConfirmed: liveRfis.length
      ? Number((100 * liveAcousticRfis.length / liveRfis.length).toFixed(1))
      : 0,
  },
  documentCoverage,
  sourceSystem: groupCounts(rfis, (record) => record.sourceSystem),
  liveAcousticSourceSystem: groupCounts(liveAcousticRfis, (record) => record.sourceSystem),
  topMatchedAcousticTerms: [...termCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 30)
    .map(([term, recordsWithTerm]) => ({ term, recordsWithTerm })),
  dateQuality: {
    rfiRequestedDatePresent: rfis.filter((record) => Boolean(rfiRequestedAt(record))).length,
    rfiResponseDueDatePresentOrDerivable: rfis.filter((record) => Boolean(rfiResponseDueAt(record))).length,
    rfiResponseDueDateMissing: rfis.filter((record) => !rfiResponseDueAt(record)).length,
  },
  interpretation: {
    acousticProofRule: "The current project's official FI/request evidence must contain acoustic/noise wording; historical email relationships do not count.",
    liveRule: "No response received and the six-month response date is today or later; undated genuine RFIs remain visible for date validation.",
    deduplicationRule: "Cross-source observations sharing one stable CRM identity are counted once while their source evidence remains attached.",
  },
};

console.log(`RFI_LEDGER_AUDIT_JSON=${JSON.stringify(result)}`);
console.log(JSON.stringify(result, null, 2));
