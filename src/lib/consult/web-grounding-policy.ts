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

export type BraveLlmContextPayload = {
  grounding?: {
    generic?: Array<{
      url?: string;
      title?: string;
      snippets?: string[];
    }>;
  };
  sources?: Record<
    string,
    {
      title?: string;
      hostname?: string;
    }
  >;
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

function canonicalPublicUrl(value: string | undefined) {
  const validated = validatedPublicUrl(value);
  if (!validated) return undefined;
  const url = new URL(validated);
  url.hash = "";
  for (const parameter of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "gclid",
    "fbclid",
  ]) {
    url.searchParams.delete(parameter);
  }
  return url.toString();
}

function domainMatches(hostname: string, domain: string) {
  const normalized = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

function authorityRank(hostname: string) {
  const officialDomains = [
    "gov.ie",
    "irishstatutebook.ie",
    "hsa.ie",
    "epa.ie",
    "met.ie",
    "gov.uk",
    "europa.eu",
  ];
  if (officialDomains.some((domain) => domainMatches(hostname, domain))) return 0;

  const standardsAndProfessionalDomains = [
    "standards.ie",
    "iso.org",
    "bsigroup.com",
    "ioa.org.uk",
    "acousticalsociety.org",
  ];
  if (
    standardsAndProfessionalDomains.some((domain) => domainMatches(hostname, domain))
  ) {
    return 1;
  }

  if (/\.(?:edu|ac\.uk|edu\.au)$/.test(hostname)) return 2;
  return 3;
}

function evidenceExcerpt(snippets: string[] | undefined) {
  const cleaned = (snippets ?? [])
    .map((snippet) => snippet.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return [...new Set(cleaned)].join(" ").slice(0, 1_200).trim();
}

/**
 * Converts only provider-returned HTTP(S) sources and extracted passages into
 * server-authoritative W evidence. No URL or evidence text is model-invented.
 */
export function parseBravePublicWebCitations(
  payload: BraveLlmContextPayload,
  options: {
    maximumSources: number;
    retrievedAt: string;
    allowedDomains?: string[];
  },
) {
  const candidates: Array<Omit<ConsultCitation, "marker"> & { rank: number; order: number }> = [];
  for (const [order, result] of (payload.grounding?.generic ?? []).entries()) {
    const sourceUri = canonicalPublicUrl(result.url);
    const excerpt = evidenceExcerpt(result.snippets);
    if (!sourceUri || !excerpt) continue;
    if (candidates.some((candidate) => candidate.sourceUri === sourceUri)) continue;

    const hostname = new URL(sourceUri).hostname.toLowerCase().replace(/^www\./, "");
    if (
      options.allowedDomains?.length &&
      !options.allowedDomains.some((domain) => domainMatches(hostname, domain))
    ) {
      continue;
    }

    const sourceMetadata = payload.sources?.[result.url ?? ""];
    candidates.push({
      id: `web:${sourceUri}`,
      title:
        result.title?.trim() ||
        sourceMetadata?.title?.trim() ||
        sourceMetadata?.hostname?.trim() ||
        hostname,
      sourceId: sourceUri,
      sourceUri,
      excerpt,
      sourceType: "web",
      citationNamespace: "W",
      retrievedAt: options.retrievedAt,
      rank: authorityRank(hostname),
      order,
    });
  }

  return candidates
    .sort((left, right) => left.rank - right.rank || left.order - right.order)
    .slice(0, options.maximumSources)
    .map((citation, index) => ({
      id: citation.id,
      title: citation.title,
      sourceId: citation.sourceId,
      sourceUri: citation.sourceUri,
      excerpt: citation.excerpt,
      sourceType: citation.sourceType,
      citationNamespace: citation.citationNamespace,
      retrievedAt: citation.retrievedAt,
      marker: `W${index + 1}` as const,
    }));
}
