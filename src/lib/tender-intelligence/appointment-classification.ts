import { createHash } from "node:crypto";

import { normalizeText } from "./policy.ts";
import type {
  AcousticAppointmentStatus,
  OutreachEligibility,
  TenderOpportunity,
} from "./types.ts";

const iacousticsName = /\b(?:i\s*acoustics|integrated\s+acoustic\s+solutions(?:\s+(?:ltd|limited))?)\b/i;
const closedStatuses = /\b(?:awarded|cancelled|canceled|closed|completed|resolved|withdrawn|expired)\b/i;

const statusPriority: Record<AcousticAppointmentStatus, number> = {
  "not-identified": 0,
  "needs-verification": 1,
  "competitor-appointed": 2,
  "iacoustics-appointed": 3,
};

function recordEvidenceText(record: TenderOpportunity) {
  return normalizeText([
    record.appointmentEvidenceExcerpt,
    record.evidenceExcerpt,
    ...(record.evidenceDocuments ?? []).flatMap((document) => [document.description, document.excerpt]),
    record.description,
  ].filter(Boolean).join("\n"));
}

function excerptAround(text: string, pattern: RegExp, radius = 260) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const match = new RegExp(pattern.source, flags).exec(text);
  if (!match) return undefined;
  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  return text.slice(start, end).trim();
}

function explicitIacousticsAppointment(text: string) {
  const windows = [
    /(?:i\s*acoustics|integrated\s+acoustic\s+solutions)[\s\S]{0,140}(?:appointed|engaged|retained|instructed|selected|commissioned|acting)[\s\S]{0,140}(?:acoustic(?:s)?\s+consultant|acoustician|noise\s+consultant|acoustic(?:s)?\s+engineer)/i,
    /(?:acoustic(?:s)?\s+consultant|acoustician|noise\s+consultant|acoustic(?:s)?\s+engineer)[\s\S]{0,140}(?:appointed|engaged|retained|instructed|selected|commissioned|acting)[\s\S]{0,140}(?:i\s*acoustics|integrated\s+acoustic\s+solutions)/i,
    /(?:appointed|engaged|retained|instructed|selected|commissioned)[\s\S]{0,100}(?:i\s*acoustics|integrated\s+acoustic\s+solutions)[\s\S]{0,100}(?:acoustic|noise)/i,
    /(?:acoustic(?:s)?\s+consultant|acoustician|noise\s+consultant|acoustic(?:s)?\s+engineer)\s*[:\-–—]\s*(?:i\s*acoustics|integrated\s+acoustic\s+solutions)/i,
    /(?:i\s*acoustics|integrated\s+acoustic\s+solutions)\s*[:\-–—]\s*(?:acoustic(?:s)?\s+consultant|acoustician|noise\s+consultant|acoustic(?:s)?\s+engineer)/i,
  ];
  return windows.find((pattern) => pattern.test(text));
}

function explicitCompetitorAppointment(record: TenderOpportunity, text: string) {
  const named = normalizeText(record.appointedAcoustician ?? "");
  if (named && !iacousticsName.test(named) && normalizeText(record.appointmentEvidenceExcerpt ?? "")) {
    return { name: named, excerpt: record.appointmentEvidenceExcerpt };
  }
  const patterns = [
    /(?:appointed|engaged|retained|instructed|selected|commissioned)\s+(?:as\s+)?(?:the\s+)?(?:project['’]s?\s+)?(?:acoustic(?:s)?\s+consultant|acoustician|noise\s+consultant|acoustic(?:s)?\s+engineer)\s*[:\-–—]?\s*([A-Z][A-Za-z0-9&.'’()\- ]{2,100})/i,
    /(?:acoustic(?:s)?\s+consultant|acoustician|noise\s+consultant|acoustic(?:s)?\s+engineer)\s*[:\-–—]\s*([A-Z][A-Za-z0-9&.'’()\- ]{2,100})/i,
    /([A-Z][A-Za-z0-9&.'’()\- ]{2,100})\s+(?:has|have|was|were|is|are)\s+(?:been\s+)?(?:appointed|engaged|retained|instructed|selected|commissioned)\s+(?:as\s+)?(?:the\s+)?(?:acoustic(?:s)?\s+consultant|acoustician|noise\s+consultant|acoustic(?:s)?\s+engineer)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const name = normalizeText(match?.[1] ?? "").replace(/[.;,:]+$/, "");
    if (match && name && !iacousticsName.test(name)) {
      return { name, excerpt: excerptAround(text, pattern) };
    }
  }
  return undefined;
}

function classifyOne(record: TenderOpportunity) {
  const text = recordEvidenceText(record);
  const suppliedName = normalizeText(record.appointedAcoustician ?? "");
  const suppliedEvidence = normalizeText(record.appointmentEvidenceExcerpt ?? "");
  const explicitIacousticsPattern = explicitIacousticsAppointment(text);
  const structuredIacousticsEvidence = Boolean(
    iacousticsName.test(suppliedName)
    && suppliedEvidence,
  );
  if (explicitIacousticsPattern || structuredIacousticsEvidence) {
    return {
      status: "iacoustics-appointed" as const,
      name: suppliedName || "iAcoustics / Integrated Acoustic Solutions",
      excerpt: suppliedEvidence || (explicitIacousticsPattern ? excerptAround(text, explicitIacousticsPattern) : undefined),
    };
  }
  const competitor = explicitCompetitorAppointment(record, text);
  if (competitor) {
    return {
      status: "competitor-appointed" as const,
      name: competitor.name,
      excerpt: competitor.excerpt,
    };
  }
  if (iacousticsName.test(text) || iacousticsName.test(suppliedName)) {
    return {
      status: "needs-verification" as const,
      name: suppliedName || "iAcoustics / Integrated Acoustic Solutions",
      excerpt: suppliedEvidence || excerptAround(text, iacousticsName),
    };
  }
  return { status: "not-identified" as const };
}

function appointmentSourceUrl(record: TenderOpportunity) {
  return record.appointmentEvidenceSourceUrl
    ?? record.evidenceDocuments?.find((document) => document.excerpt)?.sourceUrl
    ?? record.sourceUrl;
}

function outreachPolicy(record: TenderOpportunity): {
  eligibility: OutreachEligibility;
  reason?: string;
} {
  if (record.deduplicationStatus === "duplicate") {
    return { eligibility: "suppressed-duplicate", reason: "Duplicate source record; outreach must use the canonical CRM opportunity only." };
  }
  if (record.acousticAppointmentStatus === "iacoustics-appointed") {
    return { eligibility: "suppressed-already-won", reason: "Strong source evidence says iAcoustics is already appointed; cold outreach and competitive quotation are blocked." };
  }
  if (record.cycleStatus === "resolved" || closedStatuses.test(record.sourceStatus ?? "")) {
    return { eligibility: "suppressed-closed", reason: "The source lifecycle is closed or resolved; retained for context but not eligible for new outreach." };
  }
  if (record.acousticAppointmentStatus === "competitor-appointed") {
    return { eligibility: "consultant-review", reason: "Another acoustician appears appointed; retain as a competitive quotation opportunity but require consultant approval before contact." };
  }
  if (record.acousticAppointmentStatus === "needs-verification") {
    return { eligibility: "consultant-review", reason: "iAcoustics is mentioned without sufficient current-appointment evidence; verify before any outreach." };
  }
  return { eligibility: "eligible" };
}

function outreachKey(record: TenderOpportunity) {
  const identity = record.crmExternalId ?? record.canonicalOpportunityId ?? record.id;
  return `planning-outreach:${createHash("sha256").update(`${identity}|acoustic-opportunity`).digest("hex").slice(0, 24)}`;
}

export function applyAppointmentSafeguards(records: TenderOpportunity[]) {
  const classified = records.map((record) => {
    const result = classifyOne(record);
    return {
      ...record,
      acousticAppointmentStatus: result.status,
      appointedAcoustician: result.name ?? record.appointedAcoustician,
      appointmentEvidenceExcerpt: result.excerpt ?? record.appointmentEvidenceExcerpt,
      appointmentEvidenceSourceUrl: result.status === "not-identified"
        ? record.appointmentEvidenceSourceUrl
        : appointmentSourceUrl(record),
    } satisfies TenderOpportunity;
  });

  const strongestByCrmIdentity = new Map<string, TenderOpportunity>();
  for (const record of classified) {
    const key = record.crmExternalId ?? record.id;
    const existing = strongestByCrmIdentity.get(key);
    if (!existing || statusPriority[record.acousticAppointmentStatus!] > statusPriority[existing.acousticAppointmentStatus!]) {
      strongestByCrmIdentity.set(key, record);
    }
  }

  return classified.map((record): TenderOpportunity => {
    const strongest = strongestByCrmIdentity.get(record.crmExternalId ?? record.id)!;
    const merged = {
      ...record,
      acousticAppointmentStatus: strongest.acousticAppointmentStatus,
      appointedAcoustician: strongest.appointedAcoustician,
      appointmentEvidenceExcerpt: strongest.appointmentEvidenceExcerpt,
      appointmentEvidenceSourceUrl: strongest.appointmentEvidenceSourceUrl,
      appointmentEvidenceDate: strongest.appointmentEvidenceDate,
      competitiveQuoteOpportunity: strongest.acousticAppointmentStatus === "competitor-appointed",
      outreachKey: outreachKey(record),
    } satisfies TenderOpportunity;
    const policy = outreachPolicy(merged);
    return {
      ...merged,
      outreachEligibility: policy.eligibility,
      outreachSuppressionReason: policy.reason,
    };
  });
}
