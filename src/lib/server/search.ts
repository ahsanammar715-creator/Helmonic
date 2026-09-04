import "server-only";

import type { ConsultCitation } from "@/lib/consult/types";
import {
  buildControlledEvidenceExcerpt,
  buildControlledHybridSearchRequest,
  buildControlledSearchRequest,
  retainRelevantHybridDocuments,
} from "@/lib/consult/search-policy";
import { getAzureAccessToken } from "@/lib/server/azure-credential";
import type { RuntimeConfig } from "@/lib/server/config";

type SearchDocument = {
  "@search.score"?: number;
  "@search.rerankerScore"?: number;
  chunk_id?: string;
  source_id?: string;
  source_uri?: string;
  title?: string;
  section?: string;
  page_number?: number;
  content?: string;
  chunk_kind?: string;
  document_id?: string;
};

type SearchResponse = {
  value?: SearchDocument[];
};

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
  const queryEmbedding = config.search.hybridEnabled
    ? await import("@/lib/server/embeddings").then(({ createQueryEmbedding }) =>
        createQueryEmbedding(question, requestId, config),
      )
    : null;
  const searchRequest = queryEmbedding
    ? buildControlledHybridSearchRequest(
        question,
        config.profile,
        config.search.top,
        queryEmbedding,
        {
          vectorK: config.search.vectorK,
          semanticConfiguration: config.search.semanticEnabled
            ? config.search.semanticConfiguration
            : undefined,
        },
      )
    : buildControlledSearchRequest(question, config.profile, config.search.top);
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
      body: JSON.stringify(searchRequest),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Azure AI Search query failed with status ${response.status}`);
  }

  const payload = (await response.json()) as SearchResponse;
  const retrievedDocuments = payload.value ?? [];
  const relevantDocuments = config.search.hybridEnabled
    ? retainRelevantHybridDocuments(retrievedDocuments, {
        scoreKind: config.search.semanticEnabled ? "semantic" : "rrf",
        minimumScore: config.search.semanticEnabled
          ? config.search.minimumSemanticScore
          : config.search.minimumRrfScore,
      })
    : retrievedDocuments;
  if (config.search.hybridEnabled) {
    console.info("Helmonic hybrid retrieval", {
      requestId,
      retrievedCount: retrievedDocuments.length,
      retainedCount: relevantDocuments.length,
      scoreKind: config.search.semanticEnabled ? "semantic" : "rrf",
      minimumScore: config.search.semanticEnabled
        ? config.search.minimumSemanticScore
        : config.search.minimumRrfScore,
    });
  }

  return relevantDocuments
    .filter((document) => document.content && document.source_id)
    .map<ConsultCitation>((document, index) => ({
      id: document.chunk_id ?? `citation-${index + 1}`,
      title: document.title ?? document.source_id ?? `Source ${index + 1}`,
      sourceId: document.source_id ?? `source-${index + 1}`,
      section: document.section || undefined,
      pageNumber:
        typeof document.page_number === "number" ? document.page_number : undefined,
      excerpt: buildControlledEvidenceExcerpt(document.content ?? "", document.chunk_kind),
      sourceUri: document.source_uri || undefined,
      score:
        typeof document["@search.score"] === "number"
          ? document["@search.score"]
          : undefined,
      sourceType: "controlled",
      marker: `D${index + 1}`,
    }));
}

export async function searchSessionEvidence(
  question: string,
  ownerObjectId: string,
  conversationId: string,
  requestId: string,
  config: RuntimeConfig,
) {
  const endpoint = config.search.endpoint;
  const indexName = config.phase1b.sessionSearchIndex;
  if (!endpoint || !indexName) return [];

  const token = await getAzureAccessToken("https://search.azure.com/.default");
  const owner = ownerObjectId.replace(/'/g, "''");
  const conversation = conversationId.replace(/'/g, "''");
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
      body: JSON.stringify({
        search: question.trim(),
        queryType: "simple",
        searchMode: "all",
        searchFields: "title,section,content",
        filter:
          `owner_object_id eq '${owner}' and conversation_id eq '${conversation}' ` +
          "and source_type eq 'session_attachment' and is_active eq true",
        top: config.search.top,
        select:
          "chunk_id,document_id,source_uri,title,section,page_number,content",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Azure AI Search session query failed with status ${response.status}`);
  }

  const payload = (await response.json()) as SearchResponse;
  return (payload.value ?? [])
    .filter((document) => document.content && document.document_id)
    .map<ConsultCitation>((document, index) => ({
      id: document.chunk_id ?? `attachment-citation-${index + 1}`,
      title: document.title ?? `Conversation attachment ${index + 1}`,
      sourceId: document.document_id ?? `attachment-${index + 1}`,
      section: document.section || undefined,
      pageNumber:
        typeof document.page_number === "number" ? document.page_number : undefined,
      excerpt: buildControlledEvidenceExcerpt(document.content ?? ""),
      sourceUri: document.source_uri || undefined,
      score:
        typeof document["@search.score"] === "number"
          ? document["@search.score"]
          : undefined,
      sourceType: "attachment",
      marker: `A${index + 1}`,
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
