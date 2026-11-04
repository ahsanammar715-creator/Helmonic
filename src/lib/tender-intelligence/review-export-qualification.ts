import { hasConfirmedCurrentAcousticEvidence } from "./acoustic-evidence-guard.ts";
import { isSalesRouteable } from "./lead-qualification.ts";
import type { TenderOpportunity } from "./types.ts";

/**
 * Keep the review export in exact lockstep with the pipeline audit.
 *
 * A genuine Further Information Request is intentionally retained even when
 * the council does not publish readable acoustic wording. Every other record
 * still needs confirmed current-project acoustic evidence. The shared sales
 * routing guard then removes duplicate, closed, background and already-won
 * records from the working list without erasing them from the ledger.
 */
export function isQualifiedReviewRecord(record: TenderOpportunity) {
  const evidenceConfirmed = record.cycleStatus !== "resolved"
    && (record.classification === "further-information-request"
      || hasConfirmedCurrentAcousticEvidence(record));

  return evidenceConfirmed && isSalesRouteable(record);
}
