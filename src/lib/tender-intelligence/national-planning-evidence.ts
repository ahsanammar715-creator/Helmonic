import {
  classifyDccDocumentText,
  extractDccDocumentText,
  isDccEvidenceDocument,
  type DccDocumentDescriptor,
} from "./dcc-document-evidence.ts";
import { normalizeText, relevantSector, scoreOpportunity } from "./policy.ts";
import type { LeadParty, PlanningClassification, PlanningDocumentEvidence, TenderOpportunity } from "./types.ts";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const userAgent = "Helmonic-Tender-Intelligence/1.0";
const agileIdentity = "https://identity.agileapplications.ie";
const agileApi = "https://planningapi.agileapplications.ie/api";
const maxDocumentBytes = 20 * 1024 * 1024;

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function htmlText(value: string) {
  return normalizeText(decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")));
}

function absoluteUrl(href: string, base: string) {
  return new URL(decodeHtml(href.trim()), base).toString();
}

function evidenceDescriptor(id: string, label: string, sourceUrl: string): DccDocumentDescriptor {
  return { id, documentType: label, description: label, sourceUrl };
}

function officialJsonText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return normalizeText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return normalizeText(value.map(officialJsonText).join(" "));
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return normalizeText(Object.entries(record)
      .filter(([key]) => /text|description|reason|condition|request|comment|decision|title|name/i.test(key))
      .map(([, item]) => officialJsonText(item))
      .join(" "));
  }
  return "";
}

async function fetchJson(fetcher: FetchLike, url: string, headers: HeadersInit) {
  const response = await fetcher(url, {
    headers,
    signal: AbortSignal.timeout(35_000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`http-${response.status}`);
  return response.json() as Promise<unknown>;
}

function agileClientSlug(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    if (!/planning\.agileapplications\.ie$/i.test(url.hostname)) return undefined;
    return url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  } catch {
    return undefined;
  }
}

function agileApplicationId(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    const match = url.pathname.match(/\/application-details\/(\d+)\/?$/i);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringField(record: Record<string, unknown> | undefined, names: string[]) {
  for (const name of names) {
    const value = normalizeText(record?.[name]);
    if (value) return value;
  }
  return "";
}

function agileParties(application: unknown): LeadParty[] {
  const record = asRecord(application);
  if (!record) return [];
  const output: LeadParty[] = [];
  const applicant = stringField(record, ["applicantName", "applicantSurname", "applicantOrganisation"]);
  if (applicant) output.push({ name: applicant, role: "applicant", email: stringField(record, ["applicantEmail"]) || undefined });
  const agent = stringField(record, ["agentName", "agentSurname", "agentOrganisation", "agentCompany"]);
  if (agent) output.push({ name: agent, role: "agent", email: stringField(record, ["agentEmail"]) || undefined });
  return output;
}

async function agileCouncilEvidence(record: TenderOpportunity, fetcher: FetchLike) {
  const slug = agileClientSlug(record.sourceUrl);
  const applicationId = agileApplicationId(record.sourceUrl);
  if (!slug) return { documents: [] as PlanningDocumentEvidence[], parties: [] as LeadParty[], error: "not-an-agile-council-url" };
  if (!applicationId) return { documents: [] as PlanningDocumentEvidence[], parties: [] as LeadParty[], error: "agile-application-id-not-present-in-public-url" };

  const clientResponse = await fetcher(`${agileIdentity}/api/client/get?url=${encodeURIComponent(slug)}`, {
    headers: { Origin: "https://planning.agileapplications.ie", "User-Agent": userAgent },
    signal: AbortSignal.timeout(20_000),
  });
  if (!clientResponse.ok) return { documents: [] as PlanningDocumentEvidence[], parties: [] as LeadParty[], error: `agile-client-http-${clientResponse.status}` };
  const client = asRecord(await clientResponse.json());
  const clientCode = stringField(client, ["code"]);
  if (!clientCode) return { documents: [] as PlanningDocumentEvidence[], parties: [] as LeadParty[], error: "agile-client-code-missing" };
  const headers = {
    "x-client": clientCode,
    "x-service": "PA",
    "x-product": "CITIZENPORTAL",
    Origin: "https://planning.agileapplications.ie",
    "User-Agent": userAgent,
  };

  let application: unknown;
  try {
    application = await fetchJson(fetcher, `${agileApi}/application/${encodeURIComponent(applicationId)}`, headers);
  } catch (error) {
    return { documents: [] as PlanningDocumentEvidence[], parties: [] as LeadParty[], error: `agile-application-${error instanceof Error ? error.message : "unavailable"}` };
  }

  const documents: PlanningDocumentEvidence[] = [];
  const endpointLabels = [
    ["further-info", "Request for Further Information"],
    ["conditions", "Decision conditions"],
  ] as const;
  for (const [endpoint, label] of endpointLabels) {
    const sourceUrl = `${agileApi}/application/${encodeURIComponent(applicationId)}/${endpoint}`;
    try {
      const payload = await fetchJson(fetcher, sourceUrl, headers);
      const text = officialJsonText(payload);
      if (!text) continue;
      const descriptor = evidenceDescriptor(`${clientCode}:${applicationId}:${endpoint}`, label, sourceUrl);
      const classified = classifyDccDocumentText(descriptor, text);
      documents.push({
        ...descriptor,
        fetchStatus: "fetched",
        matchedTerms: classified.matchedTerms,
        excerpt: classified.excerpt,
        classification: classified.classification,
      });
    } catch (error) {
      documents.push({
        id: `${clientCode}:${applicationId}:${endpoint}`,
        documentType: label,
        sourceUrl,
        fetchStatus: "unavailable",
        matchedTerms: [],
        error: error instanceof Error ? error.message : "endpoint-unavailable",
      });
    }
  }

  const documentIndexUrl = `${agileApi}/application/${encodeURIComponent(applicationId)}/document`;
  try {
    const payload = await fetchJson(fetcher, documentIndexUrl, headers);
    const rows = Array.isArray(payload) ? payload : [];
    for (const item of rows) {
      const document = asRecord(item);
      const id = stringField(document, ["id", "documentId", "guid"]);
      const label = stringField(document, ["description", "documentType", "type", "name", "fileName"]) || "Planning document";
      if (!id || !isDccEvidenceDocument(evidenceDescriptor(id, label, documentIndexUrl))) continue;
      const sourceUrl = `${agileApi}/application/document/${encodeURIComponent(clientCode)}/${encodeURIComponent(id)}`;
      try {
        const response = await fetcher(sourceUrl, { headers, signal: AbortSignal.timeout(45_000), redirect: "follow" });
        if (!response.ok) throw new Error(`document-http-${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > maxDocumentBytes) throw new Error(`document-too-large:${bytes.byteLength}`);
        const text = normalizeText(await extractDccDocumentText(response.headers.get("content-type") ?? "", bytes));
        if (!text) throw new Error("document-has-no-extractable-text");
        const descriptor = evidenceDescriptor(id, label, sourceUrl);
        const classified = classifyDccDocumentText(descriptor, text);
        documents.push({ ...descriptor, fetchStatus: "fetched", ...classified });
      } catch (error) {
        documents.push({
          id,
          documentType: label,
          sourceUrl,
          fetchStatus: "unavailable",
          matchedTerms: [],
          error: error instanceof Error ? error.message : "document-unavailable",
        });
      }
    }
  } catch (error) {
    documents.push({
      id: `${clientCode}:${applicationId}:document-index`,
      documentType: "Application document index",
      sourceUrl: documentIndexUrl,
      fetchStatus: "unavailable",
      matchedTerms: [],
      error: error instanceof Error ? error.message : "document-index-unavailable",
    });
  }

  return { documents, parties: agileParties(application) };
}

export type EplanningDocumentRow = DccDocumentDescriptor;

export function parseEplanningDocumentRows(html: string, baseUrl: string): EplanningDocumentRow[] {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  return rows.flatMap((match) => {
    const row = match[1];
    const link = row.match(/href=['"]([^'"]*ViewFiles\.aspx\?[^'"]+)['"]/i)?.[1];
    if (!link) return [];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => htmlText(cell[1]));
    const id = cells[0] || link.match(/docid=(\d+)/i)?.[1] || link;
    const documentType = cells[1] || "Planning document";
    const description = cells[2] || documentType;
    return [{ id, documentType, description, sourceUrl: absoluteUrl(link, baseUrl) }];
  });
}

function eplanningParties(html: string): LeadParty[] {
  const output: LeadParty[] = [];
  for (const [div, role] of [["DivApplicants", "applicant"], ["DivAgents", "agent"]] as const) {
    const section = html.match(new RegExp(`<div[^>]+id=["']${div}["'][^>]*>([\\s\\S]*?)<\\/div>`, "i"))?.[1];
    const name = section?.match(/<th[^>]*>\s*Name\s*:?\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i)?.[1];
    const normalized = name ? htmlText(name) : "";
    if (normalized) output.push({ name: normalized, role });
  }
  return output;
}

async function eplanningCouncilEvidence(record: TenderOpportunity, fetcher: FetchLike) {
  const response = await fetcher(record.sourceUrl.replace(/^http:/i, "https:"), {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
  });
  if (!response.ok) return { documents: [] as PlanningDocumentEvidence[], parties: [] as LeadParty[], error: `eplanning-application-http-${response.status}` };
  const applicationHtml = await response.text();
  const idocsHref = applicationHtml.match(/https?:\/\/[^'"\s]+\/iDocsWeb(?:DPSS)?\/(?:listFiles|copyright)\.aspx\?[^'"]+/i)?.[0];
  if (!idocsHref) return { documents: [] as PlanningDocumentEvidence[], parties: eplanningParties(applicationHtml), error: "eplanning-document-index-link-missing" };
  const documentIndexUrl = decodeHtml(idocsHref).trim().replace(/copyright\.aspx/i, "listFiles.aspx");
  const indexResponse = await fetcher(documentIndexUrl, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
  });
  if (!indexResponse.ok) return { documents: [] as PlanningDocumentEvidence[], parties: eplanningParties(applicationHtml), error: `eplanning-document-index-http-${indexResponse.status}` };
  const rows = parseEplanningDocumentRows(await indexResponse.text(), documentIndexUrl).filter(isDccEvidenceDocument);
  if (rows.length === 0) return { documents: [] as PlanningDocumentEvidence[], parties: eplanningParties(applicationHtml), error: "no-relevant-planning-documents-listed" };
  const documents: PlanningDocumentEvidence[] = [];
  for (const descriptor of rows) {
    try {
      const documentResponse = await fetcher(descriptor.sourceUrl, {
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(45_000),
        redirect: "follow",
      });
      if (!documentResponse.ok) throw new Error(`document-http-${documentResponse.status}`);
      const bytes = new Uint8Array(await documentResponse.arrayBuffer());
      if (bytes.byteLength > maxDocumentBytes) throw new Error(`document-too-large:${bytes.byteLength}`);
      const contentType = documentResponse.headers.get("content-type") ?? "";
      // The legacy iDocs viewer often returns a JavaScript/DjVu shell instead
      // of the source document. That is not usable evidence and must fail closed.
      if (/html/i.test(contentType)) throw new Error("legacy-idocs-viewer-has-no-extractable-source-document");
      const text = normalizeText(await extractDccDocumentText(contentType, bytes));
      const classified = classifyDccDocumentText(descriptor, text);
      documents.push({ ...descriptor, fetchStatus: "fetched", ...classified });
    } catch (error) {
      const message = error instanceof Error ? error.message : "document-unavailable";
      documents.push({
        ...descriptor,
        fetchStatus: message.includes("no-extractable") || message.startsWith("unsupported-document-type") ? "unsupported" : "unavailable",
        matchedTerms: [],
        error: message,
      });
    }
  }
  return { documents, parties: eplanningParties(applicationHtml) };
}

function chooseConfirmed(documents: PlanningDocumentEvidence[]) {
  return documents.find((document) => document.classification === "noise-related-rfi")
    ?? documents.find((document) => document.classification === "granted-with-noise-conditions")
    ?? documents.find((document) => document.classification === "refused-on-noise-grounds");
}

export async function enrichNationalPlanningOpportunity(
  record: TenderOpportunity,
  fetcher: FetchLike = fetch,
): Promise<TenderOpportunity> {
  if (record.sourceSystem !== "National Planning Register") return record;
  let result: { documents: PlanningDocumentEvidence[]; parties: LeadParty[]; error?: string };
  try {
    if (/planning\.agileapplications\.ie/i.test(record.sourceUrl)) result = await agileCouncilEvidence(record, fetcher);
    else if (/eplanning\.ie/i.test(record.sourceUrl)) result = await eplanningCouncilEvidence(record, fetcher);
    else result = { documents: [], parties: [], error: "unsupported-council-document-portal" };
  } catch (error) {
    result = { documents: [], parties: [], error: error instanceof Error ? error.message : "council-document-retrieval-failed" };
  }

  const confirmed = chooseConfirmed(result.documents);
  if (confirmed) {
    const enriched = {
      ...record,
      parties: [...(record.parties ?? []), ...result.parties],
      applicant: result.parties.find((party) => party.role === "applicant")?.name ?? record.applicant,
      evidenceStatus: "official-text" as const,
      evidenceDocuments: result.documents,
      evidenceExcerpt: confirmed.excerpt,
      evidenceUnavailableReason: undefined,
      sourceUrl: confirmed.sourceUrl,
      classification: confirmed.classification,
      matchedTerms: confirmed.matchedTerms,
    };
    return { ...enriched, fitScore: scoreOpportunity(enriched) };
  }

  const fetched = result.documents.filter((document) => document.fetchStatus === "fetched");
  if (fetched.length > 0) {
    const classification: PlanningClassification = relevantSector(record.description)
      ? "design-construction-potential"
      : "no-relevant-opportunity";
    const enriched = {
      ...record,
      parties: [...(record.parties ?? []), ...result.parties],
      evidenceStatus: "official-text" as const,
      evidenceDocuments: result.documents,
      evidenceExcerpt: fetched[0].excerpt,
      evidenceUnavailableReason: undefined,
      classification,
      matchedTerms: [...new Set(fetched.flatMap((document) => document.matchedTerms))],
    };
    return { ...enriched, fitScore: scoreOpportunity(enriched) };
  }

  return {
    ...record,
    parties: [...(record.parties ?? []), ...result.parties],
    evidenceStatus: "evidence-unavailable",
    evidenceDocuments: result.documents,
    evidenceExcerpt: undefined,
    evidenceUnavailableReason: result.error
      ?? result.documents.map((document) => document.error).filter(Boolean).join("; ")
      ?? "council-document-evidence-unavailable",
    classification: "needs-council-evidence",
    matchedTerms: [],
    fitScore: scoreOpportunity({ ...record, classification: "needs-council-evidence", matchedTerms: [] }),
  };
}

export async function enrichNationalPlanningOpportunities(
  records: TenderOpportunity[],
  options: { fetcher?: FetchLike; limit?: number; concurrency?: number } = {},
) {
  const fetcher = options.fetcher ?? fetch;
  const limit = Math.max(0, options.limit ?? records.length);
  const candidates = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.sourceSystem === "National Planning Register")
    .slice(0, limit);
  const output = [...records];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 3, candidates.length) }, async () => {
    while (true) {
      const current = next;
      next += 1;
      if (current >= candidates.length) return;
      const candidate = candidates[current];
      output[candidate.index] = await enrichNationalPlanningOpportunity(candidate.record, fetcher);
    }
  }));
  return output;
}
