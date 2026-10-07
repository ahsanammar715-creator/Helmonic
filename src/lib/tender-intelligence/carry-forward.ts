import type { TenderOpportunity } from "./types.ts";

const confirmedPlanningClasses = new Set([
  "noise-related-rfi",
  "granted-with-noise-conditions",
  "refused-on-noise-grounds",
]);

const resolvedSourceStatuses = new Set([
  "awarded",
  "cancelled",
  "canceled",
  "closed",
  "completed",
  "resolved",
  "withdrawn",
]);

export function opportunityIdentity(record: Pick<TenderOpportunity, "sourceSystem" | "sourceRecordId">) {
  return `${record.sourceSystem}:${record.sourceRecordId}`.trim().toLowerCase();
}

export function isConfirmedOpportunity(record: TenderOpportunity) {
  if (record.cycleStatus === "resolved") return false;
  if (record.evidenceStatus !== "official-text") return false;
  const excerpt = String(record.evidenceExcerpt ?? "").trim();
  if (excerpt.length < 40 || !/\b(?:acoustic|noise|sound|vibration|reverberation|airborne|impact)\b/i.test(excerpt)) {
    return false;
  }
  if (record.type === "formal-public-tender") {
    return record.classification !== "no-relevant-opportunity";
  }
  return confirmedPlanningClasses.has(record.classification ?? "");
}

function parseDate(value: string | undefined) {
  if (!value) return undefined;
  const irish = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const timestamp = irish
    ? Date.UTC(Number(irish[3]), Number(irish[2]) - 1, Number(irish[1]), 23, 59, 59)
    : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function positiveResolution(record: TenderOpportunity, now = new Date()) {
  if (record.scopeStatus === "excluded" && record.scopeExclusionReason) {
    return `target-scope-${record.scopeExclusionReason}`;
  }
  const sourceStatus = record.sourceStatus?.trim().toLowerCase();
  if (sourceStatus && resolvedSourceStatuses.has(sourceStatus)) {
    return `source-status-${sourceStatus}`;
  }

  // A planning decision date is not an opportunity deadline. Only a formal
  // tender deadline or a stated RFI response deadline can close a record by
  // time alone.
  const deadline = record.type === "formal-public-tender"
    ? parseDate(record.deadline)
    : record.classification === "noise-related-rfi"
      ? parseDate(record.responseDeadline)
      : undefined;
  if (deadline !== undefined && deadline < now.getTime()) return "confirmed-deadline-expired";
  return undefined;
}

function preferPriorEvidence(current: TenderOpportunity, prior: TenderOpportunity) {
  return {
    ...current,
    evidenceStatus: prior.evidenceStatus,
    evidenceExcerpt: prior.evidenceExcerpt,
    evidenceDocuments: prior.evidenceDocuments,
    evidenceUnavailableReason: prior.evidenceUnavailableReason,
    classification: prior.classification,
    sourceUrl: prior.sourceUrl,
    matchedTerms: prior.matchedTerms,
    cpvCodes: prior.cpvCodes,
    fitScore: prior.fitScore,
    leadQuality: prior.leadQuality,
    leadDisposition: prior.leadDisposition,
    qualificationReason: prior.qualificationReason,
    leadFreshness: prior.leadFreshness,
    sourceAgeDays: prior.sourceAgeDays,
    freshnessReason: prior.freshnessReason,
    residentialUnitCount: prior.residentialUnitCount,
    residentialScale: prior.residentialScale,
    routedTo: prior.routedTo,
    routingStatus: prior.routingStatus,
    routingEvidence: prior.routingEvidence,
    routingReason: prior.routingReason,
  } satisfies TenderOpportunity;
}

function exactRelationshipRoute(record: TenderOpportunity) {
  return /^exact-party-match-supported-by-(?:glen|owen)-email-evidence$/i.test(record.routingReason ?? "");
}

function hasPreservableRoute(record: TenderOpportunity) {
  return record.routingStatus === "routed"
    && (record.routedTo === "Glen" || record.routedTo === "Owen")
    && Boolean(record.routingReason);
}

export function routingMetadataWithDurablePrecedence(
  durable: TenderOpportunity,
  legacy: TenderOpportunity,
) {
  const selected = hasPreservableRoute(durable) ? durable : legacy;
  return {
    routedTo: selected.routedTo ?? durable.routedTo,
    routingStatus: selected.routingStatus ?? durable.routingStatus,
    routingEvidence: selected.routingEvidence ?? durable.routingEvidence,
    routingReason: selected.routingReason ?? durable.routingReason,
  } satisfies Pick<
    TenderOpportunity,
    "routedTo" | "routingStatus" | "routingEvidence" | "routingReason"
  >;
}

export function mergeCurrentSnapshotWithLedger(input: {
  current: TenderOpportunity[];
  priorConfirmed: TenderOpportunity[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  const currentByIdentity = new Map(input.current.map((record) => [opportunityIdentity(record), record]));
  const merged = new Map<string, TenderOpportunity>();
  const processedPriorKeys = new Set<string>();

  for (const current of input.current) {
    const key = opportunityIdentity(current);
    const resolutionReason = positiveResolution(current, now);
    merged.set(key, {
      ...current,
      cycleStatus: resolutionReason
        ? "resolved"
        : isConfirmedOpportunity(current)
          ? "confirmed-this-cycle"
          : "seen-this-cycle",
      firstSeenAt: current.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
      lastConfirmedAt: isConfirmedOpportunity(current)
        ? timestamp
        : current.lastConfirmedAt,
      missingSince: undefined,
      carryForwardReason: undefined,
      resolvedAt: resolutionReason ? timestamp : undefined,
      resolutionReason,
    });
  }

  for (const prior of input.priorConfirmed) {
    if (!isConfirmedOpportunity(prior) && prior.cycleStatus !== "resolved") continue;
    const key = opportunityIdentity(prior);
    // The caller orders durable full records before any legacy audit migration
    // records. Never let a later, less detailed duplicate erase richer evidence.
    if (processedPriorKeys.has(key)) continue;
    processedPriorKeys.add(key);
    const current = currentByIdentity.get(key);
    const resolutionReason = positiveResolution(current ?? prior, now);

    if (resolutionReason) {
      merged.set(key, {
        ...(current ?? prior),
        cycleStatus: "resolved",
        firstSeenAt: prior.firstSeenAt ?? prior.lastConfirmedAt ?? timestamp,
        lastSeenAt: current ? timestamp : prior.lastSeenAt,
        lastConfirmedAt: prior.lastConfirmedAt ?? timestamp,
        missingSince: current ? undefined : prior.missingSince ?? timestamp,
        carryForwardReason: undefined,
        resolvedAt: timestamp,
        resolutionReason,
      });
      continue;
    }

    if (current && isConfirmedOpportunity(current)) {
      const currentMerged = merged.get(key)!;
      const preservePriorRoute = hasPreservableRoute(prior) && !exactRelationshipRoute(currentMerged);
      merged.set(key, {
        ...currentMerged,
        firstSeenAt: prior.firstSeenAt ?? prior.lastConfirmedAt ?? timestamp,
        ...(preservePriorRoute ? {
          routedTo: prior.routedTo,
          routingStatus: prior.routingStatus,
          routingEvidence: prior.routingEvidence,
          routingReason: prior.routingReason,
        } : {}),
      });
      continue;
    }

    const retained = current ? preferPriorEvidence(current, prior) : prior;
    merged.set(key, {
      ...retained,
      cycleStatus: "unconfirmed-this-cycle",
      firstSeenAt: prior.firstSeenAt ?? prior.lastConfirmedAt ?? timestamp,
      lastSeenAt: current ? timestamp : prior.lastSeenAt,
      lastConfirmedAt: prior.lastConfirmedAt ?? timestamp,
      missingSince: prior.missingSince ?? timestamp,
      carryForwardReason: current
        ? "current-cycle-did-not-reconfirm-authoritative-evidence"
        : "absent-from-current-discovery-window",
      resolvedAt: undefined,
      resolutionReason: undefined,
    });
  }

  return [...merged.values()];
}

export function applyEvidenceRefresh(
  previous: TenderOpportunity,
  refreshed: TenderOpportunity,
  now = new Date(),
) {
  const timestamp = now.toISOString();
  if (isConfirmedOpportunity(refreshed)) {
    return {
      ...refreshed,
      cycleStatus: "confirmed-this-cycle",
      firstSeenAt: previous.firstSeenAt ?? previous.lastConfirmedAt ?? timestamp,
      lastSeenAt: timestamp,
      lastConfirmedAt: timestamp,
      missingSince: undefined,
      carryForwardReason: undefined,
    } satisfies TenderOpportunity;
  }
  if (isConfirmedOpportunity(previous)) {
    return {
      ...previous,
      cycleStatus: "unconfirmed-this-cycle",
      lastSeenAt: timestamp,
      missingSince: previous.missingSince ?? timestamp,
      carryForwardReason: "current-cycle-did-not-reconfirm-authoritative-evidence",
      evidenceUnavailableReason: refreshed.evidenceUnavailableReason ?? previous.evidenceUnavailableReason,
    } satisfies TenderOpportunity;
  }
  return refreshed;
}

export function confirmedLedgerRecords(records: TenderOpportunity[]) {
  return records.filter((record) => isConfirmedOpportunity(record) || record.cycleStatus === "resolved");
}
