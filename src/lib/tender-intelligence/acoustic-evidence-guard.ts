import {
  acousticCpvCodes,
  matchedAcousticTerms,
  normalizeText,
  relevantTenderText,
} from "./policy.ts";
import type { TenderOpportunity } from "./types.ts";

const rejectedClassifications = new Set([
  "needs-council-evidence",
  "no-relevant-opportunity",
]);

function currentEvidenceText(record: TenderOpportunity) {
  return normalizeText([
    record.evidenceExcerpt,
    ...(record.evidenceDocuments ?? []).flatMap((document) => [
      document.excerpt,
      ...(document.matchedTerms ?? []),
    ]),
  ].filter(Boolean).join(" "));
}

function hasCurrentEvidenceExcerpt(record: TenderOpportunity) {
  return Boolean(normalizeText(record.evidenceExcerpt)
    || (record.evidenceDocuments ?? []).some((document) =>
      document.fetchStatus === "fetched" && Boolean(normalizeText(document.excerpt))));
}

/**
 * The sole guard for treating a discovered record as a confirmed current
 * acoustic opportunity. Historical email evidence is deliberately excluded:
 * it proves a relationship, not that the present project needs acoustic work.
 */
export function hasConfirmedCurrentAcousticEvidence(record: TenderOpportunity) {
  if (record.evidenceStatus !== "official-text") return false;
  if (rejectedClassifications.has(record.classification ?? "")) return false;
  if (!hasCurrentEvidenceExcerpt(record)) return false;

  const evidenceText = currentEvidenceText(record);
  const acousticTerms = new Set([
    ...(record.matchedTerms ?? []),
    ...matchedAcousticTerms(evidenceText),
  ].map((term) => term.toLowerCase()));
  const hasAcousticWording = acousticTerms.size > 0 && relevantTenderText(evidenceText);
  if (!hasAcousticWording) return false;

  if (record.type === "formal-public-tender") {
    return record.cpvCodes.some((code) => acousticCpvCodes.includes(code as never));
  }

  return Boolean(record.classification);
}

export function acousticEvidenceGateLabel(record: TenderOpportunity) {
  return hasConfirmedCurrentAcousticEvidence(record)
    ? "Confirmed — official current-project acoustic evidence"
    : "Potential only — current-project acoustic evidence unconfirmed";
}
