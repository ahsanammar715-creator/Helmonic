import { isQualifiedReviewRecord } from "./review-export-qualification.ts";
import type { TenderOpportunity } from "./types.ts";

type OpportunityDocument = {
  opportunities?: TenderOpportunity[];
};

type AuditDocument = {
  totals?: {
    qualifiedWorkingList?: number;
  };
};

function opportunities(document: OpportunityDocument | TenderOpportunity[], label: string) {
  const records = Array.isArray(document) ? document : document?.opportunities;
  if (!Array.isArray(records)) throw new Error(`${label} does not contain an opportunities array.`);
  return records;
}

function uniqueBy<T>(values: T[], key: (value: T) => string) {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}

function recordRank(record: TenderOpportunity) {
  const live = record.cycleStatus === "resolved" ? 0 : 1_000_000_000_000_000;
  const canonical = record.deduplicationStatus === "canonical" ? 100_000_000_000_000 : 0;
  const evidence = record.evidenceStatus === "official-text" ? 10_000_000_000_000 : 0;
  const observed = Date.parse(record.lastSeenAt ?? record.lastConfirmedAt ?? record.sourceUpdatedAt ?? "");
  return live + canonical + evidence + (Number.isFinite(observed) ? observed : 0);
}

/**
 * A durable ledger can retain an older row and its newer canonical successor.
 * If both carry the same stable CRM identity, Odoo must receive one payload,
 * while every source, evidence document and contact stays attached to it.
 */
export function coalesceOdooRecords(records: TenderOpportunity[]) {
  const groups = new Map<string, TenderOpportunity[]>();
  for (const record of records) {
    const identity = record.crmExternalId;
    if (!identity) throw new Error(`Record ${record.id} has no stable CRM external ID.`);
    groups.set(identity, [...(groups.get(identity) ?? []), record]);
  }

  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const canonical = [...group].sort((left, right) => recordRank(right) - recordRank(left)
      || left.id.localeCompare(right.id))[0];
    const duplicateSources = uniqueBy(group.flatMap((record) => record.duplicateSources?.length
      ? record.duplicateSources
      : [{
          id: record.id,
          sourceSystem: record.sourceSystem,
          sourceRecordId: record.sourceRecordId,
          sourceUrl: record.sourceUrl,
          evidenceStatus: record.evidenceStatus,
          observationFiles: record.sourceObservationFiles,
          firstSeenAt: record.firstSeenAt,
          lastSeenAt: record.lastSeenAt,
          observedAt: record.sourceUpdatedAt ?? record.sourceMajorUpdatedAt ?? record.publishedAt,
          documentUrls: (record.evidenceDocuments ?? []).map((document) => document.sourceUrl),
          documentNames: (record.evidenceDocuments ?? []).map((document) => document.description ?? document.documentType),
          evidenceExcerpt: record.evidenceExcerpt,
          parties: record.parties,
          rfiPublishedAt: record.rfiPublishedAt,
          rfiReceivedAt: record.rfiReceivedAt,
          rfiResponseDueAt: record.responseDeadline,
          rfiResponseReceivedAt: record.rfiResponseReceivedAt,
          planningReceivedAt: record.planningReceivedAt,
          planningValidatedAt: record.planningValidatedAt,
          planningDecisionDueAt: record.type === "planning-pipeline-lead" ? record.deadline : undefined,
          matchedTerms: record.matchedTerms,
          classification: record.classification,
        }]),
      (source) => `${source.sourceSystem}|${source.sourceRecordId}|${source.sourceUrl}`);
    const evidenceDocuments = uniqueBy(group.flatMap((record) => record.evidenceDocuments ?? []),
      (document) => `${document.id}|${document.sourceUrl}`);
    const parties = uniqueBy(group.flatMap((record) => record.parties ?? []),
      (party) => [party.role, party.name, party.organisation, party.email, party.phone].join("|").toLowerCase());
    const routingEvidence = uniqueBy(group.flatMap((record) => record.routingEvidence ?? []),
      (evidence) => `${evidence.party}|${evidence.matchedEntity}|${evidence.evidenceRefs.join("|")}`);
    return {
      ...canonical,
      deduplicationStatus: "canonical" as const,
      deduplicationReason: "Historical and current ledger rows shared one stable CRM identity; coalesced before Odoo sync.",
      duplicateSources,
      evidenceDocuments,
      parties,
      routingEvidence,
      matchedTerms: [...new Set(group.flatMap((record) => record.matchedTerms))],
      cpvCodes: [...new Set(group.flatMap((record) => record.cpvCodes))],
      sourceObservationFiles: [...new Set(group.flatMap((record) => record.sourceObservationFiles ?? []))],
      possibleDuplicateIds: [...new Set(group.flatMap((record) => record.possibleDuplicateIds ?? []))],
    } satisfies TenderOpportunity;
  });
}

/**
 * A controlled completed-ledger sync deliberately ignores a newer partial
 * discovery state. The ledger and its matching audit were written atomically
 * after the full document pass completed, so they are the durable source for
 * the final Odoo refresh.
 */
export function recordsForOdooSync({
  state,
  ledger,
  audit,
  useCompletedLedger,
}: {
  state: OpportunityDocument | TenderOpportunity[];
  ledger?: OpportunityDocument | TenderOpportunity[];
  audit?: AuditDocument;
  useCompletedLedger: boolean;
}) {
  if (!useCompletedLedger) return coalesceOdooRecords(opportunities(state, "Pipeline state"));
  if (!ledger) throw new Error("Completed-ledger Odoo sync was requested but the confirmed ledger is missing.");

  const records = opportunities(ledger, "Confirmed ledger");
  const auditCount = audit?.totals?.qualifiedWorkingList;
  if (!Number.isFinite(auditCount)) {
    throw new Error("Completed-ledger Odoo sync was requested but the completed audit count is missing.");
  }

  const ledgerCount = records.filter(isQualifiedReviewRecord).length;
  if (ledgerCount !== auditCount) {
    throw new Error(`Completed-ledger Odoo sync refused: ledger has ${ledgerCount} qualified records; audit reports ${auditCount}.`);
  }

  return coalesceOdooRecords(records);
}
