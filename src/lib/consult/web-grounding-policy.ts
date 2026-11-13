const publicAcousticTopics: Array<[RegExp, string]> = [
  [/\bacoustic(?:s|al|ian)?\b/i, "acoustics"],
  [/\bnoise\b/i, "noise"],
  [/\bvibration\b/i, "vibration"],
  [/\bsound insulation\b/i, "sound insulation"],
  [/\bairborne sound\b/i, "airborne sound"],
  [/\bimpact sound\b/i, "impact sound"],
  [/\broom acoustics\b/i, "room acoustics"],
  [/\breverberation(?: time)?\b/i, "reverberation time"],
  [/\bfa[cç]ade\b/i, "facade acoustics"],
  [/\bbuilding services noise\b/i, "building services noise"],
  [/\benvironmental noise\b/i, "environmental noise"],
  [/\bconstruction noise\b/i, "construction noise"],
  [/\bnoise impact assessment\b/i, "noise impact assessment"],
  [/\bplanning condition\b/i, "planning noise condition"],
  [
    /\brequest for (?:further|additional) information\b/i,
    "planning request for further information",
  ],
  [/\bRFI\b/, "planning request for further information"],
  [/\btechnical guidance document\s*e\b/i, "Technical Guidance Document E"],
  [/\b(?:building regulations\s*)?part\s*e\b/i, "Irish Building Regulations Part E"],
  [/\bbuilding regulations\b/i, "building regulations"],
  [/\bnoise limit(?:s)?\b/i, "noise limits"],
  [/\bmeasurement(?:s| method)?\b/i, "measurement method"],
  [/\btesting\b/i, "acoustic testing"],
];

const publicStandardPattern =
  /\b(?:I\.S\.|BS|EN|ISO|IEC|ASTM)\s*(?:EN\s*)?(?:ISO\s*)?[A-Z]?\s*\d{3,6}(?:[-:]\d+)*(?::\d{4})?\b/gi;

/**
 * Creates a public-web query from an allowlist of technical concepts only.
 * Arbitrary words, names, addresses, dates, project codes, measurements and
 * correspondence text are never copied to the web-search boundary.
 */
export function buildSafePublicWebQuery(question: string): string | null {
  const topics = publicAcousticTopics
    .filter(([pattern]) => pattern.test(question))
    .map(([, label]) => label);
  const standards = Array.from(question.matchAll(publicStandardPattern), (match) =>
    match[0].replace(/\s+/g, " ").trim(),
  );
  const terms = [...new Set([...topics, ...standards])].slice(0, 8);
  if (terms.length === 0) return null;

  return `Ireland acoustic engineering ${terms.join(" ")} official current guidance`;
}
import type { ConsultCitation } from "@/lib/consult/types";

export type WebCitationAnnotation = {
  type?: string;
  start_index?: number;
  end_index?: number;
  url?: string;
  title?: string;
};

export type WebResponseOutputItem = {
  type?: string;
  status?: string;
  content?: Array<{
    type?: string;
    text?: string;
    annotations?: WebCitationAnnotation[];
  }>;
};

export type WebResponsePayload = {
  output?: WebResponseOutputItem[];
};


function validatedPublicUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function citationExcerpt(text: string, start: number | undefined, end: number | undefined) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start! < 0 || end! <= start!) {
    return text.trim().slice(0, 700);
  }
  const boundedStart = Math.max(0, start!);
  const boundedEnd = Math.min(text.length, end!);
  const sentenceStart = Math.max(
    text.lastIndexOf(". ", boundedStart - 1) + 2,
    text.lastIndexOf("\n", boundedStart - 1) + 1,
  );
  const nextStop = text.indexOf(". ", boundedEnd);
  const nextLine = text.indexOf("\n", boundedEnd);
  const candidates = [
    nextStop >= 0 ? nextStop + 1 : text.length,
    nextLine >= 0 ? nextLine : text.length,
  ];
  const sentenceEnd = Math.min(...candidates, sentenceStart + 700);
  return text.slice(sentenceStart, sentenceEnd).trim();
}

export function parsePublicWebCitations(
  payload: WebResponsePayload,
  options: { maximumSources: number; retrievedAt: string },
) {
  const usedWebSearch = payload.output?.some(
    (item) => item.type === "web_search_call" && item.status !== "failed",
  );
  if (!usedWebSearch) return [];

  const candidates: Array<Omit<ConsultCitation, "marker">> = [];
  for (const item of payload.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type !== "output_text" || !content.text) continue;
      for (const annotation of content.annotations ?? []) {
        if (annotation.type !== "url_citation") continue;
        const sourceUri = validatedPublicUrl(annotation.url);
        if (!sourceUri || candidates.some((candidate) => candidate.sourceUri === sourceUri)) {
          continue;
        }
        candidates.push({
          id: `web:${sourceUri}`,
          title: annotation.title?.trim() || new URL(sourceUri).hostname,
          sourceId: sourceUri,
          sourceUri,
          excerpt: citationExcerpt(content.text, annotation.start_index, annotation.end_index),
          sourceType: "web",
          citationNamespace: "W",
          retrievedAt: options.retrievedAt,
        });
      }
    }
  }

  return candidates.slice(0, options.maximumSources).map((citation, index) => ({
    ...citation,
    marker: `W${index + 1}` as const,
  }));
}
