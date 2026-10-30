import type { TenderOpportunity } from "./types.ts";

export const EDUCATION_LOOKUP_CAMPAIGN = "Education / BIM Opportunities";
export const EDUCATION_LOOKUP_CAMPAIGN_KEY = "education-bim";

export const educationLookupSearchTerms = [
  "school",
  "education",
  "college",
  "university",
  "campus",
  "academy",
  "creche",
] as const;

const educationPattern = /\b(?:education|school|college|university|campus|academy|creche|crèche|nursery|classroom|student)\b/i;
const eligibleStagePattern = /\b(?:pre[- ]?planning|plans? applied|planning|application|lodged|submitted|validated|new application|further information requested|further info(?:rmation)? requested|rfi|plans? granted|permission granted|decision granted|grant of permission|granted with conditions)\b/i;
const closedStagePattern = /\b(?:refused|withdrawn|invalid(?:ated)?|cancelled|completed|abandoned|expired)\b/i;

function dayStart(date: Date) {
  return Date.parse(date.toISOString().slice(0, 10));
}

export function isEducationOpportunity(record: TenderOpportunity) {
  return educationPattern.test([
    record.projectSector,
    record.title,
    record.description,
    record.location,
    record.evidenceExcerpt,
  ].filter(Boolean).join(" "));
}

export function isCurrentEducationLookupOpportunity(record: TenderOpportunity, now = new Date()) {
  if (!isEducationOpportunity(record)) return false;
  const stage = [record.projectStage, record.sourceStatus, record.triggerType, record.description]
    .filter(Boolean).join(" ");
  if (!eligibleStagePattern.test(stage) || closedStagePattern.test(stage)) return false;

  if (record.rfiResponseReceivedAt) return false;
  const rfiDue = Date.parse(record.responseDeadline ?? "");
  if (Number.isFinite(rfiDue) && rfiDue < dayStart(now)) return false;
  return true;
}

export function selectEducationLookupOpportunities(records: TenderOpportunity[], now = new Date()) {
  return records
    .filter((record) => isCurrentEducationLookupOpportunity(record, now))
    .map((record) => ({
      ...record,
      lookupCampaign: EDUCATION_LOOKUP_CAMPAIGN,
    } satisfies TenderOpportunity));
}
