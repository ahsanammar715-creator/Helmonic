type JsonObject = Record<string, any>;

function validDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function freshSince(value: unknown, startedAt: Date) {
  const parsed = validDate(value);
  return Boolean(parsed && parsed.getTime() >= startedAt.getTime());
}

function count(value: unknown) {
  return Number.isFinite(value) ? Number(value) : 0;
}

function liveRecord(record: JsonObject) {
  return record.cycleStatus !== "resolved" && record.leadDisposition !== "background";
}

function sourceName(source: JsonObject, index: number) {
  return source.sourceSystem ?? source.name ?? source.source ?? `source-${index + 1}`;
}

export function buildTenderAutomationHealth({
  workerSummary,
  audit,
  rfiAudit,
  odooSync,
  state,
  completedAt = new Date(),
}: {
  workerSummary: JsonObject;
  audit?: JsonObject;
  rfiAudit?: JsonObject;
  odooSync?: JsonObject;
  state?: JsonObject;
  completedAt?: Date;
}) {
  const startedAt = validDate(workerSummary.startedAt) ?? completedAt;
  const opportunities = Array.isArray(state?.opportunities) ? state.opportunities : [];
  const newlyDetected = opportunities.filter((record: JsonObject) =>
    liveRecord(record) && freshSince(record.firstSeenAt, startedAt)).length;
  const materiallyUpdated = opportunities.filter((record: JsonObject) =>
    liveRecord(record)
    && !freshSince(record.firstSeenAt, startedAt)
    && [record.sourceMajorUpdatedAt, record.sourceUpdatedAt, record.lastConfirmedAt]
      .some((value) => freshSince(value, startedAt))).length;

  const auditFresh = freshSince(audit?.completedAt, startedAt);
  const rfiAuditFresh = freshSince(rfiAudit?.auditGeneratedAt, startedAt);
  const odooEnabled = workerSummary.odooSyncEnabled === true;
  const odooFresh = !odooEnabled || freshSince(odooSync?.completedAt, startedAt);
  const odooCompleted = !odooEnabled || odooSync?.status === "completed";
  const odooFailures = Array.isArray(odooSync?.failures) ? odooSync.failures.length : 0;
  const sourceRows = Array.isArray(audit?.sources) ? audit.sources : [];
  const sourceFailures = sourceRows.filter((source: JsonObject) =>
    Boolean(source?.fetchError)
    || /fail|error|timeout|unauthor|rate.?limit/i.test(String(source?.fetchStatus ?? "")));
  const workerCompleted = workerSummary.status === "completed";
  const criticalChecksPassed = workerCompleted
    && auditFresh
    && rfiAuditFresh
    && odooFresh
    && odooCompleted
    && odooFailures === 0
    && sourceFailures.length === 0;
  const status = workerSummary.status === "failed"
    ? "failed"
    : criticalChecksPassed
      ? odooEnabled ? "healthy" : "healthy-no-odoo-write"
      : "degraded";
  const localCompletion = new Intl.DateTimeFormat("en-IE", {
    timeZone: "Europe/Dublin",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(completedAt);
  const confirmedAcousticRfis = count(rfiAudit?.acousticFinding?.liveAcousticallyConfirmedRfis);
  const liveGeneralRfis = count(rfiAudit?.acousticFinding?.liveGeneralRfisWithoutConfirmedAcousticWording);
  const evidenceUnavailable = count(audit?.totals?.evidenceUnavailable);
  const odooCreated = count(odooSync?.created);
  const odooUpdated = count(odooSync?.updated);

  return {
    schemaVersion: 1,
    status,
    healthy: status === "healthy" || status === "healthy-no-odoo-write",
    runId: workerSummary.runId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    completedAtDublin: localCompletion,
    durationSeconds: Math.max(0, Math.round((completedAt.getTime() - startedAt.getTime()) / 1_000)),
    schedule: {
      intendedRun: "07:00 UTC",
      timeZone: "UTC",
      reviewOrdering: "new document-confirmed acoustic RFIs first, then other live RFIs, then remaining qualified leads",
    },
    checks: {
      workerCompleted,
      authoritativeAuditFresh: auditFresh,
      rfiDocumentAuditFresh: rfiAuditFresh,
      odooSyncEnabled: odooEnabled,
      odooSyncFresh: odooFresh,
      odooSyncCompleted: odooCompleted,
      noOdooFailures: odooFailures === 0,
      noSourceFailures: sourceFailures.length === 0,
      evidenceGate: "Authoritative FI/RFI text and retained excerpt required for acoustic confirmation",
    },
    counts: {
      sourcesChecked: sourceRows.filter((source: JsonObject) => source?.fetchStatus !== "not-configured").length,
      sourceFailures: sourceFailures.length,
      retainedLeadInventory: count(audit?.totals?.retainedLeadInventory ?? audit?.totals?.candidates),
      newlyDetected,
      materiallyUpdated,
      officialDocumentsInspected: count(audit?.totals?.officialDocumentsInspected),
      qualifiedWorkingList: count(audit?.totals?.qualifiedWorkingList),
      liveRfis: count(rfiAudit?.rfiStatus?.live),
      liveConfirmedAcousticRfis: confirmedAcousticRfis,
      liveGeneralRfis,
      evidenceUnavailable,
      duplicateSourceRecords: count(audit?.totals?.duplicateSourceRecords),
      possibleDuplicateRecords: count(audit?.totals?.possibleDuplicateRecords),
      odooAttempted: count(odooSync?.attempted),
      odooCreated,
      odooUpdated,
      odooUnchanged: count(odooSync?.unchanged),
      odooFailures,
    },
    sources: sourceRows.length
      ? sourceRows.map((source: JsonObject, index: number) => ({
          name: sourceName(source, index),
          fetchStatus: source?.fetchStatus ?? "unknown",
          fetchError: source?.fetchError,
          candidates: count(source?.totalCandidates ?? source?.candidates),
          officialDocumentsInspected: count(source?.officialDocumentsInspected),
          qualifiedWorkingList: count(source?.qualifiedWorkingList),
          evidenceUnavailable: count(source?.evidenceUnavailable),
        }))
      : [],
    failure: workerSummary.status === "failed"
      ? { failedStep: workerSummary.failedStep, error: workerSummary.error }
      : undefined,
    message: status === "healthy"
      ? `Tender Intelligence completed at ${localCompletion}: ${confirmedAcousticRfis} live confirmed acoustic RFI(s), ${newlyDetected} newly detected lead(s), ${materiallyUpdated} materially updated lead(s), ${odooCreated} created in Odoo, ${odooUpdated} updated, ${evidenceUnavailable} evidence-unavailable.`
      : status === "healthy-no-odoo-write"
        ? `Tender Intelligence completed at ${localCompletion} without Odoo writes: ${confirmedAcousticRfis} live confirmed acoustic RFI(s), ${newlyDetected} newly detected lead(s), ${evidenceUnavailable} evidence-unavailable.`
        : `Tender Intelligence ${status} at ${localCompletion}; inspect checks and failure before relying on the lead list.`,
  };
}
