import {
  acousticCpvCodes,
  matchedAcousticTerms,
  normalizeText,
  relevantTenderText,
  scoreOpportunity,
} from "./policy.ts";
import type { PlanningDocumentEvidence, TenderOpportunity } from "./types.ts";
import { fetchWithTimeout, type FetchLike } from "./fetch-with-timeout.ts";

const maxNoticeBytes = 12 * 1024 * 1024;
// TED's direct-document endpoint can throttle much sooner than the Search API.
// One-at-a-time retrieval plus bounded retry respects that separate surface.
const concurrency = 1;

async function fetchWithRetry(fetcher: FetchLike, url: string, init: RequestInit) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchWithTimeout(fetcher, url, init, 35_000);
    if (response.status !== 429 || attempt === 3) return response;
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    const delay = retryAfter > 0 ? Math.min(retryAfter * 1_000, 10_000) : 750 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new Error("official-document-retry-exhausted");
}

function decodeEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function textFromOfficialNoticeXml(xml: string) {
  return normalizeText(decodeEntities(
    xml
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  ));
}

export function approvedCpvCodesFromOfficialNotice(xml: string) {
  return [...new Set(xml.match(/\b\d{8}\b/g) ?? [])]
    .filter((code) => acousticCpvCodes.includes(code as never));
}

function excerptAroundFirstMatch(text: string, terms: readonly string[]) {
  const lower = text.toLowerCase();
  const positions = terms
    .map((term) => lower.search(new RegExp(`\\b${term}\\b`, "i")))
    .filter((position) => position >= 0);
  const index = positions.length > 0 ? Math.min(...positions) : 0;
  return text.slice(Math.max(0, index - 350), Math.min(text.length, index + 950));
}

export function tedOfficialNoticeXmlUrl(publicationNumber: string) {
  return `https://ted.europa.eu/en/notice/${encodeURIComponent(publicationNumber)}/xml`;
}

function publicationNumberFromEtenders(record: TenderOpportunity) {
  const candidates = [record.sourceUrl, record.description, record.title, record.sourceRecordId].join(" ");
  return candidates.match(/\b(\d{5,6}-20\d{2})\b/)?.[1];
}

function officialEvidenceUrl(record: TenderOpportunity) {
  if (record.sourceSystem === "TED") return tedOfficialNoticeXmlUrl(record.sourceRecordId);
  if (record.sourceSystem === "eTenders") {
    const publicationNumber = publicationNumberFromEtenders(record);
    if (publicationNumber) return tedOfficialNoticeXmlUrl(publicationNumber);
    if (/^https:\/\/(?:www\.)?etenders\.gov\.ie\//i.test(record.sourceUrl)) return record.sourceUrl;
  }
  return undefined;
}

async function boundedText(response: Response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxNoticeBytes) throw new Error(`official-document-too-large:${declared}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxNoticeBytes) throw new Error(`official-document-too-large:${bytes.byteLength}`);
  return new TextDecoder().decode(bytes);
}

function failedEvidence(record: TenderOpportunity, reason: string, sourceUrl?: string): TenderOpportunity {
  const evidenceDocuments: PlanningDocumentEvidence[] = sourceUrl ? [{
    id: `${record.sourceSystem}:${record.sourceRecordId}:official-notice`,
    documentType: "Official procurement notice/document",
    sourceUrl,
    fetchStatus: "unavailable",
    matchedTerms: [],
    error: reason,
  }] : [];
  return {
    ...record,
    evidenceStatus: "evidence-unavailable",
    evidenceExcerpt: undefined,
    evidenceDocuments,
    evidenceUnavailableReason: reason,
    matchedTerms: [],
    fitScore: scoreOpportunity({ ...record, matchedTerms: [] }),
  };
}

export async function enrichFormalTenderEvidence(
  record: TenderOpportunity,
  fetcher: FetchLike = fetch,
): Promise<TenderOpportunity> {
  if (record.type !== "formal-public-tender") return record;
  const sourceUrl = officialEvidenceUrl(record);
  if (!sourceUrl) return failedEvidence(record, "no-public-official-document-url");

  try {
    const response = await fetchWithRetry(fetcher, sourceUrl, {
      headers: { Accept: "application/xml,text/xml,text/html,*/*", "User-Agent": "Helmonic-Tender-Intelligence/1.0" },
      redirect: "follow",
    });
    if (!response.ok) return failedEvidence(record, `official-document-http-${response.status}`, sourceUrl);
    const raw = await boundedText(response);
    const contentType = response.headers.get("content-type") ?? "";
    const isTedXml = sourceUrl.endsWith("/xml") || /xml/i.test(contentType);
    if (!isTedXml) {
      return failedEvidence(record, "official-tender-pack-requires-authentication-or-has-no-extractable-public-document", sourceUrl);
    }

    const text = textFromOfficialNoticeXml(raw);
    const matchedTerms = [...matchedAcousticTerms(text)];
    const approvedCpvCodes = approvedCpvCodesFromOfficialNotice(raw);
    const hasProfessionalAcousticText = relevantTenderText(text);
    const hasApprovedCpv = approvedCpvCodes.length > 0;
    const excerpt = matchedTerms.length > 0 ? excerptAroundFirstMatch(text, matchedTerms) : undefined;
    const document: PlanningDocumentEvidence = {
      id: `${record.sourceSystem}:${record.sourceRecordId}:official-notice`,
      documentType: "Official procurement notice XML",
      sourceUrl,
      fetchStatus: "fetched",
      matchedTerms,
      excerpt,
    };

    // Both tests are mandatory. Search metadata is discovery only; the
    // authoritative notice must itself contain the approved CPV and relevant
    // acoustic wording before the tender is confirmed.
    if (!hasApprovedCpv || !hasProfessionalAcousticText) {
      const missing = [
        !hasApprovedCpv ? "approved-CPV" : "",
        !hasProfessionalAcousticText ? "acoustic-document-wording" : "",
      ].filter(Boolean).join("-and-");
      return {
        ...record,
        evidenceStatus: "official-text",
        evidenceExcerpt: excerpt,
        evidenceDocuments: [document],
        evidenceUnavailableReason: undefined,
        cpvCodes: [...new Set([...record.cpvCodes, ...approvedCpvCodes])],
        matchedTerms,
        classification: "no-relevant-opportunity",
        routingStatus: "not-qualified",
        routingReason: `official-document-missing-${missing}`,
        fitScore: scoreOpportunity({ ...record, cpvCodes: approvedCpvCodes, matchedTerms }),
      };
    }

    const enriched = {
      ...record,
      evidenceStatus: "official-text" as const,
      evidenceExcerpt: excerpt,
      evidenceDocuments: [document],
      evidenceUnavailableReason: undefined,
      cpvCodes: [...new Set([...record.cpvCodes, ...approvedCpvCodes])],
      matchedTerms,
    };
    return { ...enriched, fitScore: scoreOpportunity(enriched) };
  } catch (error) {
    return failedEvidence(
      record,
      error instanceof Error ? error.message : "official-document-fetch-failed",
      sourceUrl,
    );
  }
}

export async function enrichFormalTenderOpportunities(
  records: TenderOpportunity[],
  fetcher: FetchLike = fetch,
) {
  const output = new Array<TenderOpportunity>(records.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, records.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= records.length) return;
      output[index] = await enrichFormalTenderEvidence(records[index], fetcher);
    }
  }));
  return output;
}
