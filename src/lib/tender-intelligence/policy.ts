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

// Planning evidence is deliberately broader than the six discovery keywords.
// These expressions are applied to authoritative RFI/decision documents, not
// to generic search-result metadata, so the retained match can be shown to a
// consultant with the source letter and excerpt.
const acousticDocumentVocabulary: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "acoustic consultant", pattern: /\b(?:suitably\s+qualified\s+)?acoustic(?:al)?\s+consultant\b/i },
  { label: "suitably qualified acoustician", pattern: /\bsuitably\s+qualified\s+acoustician\b/i },
  { label: "acoustician", pattern: /\bacoustician\b/i },
  { label: "acoustic", pattern: /\bacoustics?\b/i },
  { label: "noise impact assessment", pattern: /\bnoise\s+impact\s+assessment\b|\bNI[AR]\b/i },
  { label: "acoustic impact assessment", pattern: /\bacoustic\s+impact\s+assessment\b/i },
  { label: "noise and vibration impact assessment", pattern: /\bnoise\s+(?:and|&)\s+vibration\s+impact\s+assessment\b/i },
  { label: "acoustic report or assessment", pattern: /\bacoustic\s+(?:report|assessment|design)\b/i },
  { label: "noise survey or monitoring", pattern: /\b(?:baseline\s+)?noise\s+(?:survey|monitoring)\b/i },
  { label: "noise assessment", pattern: /\bnoise\s+assessment\b/i },
  { label: "operational noise", pattern: /\boperational\s+noise\b/i },
  { label: "environmental noise", pattern: /\benvironmental\s+noise\b/i },
  { label: "construction noise or vibration", pattern: /\bconstruction\s+(?:noise|vibration|noise\s+(?:and|&)\s+vibration)\b/i },
  { label: "noise and vibration management plan", pattern: /\b(?:construction\s+)?noise\s+(?:and|&)\s+vibration\s+management\s+plan\b/i },
  { label: "plant or building-services noise", pattern: /\b(?:mechanical\s+)?plant\s+noise\b|\bbuilding[- ]services\s+noise\b|\bM\s*&\s*E\s+noise\b/i },
  { label: "background or ambient noise", pattern: /\b(?:background|ambient)\s+noise\b/i },
  { label: "sound insulation", pattern: /\b(?:airborne\s+|impact\s+|fa[cç]ade\s+)?sound\s+insulation\b/i },
  { label: "sound reduction", pattern: /\bsound\s+reduction\b/i },
  { label: "sound-insulation testing", pattern: /\bsound[- ]insulation\s+testing\b|\bpre[- ]completion\s+testing\b/i },
  { label: "acoustic glazing or ventilation", pattern: /\bacoustic\s+glazing\b|\benhanced\s+glazing\b|\balternative\s+ventilation\b[^.]{0,100}\bnoise\b/i },
  { label: "noise-control plant treatment", pattern: /\b(?:plant|acoustic)\s+enclosure\b|\bacoustic\s+louvre\b|\battenuator\b|\bnoise\s+barrier\b/i },
  { label: "room acoustics", pattern: /\broom\s+acoustics\b|\breverberation\b|\bspeech\s+intelligibility\b/i },
  { label: "noise breakout", pattern: /\bnoise\s+breakout\b/i },
  { label: "noise mitigation", pattern: /\b(?:noise|acoustic)\s+mitigation\b/i },
  { label: "noise-sensitive receptor", pattern: /\bnoise[- ]sensitive\s+(?:receptor|location)\b/i },
  { label: "noise level or decibel limit", pattern: /\bnoise\s+(?:level|limit)s?\b|\bdecibels?\b|\bdB(?:\(A\))?\b|\bLAeq\b|\bLAFmax\b/i },
  { label: "Part E / TGD E", pattern: /\b(?:Technical\s+Guidance\s+Document\s+E|TGD\s*E|Building\s+Regulations\s+Part\s+E|Part\s+E)\b/i },
  { label: "acoustic standard", pattern: /\b(?:BS\s*4142|BS\s*8233|BS\s*5228|ProPG|BB93|HTM\s*08-01|ISO\s*16283|ISO\s*717|ISO\s*3382)\b/i },
  { label: "BNS", pattern: /\bBNS\b/i },
  { label: "vibration", pattern: /\bvibration(?:\s+isolation)?\b/i },
  // Never treat ordinary wording such as "structurally sound" as acoustic
  // evidence. Standalone sound is retained only with a professional acoustic
  // collocation; the more specific insulation/reduction patterns above remain.
  { label: "sound", pattern: /\bsound\s+(?:level|survey|monitoring|assessment|pressure|transmission|attenuation|breakout)\b/i },
  { label: "noise", pattern: /\bnoise\b/i },
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
  const text = values.map(normalizeText).join(" ");
  return acousticDocumentVocabulary
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => label);
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

  if (/(?:further|additional)\s+info(?:rmation)?|\brfi\b|clarification/.test(stage)) {
    return hasOfficialEvidence && matches.length > 0
      ? "noise-related-rfi"
      : "further-information-request";
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
  else if (input.classification === "further-information-request") score = 90;
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
