import { hasConfirmedCurrentAcousticEvidence } from "./acoustic-evidence-guard.ts";
import type { TenderOpportunity } from "./types.ts";

type OdooSyncInput = {
  status?: unknown;
  completedAt?: unknown;
  created?: unknown;
  updated?: unknown;
  unchanged?: unknown;
  failures?: unknown;
};

export type RfiChangeItem = {
  id: string;
  sourceSystem: string;
  sourceRecordId: string;
  title: string;
  county: string;
  classification: string;
  evidenceStatus: string;
  evidenceExcerpt: string;
  documentUrl: string;
  responseDeadline: string;
  firstSeenAt: string;
  lastSeenAt: string;
  routedTo: string;
  changeReason: string;
};

function recordKey(record: TenderOpportunity) {
  return record.canonicalOpportunityId
    || record.id
    || `${record.sourceSystem}:${record.sourceRecordId}`;
}

function isRfi(record?: TenderOpportunity) {
  return Boolean(record && ["noise-related-rfi", "further-information-request"].includes(record.classification ?? ""));
}

function isLive(record?: TenderOpportunity) {
  return Boolean(record
    && isRfi(record)
    && record.cycleStatus !== "resolved"
    && !record.rfiResponseReceivedAt
    && record.leadDisposition !== "background");
}

function confirmedAcoustic(record?: TenderOpportunity) {
  return Boolean(record
    && record.classification === "noise-related-rfi"
    && hasConfirmedCurrentAcousticEvidence(record));
}

function unavailableEvidence(record: TenderOpportunity) {
  return record.evidenceStatus === "evidence-unavailable"
    || (record.evidenceDocuments ?? []).some((document) => document.fetchStatus === "unavailable");
}

function materialSignature(record: TenderOpportunity) {
  return JSON.stringify({
    classification: record.classification,
    evidenceStatus: record.evidenceStatus,
    evidenceExcerpt: record.evidenceExcerpt,
    responseDeadline: record.responseDeadline,
    rfiPublishedAt: record.rfiPublishedAt,
    rfiReceivedAt: record.rfiReceivedAt,
    rfiResponseReceivedAt: record.rfiResponseReceivedAt,
    cycleStatus: record.cycleStatus,
    sourceStatus: record.sourceStatus,
    routedTo: record.routedTo,
  });
}

function item(record: TenderOpportunity, changeReason: string): RfiChangeItem {
  const documentUrl = (record.evidenceDocuments ?? [])
    .find((document) => document.fetchStatus === "fetched" && document.sourceUrl)?.sourceUrl;
  return {
    id: recordKey(record),
    sourceSystem: record.sourceSystem,
    sourceRecordId: record.sourceRecordId,
    title: record.title,
    county: record.county ?? "",
    classification: record.classification ?? "",
    evidenceStatus: record.evidenceStatus,
    evidenceExcerpt: record.evidenceExcerpt ?? "",
    documentUrl: documentUrl ?? record.sourceUrl,
    responseDeadline: record.responseDeadline ?? "",
    firstSeenAt: record.firstSeenAt ?? "",
    lastSeenAt: record.lastSeenAt ?? "",
    routedTo: record.routedTo ?? "unassigned",
    changeReason,
  };
}

function sortItems(items: RfiChangeItem[]) {
  return items.sort((left, right) =>
    left.responseDeadline.localeCompare(right.responseDeadline)
    || right.firstSeenAt.localeCompare(left.firstSeenAt)
    || left.sourceSystem.localeCompare(right.sourceSystem)
    || left.sourceRecordId.localeCompare(right.sourceRecordId));
}

export function buildRfiChangeReport({
  currentRecords,
  priorRecords,
  runId,
  startedAt,
  completedAt = new Date().toISOString(),
  odooSync,
}: {
  currentRecords: TenderOpportunity[];
  priorRecords: TenderOpportunity[];
  runId: string;
  startedAt: string;
  completedAt?: string;
  odooSync?: OdooSyncInput;
}) {
  const currentById = new Map(currentRecords.map((record) => [recordKey(record), record]));
  const priorById = new Map(priorRecords.map((record) => [recordKey(record), record]));
  const newRfis: RfiChangeItem[] = [];
  const newlyConfirmedAcousticRfis: RfiChangeItem[] = [];
  const materiallyChangedRfis: RfiChangeItem[] = [];
  const evidenceUnavailableRfis: RfiChangeItem[] = [];
  const resolvedRfis: RfiChangeItem[] = [];

  for (const [key, current] of currentById) {
    if (!isRfi(current)) continue;
    const prior = priorById.get(key);
    if (isLive(current) && !prior) {
      newRfis.push(item(current, "new RFI identity not present in the prior retained inventory"));
    }
    if (isLive(current) && confirmedAcoustic(current) && !confirmedAcoustic(prior)) {
      newlyConfirmedAcousticRfis.push(item(
        current,
        prior
          ? "existing RFI newly confirmed from authoritative acoustic/noise document text"
          : "new RFI confirmed from authoritative acoustic/noise document text",
      ));
    }
    if (prior && materialSignature(prior) !== materialSignature(current)) {
      materiallyChangedRfis.push(item(current, "classification, evidence, deadline, routing or lifecycle status changed"));
    }
    if (isLive(current) && unavailableEvidence(current)) {
      evidenceUnavailableRfis.push(item(current, "one or more authoritative RFI documents could not be retrieved or read"));
    }
    if (prior && isLive(prior) && !isLive(current)) {
      resolvedRfis.push(item(current, "positive current record state indicates the RFI is no longer live"));
    }
  }

  const syncCompletedAt = typeof odooSync?.completedAt === "string" ? odooSync.completedAt : "";
  const syncIsCurrent = Boolean(syncCompletedAt && Date.parse(syncCompletedAt) >= Date.parse(startedAt));
  const odooFailures = syncIsCurrent && Array.isArray(odooSync?.failures) ? odooSync.failures.length : 0;
  const report = {
    schemaVersion: 1,
    runId,
    startedAt,
    completedAt,
    evidenceGate: "An acoustic RFI is confirmed only from authoritative current-project FI/RFI document text with a retained excerpt and URL.",
    counts: {
      liveRfis: currentRecords.filter(isLive).length,
      liveConfirmedAcousticRfis: currentRecords.filter((record) => isLive(record) && confirmedAcoustic(record)).length,
      newRfis: newRfis.length,
      newlyConfirmedAcousticRfis: newlyConfirmedAcousticRfis.length,
      materiallyChangedRfis: materiallyChangedRfis.length,
      evidenceUnavailableRfis: evidenceUnavailableRfis.length,
      resolvedRfis: resolvedRfis.length,
      odooCreated: syncIsCurrent ? Number(odooSync?.created ?? 0) : 0,
      odooUpdated: syncIsCurrent ? Number(odooSync?.updated ?? 0) : 0,
      odooUnchanged: syncIsCurrent ? Number(odooSync?.unchanged ?? 0) : 0,
      odooFailures,
    },
    odoo: {
      currentRun: syncIsCurrent,
      status: syncIsCurrent ? String(odooSync?.status ?? "unknown") : "missing-or-stale",
      completedAt: syncCompletedAt || undefined,
      failures: syncIsCurrent && Array.isArray(odooSync?.failures) ? odooSync.failures : [],
    },
    changes: {
      newlyConfirmedAcousticRfis: sortItems(newlyConfirmedAcousticRfis),
      newRfis: sortItems(newRfis),
      materiallyChangedRfis: sortItems(materiallyChangedRfis),
      evidenceUnavailableRfis: sortItems(evidenceUnavailableRfis),
      resolvedRfis: sortItems(resolvedRfis),
    },
  };

  return report;
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function rfiChangeReportCsv(report: ReturnType<typeof buildRfiChangeReport>) {
  const rows: unknown[][] = [[
    "change_type", "record_id", "source", "source_record_id", "title", "county",
    "classification", "evidence_status", "evidence_excerpt", "document_url",
    "response_deadline", "first_seen_at", "last_seen_at", "routed_to", "change_reason",
  ]];
  for (const [changeType, items] of Object.entries(report.changes)) {
    for (const change of items) {
      rows.push([
        changeType, change.id, change.sourceSystem, change.sourceRecordId, change.title,
        change.county, change.classification, change.evidenceStatus, change.evidenceExcerpt,
        change.documentUrl, change.responseDeadline, change.firstSeenAt, change.lastSeenAt,
        change.routedTo, change.changeReason,
      ]);
    }
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function rfiChangeReportEmailHtml(report: ReturnType<typeof buildRfiChangeReport>) {
  const confirmed = report.changes.newlyConfirmedAcousticRfis;
  const list = confirmed.length
    ? `<ol>${confirmed.map((change) => `<li><strong>${escapeHtml(change.title)}</strong> (${escapeHtml(change.sourceSystem)})<br>${escapeHtml(change.evidenceExcerpt)}<br><a href="${escapeHtml(change.documentUrl)}">Official evidence</a></li>`).join("")}</ol>`
    : "<p>No newly document-confirmed acoustic RFIs were found in this run.</p>";
  return [
    "<h1>Helmonic daily RFI change report</h1>",
    `<p><strong>Run:</strong> ${escapeHtml(report.runId)}</p>`,
    `<p><strong>Live RFIs:</strong> ${report.counts.liveRfis} &nbsp; <strong>Confirmed acoustic:</strong> ${report.counts.liveConfirmedAcousticRfis}</p>`,
    `<p><strong>New RFIs:</strong> ${report.counts.newRfis} &nbsp; <strong>Newly acoustic-confirmed:</strong> ${report.counts.newlyConfirmedAcousticRfis} &nbsp; <strong>Materially changed:</strong> ${report.counts.materiallyChangedRfis}</p>`,
    `<p><strong>Evidence unavailable:</strong> ${report.counts.evidenceUnavailableRfis} &nbsp; <strong>Resolved:</strong> ${report.counts.resolvedRfis}</p>`,
    `<p><strong>Odoo:</strong> ${escapeHtml(report.odoo.status)} — ${report.counts.odooCreated} created, ${report.counts.odooUpdated} updated, ${report.counts.odooUnchanged} unchanged, ${report.counts.odooFailures} failed.</p>`,
    "<h2>Newly confirmed acoustic RFIs</h2>",
    list,
    `<p><small>${escapeHtml(report.evidenceGate)}</small></p>`,
  ].join("\n");
}
