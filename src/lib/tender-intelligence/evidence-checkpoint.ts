import type { TenderOpportunity } from "./types";

export const NATIONAL_EVIDENCE_QUEUE_VERSION = "stable-source-record-v1";

export function evidenceRecordKey(record: TenderOpportunity) {
  return [record.sourceSystem, record.sourceRecordId, record.id]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .join("\u001f");
}

export function initializeEvidenceQueue(
  records: TenderOpportunity[],
  selectedIndexes: number[],
  existing: {
    version?: string;
    queue?: string[];
    processed?: number;
  } = {},
) {
  if (
    existing.version === NATIONAL_EVIDENCE_QUEUE_VERSION
    && Array.isArray(existing.queue)
    && existing.queue.every((key) => typeof key === "string" && key.length > 0)
  ) {
    return {
      queue: [...existing.queue],
      processed: Math.max(0, Math.min(existing.queue.length, existing.processed ?? 0)),
      initialized: false,
      legacyProgressReset: false,
    };
  }

  const seen = new Set<string>();
  const queue: string[] = [];
  for (const index of selectedIndexes) {
    const record = records[index];
    if (!record) continue;
    const key = evidenceRecordKey(record);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    queue.push(key);
  }

  return {
    queue,
    processed: 0,
    initialized: true,
    // An old numeric offset cannot safely be applied to the new stable queue:
    // evidence enrichment can change classifications and therefore reorder the
    // dynamically selected records. Re-reading a record is safe; skipping one
    // is not.
    legacyProgressReset: (existing.processed ?? 0) > 0,
  };
}

export function resolveEvidenceBatch(
  records: TenderOpportunity[],
  queue: string[],
  offset: number,
  batchSize: number,
) {
  const indexByKey = new Map<string, number>();
  records.forEach((record, index) => {
    const key = evidenceRecordKey(record);
    if (!indexByKey.has(key)) indexByKey.set(key, index);
  });

  const start = Math.max(0, Math.min(queue.length, offset));
  const keys = queue.slice(start, start + Math.max(1, batchSize));
  const missingKeys: string[] = [];
  const indexes: number[] = [];
  for (const key of keys) {
    const index = indexByKey.get(key);
    if (index === undefined) missingKeys.push(key);
    else indexes.push(index);
  }

  return {
    keys,
    indexes,
    missingKeys,
    nextOffset: start + keys.length,
    total: queue.length,
  };
}
