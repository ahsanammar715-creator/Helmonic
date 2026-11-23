import type { ConsultCitation } from "./types.ts";

export const minimumExperienceProjectCount = 3;
export const maximumExperienceProjectCount = 6;

export type ExperienceEvidenceDocument = {
  score?: number;
  chunkId?: string;
  messageId: string;
  evidenceRef?: string;
  bodyText: string;
  subject?: string;
  mailboxOwner?: string;
  participants?: string[];
  participantNames?: string[];
  firm?: string;
  projectNames: string[];
  relationshipPeople?: string[];
};

export type PrivateExperienceAuditSource = {
  marker: `E${number}`;
  messageId: string;
  evidenceRef?: string;
  projectNames: string[];
};

function normalizedArray(values: unknown[]) {
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.replace(/\s+/g, " ").trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function deidentifyExperienceText(
  bodyText: string,
  identifiers: unknown[],
) {
  let value = bodyText
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^\s*(?:from|to|cc|bcc|sent|date|subject|reply-to)\s*:/i.test(line) &&
        !/^\s*(?:kind )?regards\b/i.test(line),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  for (const identifier of normalizedArray(identifiers).sort((a, b) => b.length - a.length)) {
    if (identifier.length < 3) continue;
    value = value.replace(new RegExp(escaped(identifier), "gi"), "[private detail]");
  }

  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[private contact]")
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, "[private link]")
    .replace(/\b(?:\+?353[\s().-]?|0)\d(?:[\s().-]?\d){7,10}\b/g, "[private contact]")
    .replace(/\b(?:J|P|IAC)[-_ ]?\d{3,8}\b/gi, "[private project]")
    .replace(/\b[A-Z]{1,6}[-_ ]?\d{2,8}(?:[._-][A-Z0-9]+)*\b/g, "[private project]")
    .replace(/\b[A-Z]{2,8}(?:[-_][A-Z0-9]{1,8})+\b/g, "[private project]")
    .replace(/\b[A-Z][a-z]+,\s*[A-Z][a-z]+\b/g, "[private detail]")
    .replace(/\b[A-Z0-9._-]+\.(?:pdf|docx?|xlsx?|dwg|dxf)\b/gi, "[private document]")
    .replace(/\b(?:D\d{2}|A\d{2})\s?[A-Z0-9]{4}\b/gi, "[private address]")
    .replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, "[private date]")
    .replace(
      /\b(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{2,4}\b/gi,
      "[private date]",
    )
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g, "[private detail]")
    .replace(/(?:\[private (?:detail|contact|link|project|date)\]\s*){2,}/g, "[private detail] ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function safeTechnicalExperienceExcerpt(excerpt: string) {
  if (
    /\b(?:email|e-mail|mailbox|view online|unsubscribe|reply to|newsletter|assigned to|attachments?|talking points|positioning strategy|suggested statement|upcoming meeting)\b/i.test(
      excerpt,
    )
  ) {
    return false;
  }
  if (
    !/\b(?:acoustic|sound|noise|vibration|partition|riser|penetration|flanking|façade|facade|glazing|door|duct|plant|reverber|insulation|commission|testing|construction|coordination)\w*/i.test(
      excerpt,
    )
  ) {
    return false;
  }
  const privateMarkers = excerpt.match(/\[private [^\]]+\]/g)?.length ?? 0;
  return privateMarkers <= 8;
}

function projectKey(document: ExperienceEvidenceDocument) {
  return document.projectNames[0]?.replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase() || "";
}

export function buildDeidentifiedExperienceEvidence(
  documents: ExperienceEvidenceDocument[],
) {
  const bestByProject = new Map<string, ExperienceEvidenceDocument>();
  for (const document of documents) {
    const key = projectKey(document);
    if (!key) continue;
    const current = bestByProject.get(key);
    if (!current || (document.score ?? 0) > (current.score ?? 0)) {
      bestByProject.set(key, document);
    }
  }

  const selected = [...bestByProject.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, maximumExperienceProjectCount)
    .map((document) => {
      const excerpt = deidentifyExperienceText(document.bodyText, [
        document.subject,
        document.mailboxOwner,
        document.firm,
        ...(document.participants ?? []),
        ...(document.participantNames ?? []),
        ...document.projectNames,
        ...(document.relationshipPeople ?? []),
      ]);
      return { document, excerpt };
    })
    .filter(
      ({ excerpt }) => excerpt.length >= 80 && safeTechnicalExperienceExcerpt(excerpt),
    );

  if (selected.length < minimumExperienceProjectCount) {
    return { citations: [] as ConsultCitation[], auditSources: [] as PrivateExperienceAuditSource[] };
  }

  const citations = selected.map<ConsultCitation>(({ excerpt }, index) => ({
    id: `experience-case-${index + 1}`,
    title: `De-identified experience case ${index + 1}`,
    sourceId: `experience-case-${index + 1}`,
    excerpt,
    sourceType: "experience",
    citationNamespace: "E",
    marker: `E${index + 1}`,
  }));
  const auditSources = selected.map<PrivateExperienceAuditSource>(({ document }, index) => ({
    marker: `E${index + 1}`,
    messageId: document.messageId,
    evidenceRef: document.evidenceRef,
    projectNames: document.projectNames,
  }));
  return { citations, auditSources };
}

export function toPublicExperienceCitations(citations: ConsultCitation[]) {
  return citations.map((citation) =>
    citation.sourceType === "experience"
      ? {
          ...citation,
          excerpt:
            "De-identified cross-project experience; identifying detail and private provenance are retained only in the restricted audit.",
          sourceUri: undefined,
          section: undefined,
          score: undefined,
        }
      : citation,
  );
}

export function validateDeidentifiedExperienceAnswer(
  answer: string,
  citations: ConsultCitation[],
) {
  const errors: string[] = [];
  const experienceMarkers = new Set(
    citations
      .filter((citation) => citation.sourceType === "experience")
      .map((citation) => citation.marker)
      .filter((marker): marker is NonNullable<ConsultCitation["marker"]> => Boolean(marker)),
  );

  for (const block of answer.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean)) {
    const markers = [
      ...new Set(
        Array.from(block.matchAll(/\[(E\d+)\]/g), (match) => match[1]).filter((marker) =>
          experienceMarkers.has(marker as NonNullable<ConsultCitation["marker"]>),
        ),
      ),
    ];
    if (markers.length === 0) continue;
    if (markers.length < minimumExperienceProjectCount) {
      errors.push(
        `Every experience paragraph must cite at least ${minimumExperienceProjectCount} distinct project cases.`,
      );
    }
    if (!/based on experience across comparable projects/i.test(block)) {
      errors.push("Experience paragraphs must identify themselves as cross-project experience.");
    }
  }

  if (
    /\b(?:email|e-mail|message|mailbox|sender|recipient|subject line|client conversation)\b/i.test(
      answer,
    )
  ) {
    errors.push("The experience answer exposes the private evidence channel.");
  }
  if (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\bhttps?:\/\/\S+|\b(?:\+?353[\s().-]?|0)\d(?:[\s().-]?\d){7,10}\b|\b(?:J|P|IAC)[-_ ]?\d{3,8}\b/i.test(
      answer,
    )
  ) {
    errors.push("The experience answer contains a potentially identifying detail.");
  }

  return { valid: errors.length === 0, errors };
}
