import "server-only";

import type { ConsultCitation } from "@/lib/consult/types";
import { buildControlledSearchRequest } from "@/lib/consult/search-policy";
import { getAzureAccessToken } from "@/lib/server/azure-credential";
import type { RuntimeConfig } from "@/lib/server/config";

type SearchDocument = {
  "@search.score"?: number;
  chunk_id?: string;
  source_id?: string;
  source_uri?: string;
  title?: string;
  section?: string;
  page_number?: number;
  content?: string;
};

type SearchResponse = {
  value?: SearchDocument[];
};

function excerpt(value: string, maximumLength = 420) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maximumLength ? `${compact.slice(0, maximumLength - 1)}…` : compact;
}

function requireSearchConfig(config: RuntimeConfig) {
  if (!config.search.endpoint || !config.search.indexName) {
    throw new Error("Azure AI Search is not configured");
  }

  return {
    endpoint: config.search.endpoint,
    indexName: config.search.indexName,
  };
}

export async function searchConsultEvidence(
  question: string,
  requestId: string,
  config: RuntimeConfig,
) {
  const { endpoint, indexName } = requireSearchConfig(config);
  const token = await getAzureAccessToken("https://search.azure.com/.default");
  const response = await fetch(
    `${endpoint}/indexes/${encodeURIComponent(indexName)}/docs/search?api-version=${encodeURIComponent(
      config.search.apiVersion,
    )}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-ms-client-request-id": requestId,
      },
      body: JSON.stringify(
        buildControlledSearchRequest(question, config.profile, config.search.top),
      ),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Azure AI Search query failed with status ${response.status}`);
  }

  const payload = (await response.json()) as SearchResponse;

  return (payload.value ?? [])
    .filter((document) => document.content && document.source_id)
    .map<ConsultCitation>((document, index) => ({
      id: document.chunk_id ?? `citation-${index + 1}`,
      title: document.title ?? document.source_id ?? `Source ${index + 1}`,
      sourceId: document.source_id ?? `source-${index + 1}`,
      section: document.section || undefined,
      pageNumber:
        typeof document.page_number === "number" ? document.page_number : undefined,
      excerpt: excerpt(document.content ?? ""),
      sourceUri: document.source_uri || undefined,
      score:
        typeof document["@search.score"] === "number"
          ? document["@search.score"]
          : undefined,
    }));
}

export async function countSearchDocuments(config: RuntimeConfig) {
  const { endpoint, indexName } = requireSearchConfig(config);
  const token = await getAzureAccessToken("https://search.azure.com/.default");
  const response = await fetch(
    `${endpoint}/indexes/${encodeURIComponent(indexName)}/docs/$count?api-version=${encodeURIComponent(
      config.search.apiVersion,
    )}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-ms-client-request-id": crypto.randomUUID(),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(6_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Azure AI Search count failed with status ${response.status}`);
  }

  return Number.parseInt(await response.text(), 10);
}
