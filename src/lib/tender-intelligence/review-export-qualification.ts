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

function parsedTime(value?: string) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : false;
}

function isOpenRfi(record: TenderOpportunity, now: Date) {
  if (!["noise-related-rfi", "further-information-request"].includes(record.classification ?? "")) return false;
  if (record.cycleStatus === "resolved" || record.rfiResponseReceivedAt) return false;
  const due = parsedTime(record.responseDeadline);
  return due === false || due >= now.getTime();
}

/**
 * The presentation order used by every human-facing lead list.
 *
 * Document-confirmed, still-open acoustic RFIs must always lead. General live
 * RFIs remain visible immediately behind them, but cannot outrank them merely
 * because they have a better commercial-quality or freshness label.
 */
export function reviewLeadPriorityTier(record: TenderOpportunity, now = new Date()) {
  if (isOpenRfi(record, now)
    && record.classification === "noise-related-rfi"
    && hasConfirmedCurrentAcousticEvidence(record)) return 0;
  if (isOpenRfi(record, now)) return 1;
  if (record.classification === "granted-with-noise-conditions"
    && hasConfirmedCurrentAcousticEvidence(record)) return 2;
  if (record.classification === "refused-on-noise-grounds"
    && hasConfirmedCurrentAcousticEvidence(record)) return 3;
  if (record.type === "formal-public-tender"
    && hasConfirmedCurrentAcousticEvidence(record)) return 4;
  return 5;
}

export function compareReviewLeadPriority(
  left: TenderOpportunity,
  right: TenderOpportunity,
  now = new Date(),
) {
  const tierDifference = reviewLeadPriorityTier(left, now) - reviewLeadPriorityTier(right, now);
  if (tierDifference !== 0) return tierDifference;

  const leftDue = parsedTime(left.responseDeadline);
  const rightDue = parsedTime(right.responseDeadline);
  if (leftDue !== false || rightDue !== false) {
    if (leftDue === false) return 1;
    if (rightDue === false) return -1;
    if (leftDue !== rightDue) return leftDue - rightDue;
  }

  const leftActivity = parsedTime(left.rfiReceivedAt ?? left.rfiPublishedAt ?? left.publishedAt);
  const rightActivity = parsedTime(right.rfiReceivedAt ?? right.rfiPublishedAt ?? right.publishedAt);
  if (leftActivity !== false || rightActivity !== false) {
    if (leftActivity === false) return 1;
    if (rightActivity === false) return -1;
    if (leftActivity !== rightActivity) return rightActivity - leftActivity;
  }

  return left.sourceSystem.localeCompare(right.sourceSystem)
    || left.sourceRecordId.localeCompare(right.sourceRecordId);
}
