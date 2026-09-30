import { strFromU8, unzipSync } from "fflate";

import {
  matchedAcousticTerms,
  normalizeText,
  relevantSector,
  scoreOpportunity,
} from "./policy.ts";
import type {
  PlanningClassification,
  PlanningDocumentEvidence,
  TenderOpportunity,
} from "./types.ts";

const dccPublicAccessOrigin = "https://webapps.dublincity.ie";
const dccPublicAccessRoot = `${dccPublicAccessOrigin}/PublicAccess_Live`;
const maxDocumentBytes = 20 * 1024 * 1024;
const maxApplicationBytes = 100 * 1024 * 1024;
const documentConcurrency = 3;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type DccDocumentDescriptor = {
  id: string;
  documentType: string;
  description: string;
  receivedAt?: string;
  sourceUrl: string;
};

type DccDocumentIndexModel = {
  Rows?: Array<{
    Guid?: unknown;
    Doc_Type?: unknown;
    Doc_Ref2?: unknown;
    Date_Received?: unknown;
  }>;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applicationIndexUrl(reference: string) {
  return `${dccPublicAccessRoot}/SearchResult/RunThirdPartySearch?FileSystemId=PL&Folder1_Ref=${encodeURIComponent(reference)}`;
}

export function parseDccDocumentIndex(html: string): DccDocumentDescriptor[] {
  const match = html.match(/\bvar\s+model\s*=\s*([\s\S]+?);\s*var\s+data\s*=/i);
  if (!match) throw new Error("DCC-document-index-model-missing");
  let model: DccDocumentIndexModel;
  try {
    model = JSON.parse(match[1]) as DccDocumentIndexModel;
  } catch {
    throw new Error("DCC-document-index-model-invalid");
  }
  return (model.Rows ?? []).flatMap((row) => {
    const id = normalizeText(row.Guid);
    if (!/^[a-f0-9]{20,}$/i.test(id)) return [];
    return [{
      id,
      documentType: normalizeText(row.Doc_Type) || "Planning document",
      description: normalizeText(row.Doc_Ref2),
      receivedAt: normalizeText(row.Date_Received) || undefined,
      sourceUrl: `${dccPublicAccessRoot}/Document/ViewDocument?id=${encodeURIComponent(id)}`,
    }];
  });
}

export function isDccEvidenceDocument(document: DccDocumentDescriptor) {
  const label = `${document.documentType} ${document.description}`.toLowerCase();
  return [
    /decision notice/,
    /planner'?s report/,
    /manager'?s order/,
    /request.*(?:further|additional).*information/,
    /(?:further|additional).*information.*request/,
    /abp (?:order|inspector'?s report)/,
    /appeal.*(?:decision|order|inspector)/,
    /refusal reason/,
  ].some((pattern) => pattern.test(label));
}

function documentKind(document: DccDocumentDescriptor) {
  const label = `${document.documentType} ${document.description}`.toLowerCase();
  if (/request.*(?:further|additional).*information|(?:further|additional).*information.*request/.test(label)) {
    return "rfi" as const;
  }
  if (/decision notice|manager'?s order|abp order|appeal.*(?:decision|order)/.test(label)) {
    return "decision" as const;
  }
  if (/planner'?s report|inspector'?s report/.test(label)) return "report" as const;
  return "other" as const;
}

function evidenceWindows(text: string) {
  const normalized = normalizeText(text);
  const lower = normalized.toLowerCase();
  const windows: string[] = [];
  for (const keyword of matchedAcousticTerms(normalized)) {
    const expression = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "gi");
    for (const match of lower.matchAll(expression)) {
      const index = match.index ?? 0;
      windows.push(normalized.slice(Math.max(0, index - 350), Math.min(normalized.length, index + 750)));
    }
  }
  return windows;
}

function documentOutcome(text: string) {
  const heading = normalizeText(text).slice(0, 5_000).toLowerCase();
  const refusalMarkers = [
    "notification of decision to refuse",
    "decision to refuse",
    "permission is refused",
    "permission has been refused",
  ];
  const grantMarkers = [
    "notification of decision to grant",
    "decision to grant",
    "permission is granted",
    "permission has been granted",
    "grant permission",
  ];
  const firstRefusal = Math.min(...refusalMarkers.map((marker) => {
    const index = heading.indexOf(marker);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  }));
  const firstGrant = Math.min(...grantMarkers.map((marker) => {
    const index = heading.indexOf(marker);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  }));
  if (firstRefusal < firstGrant) return "refused" as const;
  if (firstGrant < firstRefusal) return "granted" as const;
  return undefined;
}

export function classifyDccDocumentText(
  document: DccDocumentDescriptor,
  text: string,
): { classification?: PlanningClassification; excerpt?: string; matchedTerms: string[] } {
  const matchedTerms = [...matchedAcousticTerms(text)];
  if (matchedTerms.length === 0) return { matchedTerms };
  const windows = evidenceWindows(text);
  const kind = documentKind(document);
  if (kind === "rfi") {
    return {
      classification: "noise-related-rfi",
      excerpt: windows[0],
      matchedTerms,
    };
  }

  if (kind === "decision") {
    const outcome = documentOutcome(text);
    if (outcome === "refused") {
      const excerpt = windows.find((window) => /refus|reason/.test(window.toLowerCase()));
      if (excerpt) return { classification: "refused-on-noise-grounds", excerpt, matchedTerms };
    }
    if (outcome === "granted") {
      const excerpt = windows.find((window) =>
        /condition|shall|subject to|reason:|noise limit|acoustic report|noise impact/.test(window.toLowerCase()),
      );
      if (excerpt) return { classification: "granted-with-noise-conditions", excerpt, matchedTerms };
    }
  }
  return { excerpt: windows[0], matchedTerms };
}

function textFromDocx(bytes: Uint8Array) {
  const documentXml = unzipSync(bytes)["word/document.xml"];
  if (!documentXml) throw new Error("DOCX-document-xml-missing");
  return strFromU8(documentXml)
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

async function textFromPdf(bytes: Uint8Array) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
      page.cleanup();
    }
    return pages.join("\n");
  } finally {
    await pdf.destroy();
  }
}

export async function extractDccDocumentText(contentType: string, bytes: Uint8Array) {
  const type = contentType.toLowerCase();
  if (type.includes("pdf") || String.fromCharCode(...bytes.slice(0, 4)) === "%PDF") {
    return textFromPdf(bytes);
  }
  if (type.includes("wordprocessingml") || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    return textFromDocx(bytes);
  }
  if (type.startsWith("text/")) return new TextDecoder().decode(bytes);
  throw new Error(`unsupported-document-type:${contentType || "unknown"}`);
}

async function readBoundedResponse(response: Response, remainingBytes: number) {
  const limit = Math.min(maxDocumentBytes, remainingBytes);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > limit) throw new Error(`document-too-large:${declaredLength}`);
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new Error(`document-too-large:${bytes.byteLength}`);
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error(`document-too-large:${total}`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseReceivedAt(value?: string) {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function mapConcurrent<T, U>(items: T[], concurrency: number, worker: (item: T) => Promise<U>) {
  const output = new Array<U>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  }));
  return output;
}

export async function fetchDccApplicationEvidence(
  reference: string,
  fetcher: FetchLike = fetch,
): Promise<{ applicationUrl: string; documents: PlanningDocumentEvidence[]; error?: string }> {
  const applicationUrl = applicationIndexUrl(reference);
  let indexResponse: Response;
  try {
    indexResponse = await fetcher(applicationUrl, {
      headers: { "User-Agent": "Helmonic-Tender-Intelligence/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    return { applicationUrl, documents: [], error: `document-index-unavailable:${error instanceof Error ? error.message : "unknown"}` };
  }
  if (!indexResponse.ok) return { applicationUrl, documents: [], error: `document-index-http-${indexResponse.status}` };

  let candidates: DccDocumentDescriptor[];
  try {
    candidates = parseDccDocumentIndex(await indexResponse.text())
      .filter(isDccEvidenceDocument)
      .sort((a, b) => parseReceivedAt(b.receivedAt) - parseReceivedAt(a.receivedAt));
  } catch (error) {
    return { applicationUrl, documents: [], error: error instanceof Error ? error.message : "document-index-invalid" };
  }
  if (candidates.length === 0) return { applicationUrl, documents: [], error: "no-relevant-planning-documents-listed" };

  let consumedBytes = 0;
  const documents = await mapConcurrent(candidates, documentConcurrency, async (document) => {
    try {
      if (consumedBytes >= maxApplicationBytes) throw new Error("application-download-budget-exhausted");
      const response = await fetcher(document.sourceUrl, {
        headers: { "User-Agent": "Helmonic-Tender-Intelligence/1.0" },
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`document-http-${response.status}`);
      const bytes = await readBoundedResponse(response, maxApplicationBytes - consumedBytes);
      consumedBytes += bytes.byteLength;
      const text = normalizeText(await extractDccDocumentText(response.headers.get("content-type") || "", bytes));
      if (!text) throw new Error("document-has-no-extractable-text");
      const classified = classifyDccDocumentText(document, text);
      return {
        id: document.id,
        documentType: document.documentType,
        description: document.description || undefined,
        receivedAt: document.receivedAt,
        sourceUrl: document.sourceUrl,
        fetchStatus: "fetched" as const,
        matchedTerms: classified.matchedTerms,
        excerpt: classified.excerpt,
        classification: classified.classification,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "document-fetch-failed";
      return {
        id: document.id,
        documentType: document.documentType,
        description: document.description || undefined,
        receivedAt: document.receivedAt,
        sourceUrl: document.sourceUrl,
        fetchStatus: message.startsWith("unsupported-document-type") ? "unsupported" as const : "unavailable" as const,
        matchedTerms: [],
        error: message,
      };
    }
  });
  return { applicationUrl, documents };
}

function chooseConfirmedEvidence(documents: PlanningDocumentEvidence[]) {
  return documents
    .filter((document) => document.classification)
    .sort((a, b) => parseReceivedAt(b.receivedAt) - parseReceivedAt(a.receivedAt))[0];
}

export async function enrichDccPlanningOpportunity(
  opportunity: TenderOpportunity,
  fetcher: FetchLike = fetch,
): Promise<TenderOpportunity> {
  const reference = opportunity.projectReference || opportunity.sourceRecordId.split(":").at(-1) || "";
  if (!reference) return opportunity;
  const evidence = await fetchDccApplicationEvidence(reference, fetcher);
  const fetchedDocuments = evidence.documents.filter((document) => document.fetchStatus === "fetched");
  const confirmed = chooseConfirmedEvidence(fetchedDocuments);

  if (fetchedDocuments.length === 0) {
    const reason = evidence.error || evidence.documents.map((document) => document.error).filter(Boolean).join("; ") || "planning-documents-unavailable";
    const result: TenderOpportunity = {
      ...opportunity,
      sourceUrl: evidence.applicationUrl,
      evidenceStatus: "evidence-unavailable",
      evidenceDocuments: evidence.documents,
      evidenceUnavailableReason: reason,
      classification: "needs-council-evidence",
      fitScore: 0,
    };
    result.fitScore = scoreOpportunity(result);
    return result;
  }

  const matchedTerms = [...new Set(fetchedDocuments.flatMap((document) => document.matchedTerms))];
  const result: TenderOpportunity = {
    ...opportunity,
    sourceUrl: confirmed?.sourceUrl || evidence.applicationUrl,
    evidenceStatus: "official-text",
    evidenceDocuments: evidence.documents,
    evidenceUnavailableReason: evidence.documents.some((document) => document.fetchStatus !== "fetched")
      ? "Some listed planning documents could not be extracted; see document audit."
      : undefined,
    evidenceExcerpt: confirmed?.excerpt,
    classification: confirmed?.classification ?? (
      relevantSector(opportunity.description)
        ? "design-construction-potential"
        : "no-relevant-opportunity"
    ),
    matchedTerms,
    fitScore: 0,
  };
  result.fitScore = scoreOpportunity(result);
  return result;
}

export async function enrichDccPlanningOpportunities(
  records: TenderOpportunity[],
  fetcher: FetchLike = fetch,
) {
  const cache = new Map<string, Promise<TenderOpportunity>>();
  return mapConcurrent(records, 2, async (record) => {
    const isDccPlanningRecord = record.type === "planning-pipeline-lead" && (
      record.sourceSystem === "DCC" || /dublin city council/i.test(record.planningAuthority ?? "")
    );
    if (!isDccPlanningRecord) return record;
    const reference = record.projectReference || record.sourceRecordId.split(":").at(-1) || record.sourceRecordId;
    let pending = cache.get(reference.toLowerCase());
    if (!pending) {
      pending = enrichDccPlanningOpportunity(record, fetcher);
      cache.set(reference.toLowerCase(), pending);
    }
    const enriched = await pending;
    return { ...record, ...enriched, id: record.id, sourceSystem: record.sourceSystem };
  });
}
