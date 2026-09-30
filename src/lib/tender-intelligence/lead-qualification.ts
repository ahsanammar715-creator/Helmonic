import { normalizeText } from "./policy.ts";
import type {
  LeadDisposition,
  LeadFreshness,
  LeadQuality,
  ResidentialScale,
  TenderOpportunity,
} from "./types.ts";

const closedStatuses = new Set([
  "awarded",
  "cancelled",
  "canceled",
  "closed",
  "completed",
  "resolved",
  "withdrawn",
  "expired",
]);

const highIntentPatterns = [
  /\b(?:suitably\s+qualified\s+)?(?:acoustic(?:s)?\s+consultant|acoustician)\b/i,
  /\b(?:noise|acoustic|vibration)\s+(?:impact\s+)?assessment\b/i,
  /\b(?:noise|acoustic|vibration)\s+(?:assessment\s+)?report\b/i,
  /\b(?:acoustic|sound)\s+(?:testing|commissioning|validation)\b/i,
  /\b(?:noise|sound)\s+(?:limit|limits|criterion|criteria)\b/i,
  /\b(?:laeq|la90|lamax|db\s*\(?a\)?|sound\s+power)\b/i,
  /\b(?:daytime|night[ -]?time)\s+(?:noise|sound|limit|criterion|criteria)\b/i,
];

const genericNoisePatterns = [
  /\bair\s+quality\s+(?:and|&)\s+noise\b/i,
  /\bnoise\s+(?:and|&)\s+air\s+quality\b/i,
  /\bnoise\s+(?:and|&)\s+air\s+pollution\s+section\b/i,
  /\bnoise\s+management\s+measures?\b/i,
  /\bcode(?:s)?\s+of\s+practice\b/i,
];

const residentialPatterns = [
  /\bresidential\b/i,
  /\b(?:apartment|dwelling|house|home|duplex|townhouse)s?\b/i,
  /\blarge\s+residential\s+development\b/i,
  /\b(?:WEB)?LRD(?:\b|\d)/i,
];

const attachedPatterns = [
  /\bapartment(?:s)?\b/i,
  /\bduplex(?:es)?\b/i,
  /\bterraced?\b/i,
  /\btownhouse(?:s)?\b/i,
  /\battached\b/i,
  /\bmulti[ -]?unit\b/i,
  /\b(?:residential|apartment)\s+block(?:s)?\b/i,
];

const smallResidentialPatterns = [
  /\bone[ -]?off\s+(?:house|home|dwelling)\b/i,
  /\bsingle\s+(?:house|home|dwelling)\b/i,
  /\b(?:domestic|residential)\s+extension\b/i,
  /\bextension\s+to\s+(?:a\s+|the\s+)?(?:house|home|dwelling|residence)\b/i,
  /\bgarage\s+conversion\b/i,
];

const longerTermSectorPatterns = [
  /\bhotel\b/i,
  /\bhospital\b/i,
  /\bhealthcare\b/i,
  /\bdata\s+cent(?:re|er)\b/i,
  /\bschool\b/i,
  /\buniversity\b/i,
  /\bindustrial\b/i,
  /\bmixed[ -]?use\b/i,
  /\btransport\b/i,
  /\binfrastructure\b/i,
];

function recordText(record: TenderOpportunity) {
  return normalizeText([
    record.title,
    record.description,
    record.sourceRecordId,
    record.projectReference,
    record.evidenceExcerpt,
    record.applicant,
    record.location,
    ...(record.evidenceDocuments ?? []).flatMap((document) => [
      document.description,
      document.excerpt,
    ]),
  ].filter(Boolean).join("\n"));
}

export function residentialUnitCount(text: string) {
  const counts = [...text.matchAll(/\b(\d{1,4})\s*(?:no\.?\s*)?(?:(?:new|residential|attached|detached|semi[ -]?detached|terraced|one[ -]?bed|two[ -]?bed|three[ -]?bed)\s+){0,3}(?:units?|apartments?|dwellings?|houses?|homes?|duplex(?:es)?)\b/gi)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter(Number.isFinite);
  return counts.length > 0 ? Math.max(...counts) : undefined;
}

function commercialResult(
  quality: LeadQuality,
  disposition: LeadDisposition,
  reason: string,
  scale: ResidentialScale,
  count?: number,
) {
  return { quality, disposition, reason, scale, count };
}

export function assessLeadQuality(record: TenderOpportunity) {
  const text = recordText(record);
  const status = record.sourceStatus?.trim().toLowerCase();
  const count = residentialUnitCount(text);
  const isResidential = residentialPatterns.some((pattern) => pattern.test(text));
  const isLrd = /\blarge\s+residential\s+development\b/i.test(text) || /\b(?:WEB)?LRD(?:\b|\d)/i.test(text) || (count ?? 0) >= 100;
  const isAttached = attachedPatterns.some((pattern) => pattern.test(text));
  const isSmallResidential = smallResidentialPatterns.some((pattern) => pattern.test(text))
    || (isResidential && count !== undefined && count < 4);
  const hasHighIntent = highIntentPatterns.some((pattern) => pattern.test(text));
  const hasGenericNoiseOnly = genericNoisePatterns.some((pattern) => pattern.test(text)) && !hasHighIntent;
  const isConfirmed = record.evidenceStatus === "official-text";

  if (record.cycleStatus === "resolved" || (status && closedStatuses.has(status))) {
    return commercialResult(
      "closed-background",
      "background",
      "Source status or confirmed lifecycle state shows this record is closed; retained for history and relationship context.",
      isResidential ? (isSmallResidential ? "small-residential" : "multi-unit-unconfirmed-attachment") : "not-residential",
      count,
    );
  }

  if (isConfirmed && record.classification === "noise-related-rfi") {
    return commercialResult(
      "excellent",
      "active",
      "Official RFI evidence contains an acoustic requirement; this is an immediate, time-sensitive opportunity.",
      isLrd ? "lrd-100-plus" : isAttached && (count ?? 0) >= 4 ? "attached-4-plus" : isResidential ? "multi-unit-unconfirmed-attachment" : "not-residential",
      count,
    );
  }

  if (isConfirmed && record.type === "formal-public-tender" && record.classification !== "no-relevant-opportunity") {
    return commercialResult(
      "excellent",
      "active",
      "The authoritative tender document contains an approved acoustic CPV code and acoustic wording.",
      isResidential ? (isLrd ? "lrd-100-plus" : isAttached && (count ?? 0) >= 4 ? "attached-4-plus" : "multi-unit-unconfirmed-attachment") : "not-residential",
      count,
    );
  }

  if (isConfirmed && ["granted-with-noise-conditions", "refused-on-noise-grounds"].includes(record.classification ?? "")) {
    if (hasHighIntent) {
      return commercialResult(
        "excellent",
        "active",
        "Official planning evidence includes a specific acoustic consultant, assessment, testing or measurable noise requirement.",
        isLrd ? "lrd-100-plus" : isAttached && (count ?? 0) >= 4 ? "attached-4-plus" : isResidential ? "multi-unit-unconfirmed-attachment" : "not-residential",
        count,
      );
    }
    if (hasGenericNoiseOnly) {
      return commercialResult(
        "medium",
        "monitor",
        "Official evidence contains only broad air-quality/noise, section-consultation or general compliance wording; retained but weighted below a specific acoustic requirement.",
        isLrd ? "lrd-100-plus" : isAttached && (count ?? 0) >= 4 ? "attached-4-plus" : isResidential ? "multi-unit-unconfirmed-attachment" : "not-residential",
        count,
      );
    }
    return commercialResult(
      "good",
      "active",
      "Official planning evidence confirms a noise-related condition or refusal ground, but no high-intent acoustic instruction was identified.",
      isLrd ? "lrd-100-plus" : isAttached && (count ?? 0) >= 4 ? "attached-4-plus" : isResidential ? "multi-unit-unconfirmed-attachment" : "not-residential",
      count,
    );
  }

  if (isLrd) {
    return commercialResult(
      "excellent",
      "nurture",
      "Large Residential Development or residential scheme of at least 100 units; Eoghan identified this as the ideal residential scale.",
      "lrd-100-plus",
      count,
    );
  }

  if (isResidential && isAttached && (count ?? 0) >= 4) {
    return commercialResult(
      "good",
      "nurture",
      "Attached residential scheme of at least four units; commercially relevant because Part E compliance is expected.",
      "attached-4-plus",
      count,
    );
  }

  if (isSmallResidential) {
    return commercialResult(
      "poor",
      "background",
      "One-off house, residential extension or residential scheme below four units; retained but not a priority under Eoghan's residential rule.",
      "small-residential",
      count,
    );
  }

  if (isResidential) {
    return commercialResult(
      "medium",
      "monitor",
      count !== undefined && count >= 4
        ? "Residential scheme has at least four units, but the available data does not yet establish that the units are attached."
        : "Residential opportunity retained, but unit count or attachment evidence is insufficient to apply the four-unit Part E rule.",
      "multi-unit-unconfirmed-attachment",
      count,
    );
  }

  if (longerTermSectorPatterns.some((pattern) => pattern.test(text))) {
    return commercialResult(
      "good",
      "nurture",
      "Relevant larger project type with credible longer-term acoustic consultancy potential.",
      "not-residential",
      count,
    );
  }

  if (hasGenericNoiseOnly) {
    return commercialResult(
      "medium",
      "monitor",
      "Broad noise wording is retained, but receives less weight because no specific acoustic deliverable is present.",
      "not-residential",
      count,
    );
  }

  return commercialResult(
    isConfirmed ? "medium" : "poor",
    isConfirmed ? "monitor" : "background",
    isConfirmed
      ? "Authoritative evidence supports retention, but no immediate acoustic instruction or stronger commercial scale signal was identified."
      : "Discovery record retained, but authoritative document evidence and a stronger commercial qualification signal are not yet available.",
    "not-residential",
    count,
  );
}

function validTimestamp(value: string | undefined) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function assessLeadFreshness(record: TenderOpportunity, now = new Date()): {
  freshness: LeadFreshness;
  ageDays?: number;
  reason: string;
} {
  const published = validTimestamp(record.publishedAt);
  if (published !== undefined) {
    const ageDays = Math.max(0, Math.floor((now.getTime() - published) / 86_400_000));
    if (ageDays === 0) return { freshness: "published-today", ageDays, reason: "Published by the source today; first-mover priority boost applied." };
    if (ageDays <= 3) return { freshness: "published-1-3-days", ageDays, reason: "Published by the source within the last three days; high first-mover priority." };
    if (ageDays <= 7) return { freshness: "published-4-7-days", ageDays, reason: "Published by the source within the last week; current opportunity." };
    if (ageDays <= 30) return { freshness: "published-8-30-days", ageDays, reason: "Published within the last month; retained as a current opportunity." };
    return { freshness: "published-over-30-days", ageDays, reason: "Older source publication retained because it may still be open, newly actionable or previously overlooked." };
  }

  const firstDetected = validTimestamp(record.firstSeenAt);
  if (firstDetected !== undefined && now.getTime() - firstDetected <= 3 * 86_400_000) {
    return {
      freshness: "newly-detected-date-unknown",
      reason: "Newly detected by Helmonic, but the source publication date is unavailable; it is not claimed to be newly published.",
    };
  }
  return {
    freshness: "date-unknown",
    reason: "Source publication date is unavailable; retained and ranked from evidence, project value, status and relationship signals instead of assumed age.",
  };
}

export function freshnessPriority(record: TenderOpportunity) {
  switch (record.leadFreshness) {
    case "published-today": return 6;
    case "published-1-3-days": return 5;
    case "published-4-7-days": return 4;
    case "published-8-30-days": return 3;
    case "newly-detected-date-unknown": return 2;
    case "published-over-30-days": return 1;
    default: return 0;
  }
}

export function qualifyLead(record: TenderOpportunity, now = new Date()): TenderOpportunity {
  const assessment = assessLeadQuality(record);
  const freshness = assessLeadFreshness(record, now);
  return {
    ...record,
    leadQuality: assessment.quality,
    leadDisposition: assessment.disposition,
    qualificationReason: assessment.reason,
    leadFreshness: freshness.freshness,
    sourceAgeDays: freshness.ageDays,
    freshnessReason: freshness.reason,
    residentialUnitCount: assessment.count,
    residentialScale: assessment.scale,
  };
}

export function isSalesRouteable(record: TenderOpportunity) {
  return record.leadQuality !== "poor"
    && record.leadQuality !== "closed-background"
    && record.leadDisposition !== "background";
}
