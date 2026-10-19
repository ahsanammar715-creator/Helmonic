import { createHash } from "node:crypto";

import { normalizeText } from "./policy.ts";
import type { DuplicateSourceReference, TenderOpportunity } from "./types.ts";

function compact(value: string | undefined) {
  return normalizeText(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function authorityKey(value: string | undefined) {
  const normalized = normalizeText(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:county|city)\s+council\b/g, "")
    .replace(/\bplanning\s+authority\b/g, "")
    .replace(/\bcouncil\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  if (normalized === "dcc") return "dublin";
  return normalized;
}

function referenceKey(record: TenderOpportunity) {
  return compact(record.projectReference || record.sourceRecordId.split(":").at(-1));
}

function strictIdentity(record: TenderOpportunity) {
  if (record.type === "planning-pipeline-lead") {
    const authority = authorityKey(record.planningAuthority);
    const reference = referenceKey(record);
    return authority && reference ? `planning:${authority}:${reference}` : undefined;
  }
  // TED and eTenders identifiers are not interchangeable. Formal notices are
  // merged only within their own source identity unless a future adapter
  // supplies an explicit cross-publication identifier.
  const reference = compact(record.sourceRecordId);
  return reference ? `tender:${compact(record.sourceSystem)}:${reference}` : undefined;
}

function addressIdentity(record: TenderOpportunity) {
  if (record.type !== "planning-pipeline-lead") return undefined;
  const authority = authorityKey(record.planningAuthority);
  const address = compact(record.location || record.title);
  if (!authority || address.length < 15) return undefined;
  return `address:${authority}:${address}`;
}

function groupId(key: string) {
  return createHash("sha256").update(key).digest("hex").slice(0, 20);
}

function canonicalScore(record: TenderOpportunity) {
  const evidence = record.evidenceStatus === "official-text" ? 300
    : record.evidenceStatus === "evidence-unavailable" ? 150 : 0;
  const source = record.sourceSystem === "DCC" || record.sourceSystem === "National Planning Register" ? 80
    : record.sourceSystem === "TED" || record.sourceSystem === "eTenders" ? 60 : 0;
  const detail = (record.evidenceExcerpt ? 30 : 0)
    + ((record.evidenceDocuments?.length ?? 0) > 0 ? 20 : 0)
    + (record.parties?.length ?? 0);
  const lifecycle = record.cycleStatus === "resolved" ? -100 : 0;
  return evidence + source + detail + lifecycle;
}

function selectCanonical(records: TenderOpportunity[]) {
  return [...records].sort((left, right) => canonicalScore(right) - canonicalScore(left)
    || left.id.localeCompare(right.id))[0];
}

function sourceReference(record: TenderOpportunity): DuplicateSourceReference {
  return {
    id: record.id,
    sourceSystem: record.sourceSystem,
    sourceRecordId: record.sourceRecordId,
    sourceUrl: record.sourceUrl,
    evidenceStatus: record.evidenceStatus,
    observationFiles: record.sourceObservationFiles,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    observedAt: record.sourceUpdatedAt ?? record.sourceMajorUpdatedAt ?? record.publishedAt,
    documentUrls: [...new Set((record.evidenceDocuments ?? []).map((document) => document.sourceUrl).filter(Boolean))],
    documentNames: [...new Set((record.evidenceDocuments ?? []).map((document) => document.description ?? document.documentType).filter(Boolean))],
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
  };
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function earliest(values: Array<string | undefined>) {
  return uniqueStrings(values).sort((left, right) => Date.parse(left) - Date.parse(right))[0];
}

function latest(values: Array<string | undefined>) {
  return uniqueStrings(values).sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function mergedCanonicalRecord(canonical: TenderOpportunity, group: TenderOpportunity[]) {
  const documents = new Map<string, NonNullable<TenderOpportunity["evidenceDocuments"]>[number]>();
  const parties = new Map<string, NonNullable<TenderOpportunity["parties"]>[number]>();
  for (const record of group) {
    for (const document of record.evidenceDocuments ?? []) {
      documents.set(`${document.id}|${document.sourceUrl}`, document);
    }
    for (const party of record.parties ?? []) {
      const key = [party.role, party.name, party.organisation, party.email, party.phone]
        .map((value) => compact(value)).join("|");
      parties.set(key, party);
    }
  }
  const dateConfidence = group.some((record) => record.rfiDateConfidence === "exact") ? "exact"
    : group.some((record) => record.rfiDateConfidence === "derived") ? "derived" : "unavailable";
  return {
    ...canonical,
    evidenceStatus: group.some((record) => record.evidenceStatus === "official-text")
      ? "official-text" : canonical.evidenceStatus,
    evidenceExcerpt: uniqueStrings(group.map((record) => record.evidenceExcerpt)).join("\n\n") || canonical.evidenceExcerpt,
    evidenceDocuments: [...documents.values()],
    parties: [...parties.values()],
    matchedTerms: uniqueStrings(group.flatMap((record) => record.matchedTerms)),
    cpvCodes: uniqueStrings(group.flatMap((record) => record.cpvCodes)),
    firstSeenAt: earliest(group.map((record) => record.firstSeenAt)),
    lastSeenAt: latest(group.map((record) => record.lastSeenAt)),
    lastConfirmedAt: latest(group.map((record) => record.lastConfirmedAt)),
    rfiPublishedAt: latest(group.map((record) => record.rfiPublishedAt)),
    rfiReceivedAt: latest(group.map((record) => record.rfiReceivedAt)),
    rfiResponseReceivedAt: latest(group.map((record) => record.rfiResponseReceivedAt)),
    responseDeadline: earliest(group.map((record) => record.responseDeadline)),
    planningReceivedAt: earliest(group.map((record) => record.planningReceivedAt)),
    planningValidatedAt: earliest(group.map((record) => record.planningValidatedAt)),
    rfiDateSource: uniqueStrings(group.map((record) => record.rfiDateSource)).join("; ") || undefined,
    rfiDateConfidence: dateConfidence,
    sourceObservationFiles: uniqueStrings(group.flatMap((record) => record.sourceObservationFiles ?? [])),
  } satisfies TenderOpportunity;
}

export function annotateOpportunityDuplicates(records: TenderOpportunity[]) {
  const strictGroups = new Map<string, TenderOpportunity[]>();
  for (const record of records) {
    const key = strictIdentity(record);
    if (!key) continue;
    strictGroups.set(key, [...(strictGroups.get(key) ?? []), record]);
  }

  const annotated = new Map<string, TenderOpportunity>();
  for (const record of records) {
    const ownKey = strictIdentity(record) ?? `record:${record.sourceSystem}:${record.sourceRecordId}`;
    const ownGroupId = groupId(ownKey);
    annotated.set(record.id, {
      ...record,
      deduplicationStatus: "unique",
      deduplicationGroupId: ownGroupId,
      canonicalOpportunityId: record.id,
      crmExternalId: `helmonic-lead:${ownGroupId}`,
      deduplicationReason: "No strict duplicate identity found.",
      duplicateSources: [sourceReference(record)],
      possibleDuplicateIds: [],
    });
  }

  for (const [key, group] of strictGroups) {
    if (group.length < 2) continue;
    const canonical = selectCanonical(group);
    const mergedCanonical = mergedCanonicalRecord(canonical, group);
    const id = groupId(key);
    const sources = group.map(sourceReference)
      .sort((left, right) => left.sourceSystem.localeCompare(right.sourceSystem)
        || left.sourceRecordId.localeCompare(right.sourceRecordId));
    for (const record of group) {
      annotated.set(record.id, {
        ...(record.id === canonical.id ? mergedCanonical : annotated.get(record.id)!),
        deduplicationStatus: record.id === canonical.id ? "canonical" : "duplicate",
        deduplicationGroupId: id,
        canonicalOpportunityId: canonical.id,
        crmExternalId: `helmonic-lead:${id}`,
        deduplicationReason: "Exact planning-authority and project-reference identity matched across retained source records.",
        duplicateSources: sources,
      });
    }
  }

  const addressGroups = new Map<string, TenderOpportunity[]>();
  for (const record of records) {
    const key = addressIdentity(record);
    if (!key) continue;
    addressGroups.set(key, [...(addressGroups.get(key) ?? []), record]);
  }
  for (const group of addressGroups.values()) {
    const distinctReferences = new Set(group.map(referenceKey).filter(Boolean));
    if (group.length < 2 || distinctReferences.size < 2) continue;
    const ids = group.map((record) => record.id).sort();
    for (const record of group) {
      const existing = annotated.get(record.id)!;
      if (existing.deduplicationStatus !== "unique") continue;
      annotated.set(record.id, {
        ...existing,
        deduplicationStatus: "possible-duplicate",
        deduplicationReason: "Same normalized authority and address, but a different project reference; retained separately pending explicit linkage.",
        possibleDuplicateIds: ids.filter((id) => id !== record.id),
      });
    }
  }

  return records.map((record) => annotated.get(record.id)!);
}

export function deduplicationSummary(records: TenderOpportunity[]) {
  const canonicalGroups = new Set(records
    .filter((record) => record.deduplicationStatus === "canonical")
    .map((record) => record.deduplicationGroupId));
  return {
    retainedRecords: records.length,
    uniqueRecords: records.filter((record) => record.deduplicationStatus === "unique").length,
    canonicalGroups: canonicalGroups.size,
    duplicateSourceRecords: records.filter((record) => record.deduplicationStatus === "duplicate").length,
    possibleDuplicateRecords: records.filter((record) => record.deduplicationStatus === "possible-duplicate").length,
    crmOpportunityKeys: new Set(records
      .filter((record) => record.deduplicationStatus !== "duplicate")
      .map((record) => record.crmExternalId)
      .filter(Boolean)).size,
  };
}
