import { normalizeText } from "./policy.ts";
import type { TenderOpportunity } from "./types.ts";

export const leinsterPlanningAuthorities = [
  "Carlow County Council",
  "Dun Laoghaire Rathdown County Council",
  "Dublin City Council",
  "Fingal County Council",
  "Kildare County Council",
  "Kilkenny County Council",
  "Laois County Council",
  "Longford County Council",
  "Louth County Council",
  "Meath County Council",
  "Offaly County Council",
  "South Dublin County Council",
  "Westmeath County Council",
  "Wexford County Council",
  "Wicklow County Council",
] as const;

const leinsterTerms = [
  "carlow", "dublin", "fingal", "kildare", "kilkenny", "laois", "longford",
  "louth", "meath", "offaly", "westmeath", "wexford", "wicklow",
  "dun laoghaire", "dún laoghaire", "south dublin",
];

const nonLeinsterTerms = [
  "cavan", "clare", "cork", "donegal", "galway", "kerry", "leitrim", "limerick",
  "mayo", "monaghan", "roscommon", "sligo", "tipperary", "waterford",
];

function containsTerm(text: string, term: string) {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

export function approvedTenderBuyer(buyer: string | undefined) {
  return /office of public works|\bopw\b|\bcouncil\b/i.test(normalizeText(buyer));
}

export function targetRegionStatus(record: TenderOpportunity) {
  if (record.sourceSystem === "DCC") return "in-region" as const;
  const text = [
    record.planningAuthority,
    record.buyer,
    record.location,
    record.title,
    record.description,
  ].map(normalizeText).join(" ");
  if (leinsterTerms.some((term) => containsTerm(text, term))) return "in-region" as const;
  if (nonLeinsterTerms.some((term) => containsTerm(text, term))) return "out-of-region" as const;
  return "unknown" as const;
}

export function applyTargetScope(record: TenderOpportunity): TenderOpportunity {
  if (record.scopeStatus === "excluded" && record.scopeExclusionReason) return record;
  if (record.type === "formal-public-tender" && !approvedTenderBuyer(record.buyer)) {
    return {
      ...record,
      scopeStatus: "excluded",
      scopeExclusionReason: "buyer-is-not-opw-or-a-local-authority",
    };
  }
  const region = targetRegionStatus(record);
  if (region === "in-region") return { ...record, scopeStatus: "eligible", scopeExclusionReason: undefined };
  if (region === "out-of-region") {
    return { ...record, scopeStatus: "excluded", scopeExclusionReason: "outside-leinster" };
  }
  return { ...record, scopeStatus: "unknown", scopeExclusionReason: "leinster-location-not-established" };
}

export function withinTargetScope(record: TenderOpportunity) {
  return applyTargetScope(record).scopeStatus === "eligible";
}
