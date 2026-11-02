import type { PlanningClassification, TenderOpportunity } from "./types.ts";

export const RFI_CLASSIFICATIONS: readonly PlanningClassification[] = [
  "noise-related-rfi",
  "further-information-request",
] as const;

export function isRfiClassification(classification?: string): boolean {
  return RFI_CLASSIFICATIONS.includes(classification as PlanningClassification);
}

export function isAcousticRfi(record: Pick<TenderOpportunity, "classification">): boolean {
  return record.classification === "noise-related-rfi";
}

export function isFurtherInformationStage(value?: string): boolean {
  return /(?:request(?:ed)?\s+(?:for\s+)?(?:further|additional)\s+info(?:rmation)?|(?:further|additional)\s+info(?:rmation)?\s+request(?:ed)?|\brfi\b)/i
    .test(value ?? "");
}

function validDate(value?: string) {
  if (!value) return undefined;
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const irish = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (irish) return new Date(Date.UTC(Number(irish[3]), Number(irish[2]) - 1, Number(irish[1])));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function addCalendarMonths(value: string, months: number): string | undefined {
  const parsed = validDate(value);
  if (!parsed) return undefined;
  const day = parsed.getUTCDate();
  const result = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + months, 1));
  const finalDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, finalDay));
  return result.toISOString().slice(0, 10);
}

export function rfiRequestedAt(record: TenderOpportunity): string | undefined {
  if (!isRfiClassification(record.classification)) return undefined;
  if (record.rfiReceivedAt) return record.rfiReceivedAt;
  if (record.rfiPublishedAt) return record.rfiPublishedAt;
  return (record.evidenceDocuments ?? [])
    .filter((document) => isRfiClassification(document.classification))
    .flatMap((document) => [document.receivedAt, document.rfiPublishedAt])
    .filter((value): value is string => Boolean(value) && Boolean(validDate(value)))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

export function rfiResponseDueAt(record: TenderOpportunity): string | undefined {
  if (!isRfiClassification(record.classification)) return undefined;
  // Preserve the deadline on answered/closed RFI history too. Queue status is
  // decided separately from date retention, so audit records never lose the
  // original response clock merely because a reply was received.
  return record.responseDeadline || (rfiRequestedAt(record) ? addCalendarMonths(rfiRequestedAt(record)!, 6) : undefined);
}

export function rfiEventIdentity(record: TenderOpportunity): string | undefined {
  if (!isRfiClassification(record.classification)) return undefined;
  const requested = rfiRequestedAt(record);
  if (requested) return `requested:${requested.slice(0, 10)}`;
  const evidenceId = (record.evidenceDocuments ?? [])
    .find((document) => isRfiClassification(document.classification))?.id;
  return evidenceId ? `document:${evidenceId}` : undefined;
}
