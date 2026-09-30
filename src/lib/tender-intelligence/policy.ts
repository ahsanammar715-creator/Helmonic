import { createHash } from "node:crypto";

import type {
  PlanningClassification,
  TenderOpportunity,
} from "./types.ts";

export const acousticKeywords = [
  "noise",
  "vibration",
  "sound",
  "acoustic",
  "acoustics",
  "acoustician",
] as const;

export const acousticCpvCodes = [
  "71313100",
  "71313200",
  "71313400",
  "90742000",
  "90742300",
  "90742400",
] as const;

const excludedTenderContexts = [
  /\baudio[- ]?visual\b/i,
  /\bvideo (?:equipment|centre|services?)\b/i,
  /\bacoustic (?:devices?|telemetry equipment)\b/i,
  /\bsound (?:and video )?equipment\b/i,
  /\bsound technician\b/i,
  /\banti-vibration (?:components?|mounts?|parts?)\b/i,
] as const;

const consultancyContexts = [
  /\bconsult(?:ancy|ant|ing|ants)\b/i,
  /\bengineer(?:ing|s)?\b/i,
  /\bassessment\b/i,
  /\bmonitor(?:ing)?\b/i,
  /\bsurvey\b/i,
  /\bplanning\b/i,
  /\bdesign\b/i,
  /\benvironmental\b/i,
  /\binsulation\b/i,
  /\bbuilding\b/i,
] as const;

const includedSectorTerms = [
  "apartment",
  "residential",
  "commercial",
  "retail",
  "school",
  "education",
  "hospital",
  "healthcare",
  "industrial",
  "mixed-use",
  "mixed use",
  "hotel",
  "hospitality",
  "data centre",
  "data center",
  "transport",
  "infrastructure",
] as const;

const excludedSectorTerms = ["agriculture", "agricultural", "farm building"] as const;

export function normalizeText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function stableOpportunityId(...parts: unknown[]) {
  return createHash("sha256")
    .update(parts.map(normalizeText).join("\u001f"))
    .digest("hex")
    .slice(0, 24);
}

export function matchedAcousticTerms(...values: unknown[]) {
  const text = values.map(normalizeText).join(" ").toLowerCase();
  return acousticKeywords.filter((keyword) =>
    new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text),
  );
}

export function relevantTenderText(...values: unknown[]) {
  const text = values.map(normalizeText).join(" ");
  const matches = matchedAcousticTerms(text);
  if (matches.length === 0) return false;
  if (excludedTenderContexts.some((pattern) => pattern.test(text))) return false;
  // Noise, vibration and acoustic terminology are specific enough after the
  // product/media exclusions. The generic word "sound" needs a professional
  // services context or it creates large numbers of AV/media false positives.
  if (matches.some((term) => term !== "sound")) return true;
  return consultancyContexts.some((pattern) => pattern.test(text));
}

export function relevantSector(...values: unknown[]) {
  const text = values.map(normalizeText).join(" ").toLowerCase();
  if (excludedSectorTerms.some((term) => text.includes(term))) return false;
  return includedSectorTerms.some((term) => text.includes(term));
}

export function classifyPlanningEvidence(input: {
  stage: string;
  evidenceText?: string;
  description?: string;
  evidenceUrl?: string;
}): PlanningClassification {
  const stage = normalizeText(input.stage).toLowerCase();
  const evidence = normalizeText(input.evidenceText);
  const matches = matchedAcousticTerms(evidence);
  const hasOfficialEvidence = Boolean(evidence && input.evidenceUrl);

  if (/further information|rfi|clarification/.test(stage)) {
    return hasOfficialEvidence && matches.length > 0
      ? "noise-related-rfi"
      : "needs-council-evidence";
  }
  if (/grant|condition|conditional/.test(stage)) {
    return hasOfficialEvidence && matches.length > 0
      ? "granted-with-noise-conditions"
      : relevantSector(input.description)
        ? "design-construction-potential"
        : "needs-council-evidence";
  }
  if (/refus/.test(stage)) {
    return hasOfficialEvidence && matches.length > 0
      ? "refused-on-noise-grounds"
      : "needs-council-evidence";
  }
  return relevantSector(input.description)
    ? "design-construction-potential"
    : "no-relevant-opportunity";
}

export function scoreOpportunity(input: {
  classification?: PlanningClassification;
  cpvCodes?: string[];
  matchedTerms?: string[];
  buyer?: string;
}) {
  let score = 35;
  if (input.classification === "noise-related-rfi") score = 95;
  else if (input.classification === "granted-with-noise-conditions") score = 88;
  else if (input.classification === "refused-on-noise-grounds") score = 84;
  else if (input.classification === "design-construction-potential") score = 60;
  else if (input.classification === "needs-council-evidence") score = 48;
  if (input.cpvCodes?.some((code) => acousticCpvCodes.includes(code as never))) score += 20;
  score += Math.min(15, (input.matchedTerms?.length ?? 0) * 3);
  if (/office of public works|\bopw\b|city council|county council/i.test(input.buyer ?? "")) {
    score += 5;
  }
  return Math.min(100, score);
}

export function deduplicateOpportunities(records: TenderOpportunity[]) {
  const byKey = new Map<string, TenderOpportunity>();
  for (const record of records) {
    const key = `${record.sourceSystem}:${record.sourceRecordId}`.toLowerCase();
    const existing = byKey.get(key);
    if (!existing || record.evidenceStatus === "official-text") byKey.set(key, record);
  }
  return [...byKey.values()].sort((a, b) => b.fitScore - a.fitScore || a.title.localeCompare(b.title));
}
