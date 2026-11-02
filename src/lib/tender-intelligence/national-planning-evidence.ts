import {
  classifyDccDocumentText,
  extractDccDocument,
  extractRfiDocumentDates,
  isDccEvidenceDocument,
  isFurtherInformationRequestDocument,
  type DccDocumentDescriptor,
} from "./dcc-document-evidence.ts";
import { normalizeText, relevantSector, scoreOpportunity } from "./policy.ts";
import { isFurtherInformationStage, isRfiClassification, rfiResponseDueAt } from "./rfi.ts";
import type { LeadParty, PlanningClassification, PlanningDocumentEvidence, TenderOpportunity } from "./types.ts";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const userAgent = "Helmonic-Tender-Intelligence/1.0";
const agileIdentity = "https://identity.agileapplications.ie";
const agileApi = "https://planningapi.agileapplications.ie/api";
const maxDocumentBytes = 20 * 1024 * 1024;

function setCookieHeaders(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);
}

function createCookieSession(fetcher: FetchLike) {
  const cookies = new Map<string, Map<string, string>>();
  return {
    async fetch(input: string | URL, init: RequestInit = {}) {
      const url = new URL(input);
      const headers = new Headers(init.headers);
      const stored = cookies.get(url.origin);
      if (stored?.size) headers.set("Cookie", [...stored].map(([name, value]) => `${name}=${value}`).join("; "));
      const response = await fetcher(url, { ...init, headers });
      for (const raw of setCookieHeaders(response)) {
        const pair = raw.split(";", 1)[0];
        const separator = pair.indexOf("=");
        if (separator <= 0) continue;
        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        const jar = cookies.get(url.origin) ?? new Map<string, string>();
        if (value) jar.set(name, value);
        else jar.delete(name);
        cookies.set(url.origin, jar);
      }
      return response;
    },
  };
}

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

function retainedOfficialExcerpt(text: string) {
  const normalized = normalizeText(text);
  const lower = normalized.toLowerCase();
  const anchors = [
    "apartment", "residential", "commercial", "retail", "school", "education",
    "hospital", "healthcare", "industrial", "mixed-use", "mixed use", "hotel",
    "hospitality", "data centre", "data center", "transport", "infrastructure",
  ];
  const indexes = anchors.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
  const index = indexes.length > 0 ? Math.min(...indexes) : 0;
  return normalized.slice(Math.max(0, index - 250), Math.min(normalized.length, index + 950));
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

function firstStringField(value: unknown, names: string[]) {
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    const result = stringField(asRecord(item), names);
    if (result) return result;
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
      const descriptor = {
        ...evidenceDescriptor(`${clientCode}:${applicationId}:${endpoint}`, label, sourceUrl),
        receivedAt: firstStringField(payload, [
          "requestDate", "dateRequested", "issuedDate", "dateIssued", "receivedDate", "dateReceived", "createdAt", "date",
        ]) || undefined,
      };
      const classified = classifyDccDocumentText(descriptor, text);
      const rfiDates = isRfiClassification(classified.classification)
        ? extractRfiDocumentDates(descriptor, text)
        : {};
      documents.push({
        ...descriptor,
        fetchStatus: "fetched",
        extractionMethod: "structured-api",
        matchedTerms: classified.matchedTerms,
        excerpt: classified.excerpt ?? retainedOfficialExcerpt(text),
        classification: classified.classification,
        ...rfiDates,
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
        const extracted = await extractDccDocument(response.headers.get("content-type") ?? "", bytes);
        const text = extracted.text;
        if (!normalizeText(text)) throw new Error("document-has-no-extractable-text");
        const descriptor = {
          ...evidenceDescriptor(id, label, sourceUrl),
          receivedAt: stringField(document, [
            "dateReceived", "receivedDate", "documentDate", "dateCreated", "createdAt", "uploadedAt", "date",
          ]) || undefined,
        };
        const classified = classifyDccDocumentText(descriptor, text);
        const rfiDates = isRfiClassification(classified.classification)
          ? extractRfiDocumentDates(descriptor, text)
          : {};
        documents.push({
          ...descriptor,
          fetchStatus: "fetched",
          extractionMethod: extracted.extractionMethod,
          ...classified,
          excerpt: classified.excerpt ?? retainedOfficialExcerpt(text),
          ...rfiDates,
        });
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
    const id = link.match(/docid=(\d+)/i)?.[1] || cells[0] || link;
    const offset = cells[0] === id ? 1 : 0;
    const documentType = cells[offset] || "Planning document";
    const description = cells[offset + 1] || documentType;
    return [{ id, documentType, description, sourceUrl: absoluteUrl(link, baseUrl) }];
  });
}

function hiddenFormValue(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeHtml(html.match(new RegExp(`name=["']${escaped}["'][^>]*value=["']([^"']*)["']`, "i"))?.[1] ?? "");
}

async function openEplanningDocumentIndex(fetcher: FetchLike, originalUrl: string) {
  const session = createCookieSession(fetcher);
  let documentIndexUrl = decodeHtml(originalUrl).trim();
  if (/\/copyright\.aspx\?/i.test(documentIndexUrl)) {
    const agreement = await session.fetch(documentIndexUrl, {
      headers: { "User-Agent": userAgent },
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    });
    if (!agreement.ok) throw new Error(`eplanning-copyright-http-${agreement.status}`);
    let html = await agreement.text();
    const common = () => ({
      __VIEWSTATE: hiddenFormValue(html, "__VIEWSTATE"),
      __VIEWSTATEGENERATOR: hiddenFormValue(html, "__VIEWSTATEGENERATOR"),
      __EVENTVALIDATION: hiddenFormValue(html, "__EVENTVALIDATION"),
    });
    const checked = await session.fetch(documentIndexUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: documentIndexUrl,
        "User-Agent": userAgent,
      },
      body: new URLSearchParams({ ...common(), __EVENTTARGET: "chkAgree", __EVENTARGUMENT: "", chkAgree: "on" }),
      signal: AbortSignal.timeout(30_000),
      redirect: "follow",
    });
    if (!checked.ok) throw new Error(`eplanning-copyright-agree-http-${checked.status}`);
    html = await checked.text();
    const viewFiles = await session.fetch(documentIndexUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: documentIndexUrl,
        "User-Agent": userAgent,
      },
      body: new URLSearchParams({ ...common(), chkAgree: "on", btnViewFiles: "View Files" }),
      signal: AbortSignal.timeout(30_000),
      redirect: "manual",
    });
    if (![301, 302, 303, 307, 308].includes(viewFiles.status)) {
      throw new Error(`eplanning-copyright-view-files-http-${viewFiles.status}`);
    }
    const location = viewFiles.headers.get("location");
    if (!location) throw new Error("eplanning-document-index-redirect-missing");
    documentIndexUrl = new URL(location, documentIndexUrl).toString();
  }
  const indexResponse = await session.fetch(documentIndexUrl, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
  });
  if (!indexResponse.ok) throw new Error(`eplanning-document-index-http-${indexResponse.status}`);
  return { session, documentIndexUrl, html: await indexResponse.text() };
}

function embeddedViewerUrl(html: string, baseUrl: string, pattern: RegExp) {
  const raw = html.match(pattern)?.[1];
  return raw ? absoluteUrl(raw.replaceAll("\\", "/").split("#", 1)[0], baseUrl) : undefined;
}

async function fetchEplanningDocument(
  session: ReturnType<typeof createCookieSession>,
  descriptor: EplanningDocumentRow,
  referer: string,
) {
  let response = await session.fetch(descriptor.sourceUrl, {
    headers: { "User-Agent": userAgent, Referer: referer },
    signal: AbortSignal.timeout(45_000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`document-http-${response.status}`);
  let contentType = response.headers.get("content-type") ?? "";
  if (!/html/i.test(contentType)) return { response, contentType };

  const viewerHtml = await response.text();
  const pdfViewerUrl = embeddedViewerUrl(
    viewerHtml,
    descriptor.sourceUrl,
    /<iframe[^>]+src=["']([^"']*ViewPdf\.aspx\?[^"']+)["']/i,
  );
  if (!pdfViewerUrl) throw new Error("legacy-idocs-viewer-source-missing");
  response = await session.fetch(pdfViewerUrl, {
    headers: { "User-Agent": userAgent, Referer: descriptor.sourceUrl },
    signal: AbortSignal.timeout(45_000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`document-pdf-viewer-http-${response.status}`);
  const pdfViewerHtml = await response.text();
  const pdfUrl = embeddedViewerUrl(
    pdfViewerHtml,
    pdfViewerUrl,
    /(?:<iframe[^>]+src|<a[^>]+href)=["']([^"']*[\\/]files[\\/][^"']+\.pdf(?:#[^"']*)?)["']/i,
  );
  if (!pdfUrl) throw new Error("legacy-idocs-pdf-source-missing");
  response = await session.fetch(pdfUrl, {
    headers: { "User-Agent": userAgent, Referer: pdfViewerUrl },
    signal: AbortSignal.timeout(45_000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`document-pdf-http-${response.status}`);
  contentType = response.headers.get("content-type") ?? "application/pdf";
  return { response, contentType };
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
  let opened: Awaited<ReturnType<typeof openEplanningDocumentIndex>>;
  try {
    opened = await openEplanningDocumentIndex(fetcher, idocsHref);
  } catch (error) {
    return {
      documents: [] as PlanningDocumentEvidence[],
      parties: eplanningParties(applicationHtml),
      error: error instanceof Error ? error.message : "eplanning-document-index-unavailable",
    };
  }
  const listed = parseEplanningDocumentRows(opened.html, opened.documentIndexUrl).filter(isDccEvidenceDocument);
  const rows = isFurtherInformationStage(record.projectStage ?? record.sourceStatus)
    ? (() => {
        const rfiLetters = listed.filter(isFurtherInformationRequestDocument);
        return rfiLetters.length > 0 ? rfiLetters : listed;
      })()
    : listed;
  if (rows.length === 0) return { documents: [] as PlanningDocumentEvidence[], parties: eplanningParties(applicationHtml), error: "no-relevant-planning-documents-listed" };
  const documents: PlanningDocumentEvidence[] = [];
  for (const descriptor of rows) {
    try {
      const { response: documentResponse, contentType } = await fetchEplanningDocument(
        opened.session,
        descriptor,
        opened.documentIndexUrl,
      );
      const bytes = new Uint8Array(await documentResponse.arrayBuffer());
      if (bytes.byteLength > maxDocumentBytes) throw new Error(`document-too-large:${bytes.byteLength}`);
      const extracted = await extractDccDocument(contentType, bytes);
      const text = extracted.text;
      if (!normalizeText(text)) throw new Error("document-has-no-extractable-text");
      const classified = classifyDccDocumentText(descriptor, text);
      const rfiDates = isRfiClassification(classified.classification)
        ? extractRfiDocumentDates(descriptor, text)
        : {};
      documents.push({
        ...descriptor,
        fetchStatus: "fetched",
        ...classified,
        extractionMethod: extracted.extractionMethod,
        excerpt: classified.excerpt ?? retainedOfficialExcerpt(text),
        ...rfiDates,
      });
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

function chooseConfirmed(documents: PlanningDocumentEvidence[], stage = "") {
  const normalizedStage = normalizeText(stage).toLowerCase();
  const order = /grant|condition|conditional/.test(normalizedStage)
    ? ["granted-with-noise-conditions", "noise-related-rfi", "further-information-request", "refused-on-noise-grounds"]
    : /refus/.test(normalizedStage)
      ? ["refused-on-noise-grounds", "noise-related-rfi", "further-information-request", "granted-with-noise-conditions"]
      : ["noise-related-rfi", "further-information-request", "granted-with-noise-conditions", "refused-on-noise-grounds"];
  return order.map((classification) =>
    documents.find((document) => document.classification === classification)).find(Boolean);
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

  const confirmed = chooseConfirmed(result.documents, record.projectStage ?? record.sourceStatus);
  if (confirmed) {
    const confirmedRfi = isRfiClassification(confirmed.classification);
    const confirmedRfiDateConfidence = confirmedRfi
      ? confirmed.rfiDateConfidence ?? record.rfiDateConfidence ?? "unavailable"
      : record.rfiDateConfidence;
    const enriched = {
      ...record,
      parties: [...(record.parties ?? []), ...result.parties],
      applicant: result.parties.find((party) => party.role === "applicant")?.name ?? record.applicant,
      evidenceStatus: "official-text" as const,
      evidenceDocuments: result.documents,
      evidenceExcerpt: confirmed.excerpt,
      evidenceUnavailableReason: undefined,
      // The source URL remains the public application page. Evidence PDF/API
      // links are kept in evidenceDocuments and displayed separately in Odoo.
      sourceUrl: record.sourceUrl,
      classification: confirmed.classification,
      matchedTerms: confirmed.matchedTerms,
      rfiPublishedAt: confirmedRfi
        ? confirmed.rfiPublishedAt ?? confirmed.receivedAt ?? record.rfiPublishedAt
        : record.rfiPublishedAt,
      rfiReceivedAt: confirmedRfi
        ? confirmed.receivedAt ?? confirmed.rfiPublishedAt ?? record.rfiReceivedAt
        : record.rfiReceivedAt,
      responseDeadline: confirmedRfi
        ? confirmed.responseDeadline ?? record.responseDeadline
        : record.responseDeadline,
      rfiDateSource: confirmedRfi
        ? confirmed.rfiDateSource ?? record.rfiDateSource
        : record.rfiDateSource,
      rfiDateConfidence: confirmedRfiDateConfidence,
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

function timestamp(value?: string) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function withinDays(value: string | undefined, now: Date, days: number) {
  const parsed = timestamp(value);
  if (parsed === undefined) return false;
  const age = now.getTime() - parsed;
  return age >= 0 && age <= days * 86_400_000;
}

function dueTodayOrLater(value: string | undefined, now: Date) {
  const parsed = timestamp(value);
  if (parsed === undefined) return false;
  const due = new Date(parsed);
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return dueDay >= currentDay;
}

/**
 * Select only records whose council documents can change the active sales
 * queue. Every live/undated RFI is included so acoustic wording can be read
 * from its FI Request Letter. Answered and expired RFIs stay in the durable
 * ledger but do not consume the current evidence-reading budget. Recent
 * grants receive a short evidence window so acoustic conditions can still be
 * discovered as the secondary primary category.
 */
export function shouldEnrichNationalPlanningEvidence(
  record: TenderOpportunity,
  now = new Date(),
  options: { grantLookbackDays?: number } = {},
): boolean {
  if (record.sourceSystem !== "National Planning Register" || record.cycleStatus === "resolved") return false;

  const stage = [record.projectStage, record.sourceStatus, record.triggerType].filter(Boolean).join(" ");
  const rfi = isRfiClassification(record.classification) || isFurtherInformationStage(stage);
  if (rfi) {
    if (record.rfiResponseReceivedAt) return false;
    const due = rfiResponseDueAt(record);
    return !due || dueTodayOrLater(due, now);
  }

  if (record.classification === "granted-with-noise-conditions" && record.evidenceStatus === "official-text") {
    return false;
  }

  const grantLookbackDays = Math.max(1, options.grantLookbackDays ?? 30);

  if (/grant|condition|conditional/i.test(stage)) {
    return [record.sourceUpdatedAt, record.sourceMajorUpdatedAt, record.lastSeenAt, record.publishedAt]
      .some((value) => withinDays(value, now, grantLookbackDays));
  }

  // A recent description-level acoustic hit is worth proving from the
  // council file even when the source stage wording is incomplete.
  if ((record.matchedTerms?.length ?? 0) > 0) {
    return [record.sourceUpdatedAt, record.sourceMajorUpdatedAt, record.lastSeenAt, record.publishedAt]
      .some((value) => withinDays(value, now, grantLookbackDays));
  }

  return false;
}
