import "server-only";

import {
  controlledCitationNamespace,
  nextControlledMarker,
  privateBookCitationAuditRecord,
  publicControlledCitation,
} from "@/lib/consult/citation-policy";
import { actorMayReadRestrictedEmailEvidence } from "@/lib/consult/email-evidence-policy";
import { buildRestrictedEmailSearchRequest } from "@/lib/consult/email-search-policy";
import type { ConsultCitation } from "@/lib/consult/types";
import {
  buildControlledEvidenceExcerpt,
  buildControlledHybridSearchRequest,
  buildControlledSearchRequest,
  extractProjectCodes,
  retainRelevantHybridDocuments,
} from "@/lib/consult/search-policy";
import {
  getAzureAccessToken,
  getAzureAccessTokenForClient,
} from "@/lib/server/azure-credential";
import {
  azureRequestError,
  isSemanticSearchQuotaError,
  safeAzureRequestDiagnostic,
} from "@/lib/server/azure-request-error";
import type { RuntimeConfig } from "@/lib/server/config";
import type { AuthenticatedActor } from "@/lib/server/identity";

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
  citation_namespace?: string;
  document_id?: string;
  project_context?: string;
};

type SearchResponse = {
  value?: SearchDocument[];
};

type ProjectSearchScope = {
  sourceIds: string[];
  contextBySourceId: Map<string, string>;
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

function controlledCitationsFromDocuments(documents: SearchDocument[], requestId: string) {
  const markerCounters = { D: 0, S: 0, B: 0 };
  return documents
    .filter((document) => document.content && document.source_id)
    .map<ConsultCitation>((document, index) => {
      const citationNamespace = controlledCitationNamespace(document.citation_namespace);
      const marker = nextControlledMarker(citationNamespace, markerCounters);
      const passage = buildControlledEvidenceExcerpt(document.content ?? "", document.chunk_kind);
      const projectContext = document.project_context
        ? buildControlledEvidenceExcerpt(document.project_context)
        : undefined;
      const citation: ConsultCitation = {
        id: document.chunk_id ?? `citation-${index + 1}`,
        title: document.title ?? document.source_id ?? `Source ${index + 1}`,
        sourceId: document.source_id ?? `source-${index + 1}`,
        section: document.section || undefined,
        pageNumber:
          typeof document.page_number === "number" ? document.page_number : undefined,
        excerpt:
          projectContext && projectContext !== passage
            ? `Project identity evidence: ${projectContext} Passage: ${passage}`
            : passage,
        sourceUri: document.source_uri || undefined,
        score:
          typeof document["@search.score"] === "number"
            ? document["@search.score"]
            : undefined,
        sourceType: "controlled",
        citationNamespace,
        marker,
      };

      const privateAudit = privateBookCitationAuditRecord(requestId, citation);
      if (privateAudit) console.info("Helmonic private book citation audit", privateAudit);

      return publicControlledCitation(citation);
    });
}

async function findProjectSourceIds(
  question: string,
  requestId: string,
  config: RuntimeConfig,
) {
  const projectCodes = extractProjectCodes(question);
  if (projectCodes.length === 0) {
    return { sourceIds: [], contextBySourceId: new Map<string, string>() };
  }

  const { endpoint, indexName } = requireSearchConfig(config);
  const token = await getAzureAccessToken("https://search.azure.com/.default");
  const scope = config.profile.replace(/'/g, "''");
  const responses = await Promise.all(
    projectCodes.map(async (projectCode) => {
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
            search: projectCode,
            queryType: "simple",
            searchMode: "all",
            searchFields: "title,section,content",
            filter: `permission_scope eq '${scope}'`,
            top: 50,
            select: "source_id,content,title,section,page_number",
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!response.ok) {
        throw await azureRequestError(response, {
          service: "Azure AI Search",
          stage: "search-project-anchor",
        });
      }
      return ((await response.json()) as SearchResponse).value ?? [];
    }),
  );

  const contextBySourceId = new Map<string, string>();
  for (const document of responses.flat()) {
    if (document.source_id && document.content && !contextBySourceId.has(document.source_id)) {
      contextBySourceId.set(document.source_id, document.content);
    }
  }
  const sourceIds = [...contextBySourceId.keys()].slice(0, 12);
  return {
    sourceIds,
    contextBySourceId: new Map(
      sourceIds.map((sourceId) => [sourceId, contextBySourceId.get(sourceId) ?? ""]),
    ),
  };
}

async function searchControlledDocuments(
  question: string,
  requestId: string,
  config: RuntimeConfig,
  top = config.search.top,
  projectScope?: ProjectSearchScope,
) {
  const { endpoint, indexName } = requireSearchConfig(config);
  const scopedProject = projectScope ?? await findProjectSourceIds(
    question,
    requestId,
    config,
  );
  const scopedProjectSourceIds = scopedProject.sourceIds;
  const queryEmbedding = config.search.hybridEnabled
    ? await import("@/lib/server/embeddings").then(({ createQueryEmbedding }) =>
        createQueryEmbedding(question, requestId, config),
      )
    : null;
  const searchRequest = queryEmbedding
    ? buildControlledHybridSearchRequest(
        question,
        config.profile,
        top,
        queryEmbedding,
        {
          vectorK: config.search.vectorK,
          sourceIds: scopedProjectSourceIds,
          semanticConfiguration: config.search.semanticEnabled
            ? config.search.semanticConfiguration
            : undefined,
        },
      )
    : buildControlledSearchRequest(question, config.profile, top, scopedProjectSourceIds);
  const token = await getAzureAccessToken("https://search.azure.com/.default");
  const executeSearch = async (request: typeof searchRequest) => {
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
        body: JSON.stringify(request),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    );

    if (!response.ok) {
      throw await azureRequestError(response, {
        service: "Azure AI Search",
        stage: "search",
      });
    }

    return (await response.json()) as SearchResponse;
  };

  let effectiveScoreKind: "semantic" | "rrf" =
    searchRequest.queryType === "semantic" ? "semantic" : "rrf";
  let semanticFallbackUsed = false;
  let payload: SearchResponse;
  try {
    payload = await executeSearch(searchRequest);
  } catch (error) {
    if (
      !queryEmbedding ||
      searchRequest.queryType !== "semantic" ||
      !isSemanticSearchQuotaError(error)
    ) {
      throw error;
    }

    const fallbackRequest = buildControlledHybridSearchRequest(
      question,
      config.profile,
      top,
      queryEmbedding,
      { vectorK: config.search.vectorK, sourceIds: scopedProjectSourceIds },
    );
    console.warn(
      "Helmonic semantic retrieval quota unavailable; using grounded hybrid fallback",
      {
        requestId,
        azureDiagnostic: safeAzureRequestDiagnostic(error),
      },
    );
    payload = await executeSearch(fallbackRequest);
    effectiveScoreKind = "rrf";
    semanticFallbackUsed = true;
  }

  const retrievedDocuments = payload.value ?? [];
  const relevantDocuments = config.search.hybridEnabled
    ? retainRelevantHybridDocuments(retrievedDocuments, {
        scoreKind: effectiveScoreKind,
        minimumScore: effectiveScoreKind === "semantic"
          ? config.search.minimumSemanticScore
          : config.search.minimumRrfScore,
      })
    : retrievedDocuments;
  if (config.search.hybridEnabled) {
    console.info("Helmonic hybrid retrieval", {
      requestId,
      retrievedCount: retrievedDocuments.length,
      retainedCount: relevantDocuments.length,
      scoreKind: effectiveScoreKind,
      minimumScore: effectiveScoreKind === "semantic"
        ? config.search.minimumSemanticScore
        : config.search.minimumRrfScore,
      semanticFallbackUsed,
      projectScoped: scopedProjectSourceIds.length > 0,
      projectSourceCount: scopedProjectSourceIds.length,
    });
  }

  return relevantDocuments.map((document) => ({
    ...document,
    project_context:
      (document.source_id && scopedProject.contextBySourceId.get(document.source_id)) || undefined,
  }));
}

export async function searchConsultEvidence(
  question: string,
  requestId: string,
  config: RuntimeConfig,
) {
  return controlledCitationsFromDocuments(
    await searchControlledDocuments(question, requestId, config),
    requestId,
  );
}

export async function searchReportEvidence(
  question: string,
  requestId: string,
  config: RuntimeConfig,
) {
  const projectScope = await findProjectSourceIds(question, requestId, config);
  const initial = await searchControlledDocuments(
    question,
    requestId,
    config,
    Math.max(config.search.top, 12),
    projectScope,
  );
  const sourceIds = (
    projectScope.sourceIds.length > 0
      ? projectScope.sourceIds
      : [...new Set(initial.map((document) => document.source_id).filter(Boolean))]
  ).slice(0, 12) as string[];
  if (sourceIds.length === 0) return [];

  const { endpoint, indexName } = requireSearchConfig(config);
  const token = await getAzureAccessToken("https://search.azure.com/.default");
  const expanded = await Promise.all(
    sourceIds.map(async (sourceId) => {
      const scope = config.profile.replace(/'/g, "''");
      const source = sourceId.replace(/'/g, "''");
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
            search: "*",
            queryType: "simple",
            searchMode: "all",
            filter: `permission_scope eq '${scope}' and source_id eq '${source}'`,
            top: 60,
            select:
              "chunk_id,source_id,source_uri,title,section,page_number,content,chunk_kind,citation_namespace",
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
        },
      );
      if (!response.ok) {
        throw await azureRequestError(response, {
          service: "Azure AI Search",
          stage: "search-report-expansion",
        });
      }
      return ((await response.json()) as SearchResponse).value ?? [];
    }),
  );
  const unique = new Map<string, SearchDocument>();
  for (const document of [...initial, ...expanded.flat()]) {
    const contextualDocument = {
      ...document,
      project_context:
        (document.source_id && projectScope.contextBySourceId.get(document.source_id)) ||
        document.project_context,
    };
    const key = document.chunk_id ?? `${document.source_id}:${document.page_number}:${document.section}`;
    if (!unique.has(key)) unique.set(key, contextualDocument);
  }
  return controlledCitationsFromDocuments([...unique.values()], requestId);
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
    throw await azureRequestError(response, {
      service: "Azure AI Search",
      stage: "search-session",
    });
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
      citationNamespace: "A",
      marker: `A${index + 1}`,
    }));
}

type EmailSearchDocument = {
  "@search.score"?: number;
  chunk_id?: string;
  message_id?: string;
  evidence_ref?: string;
  subject?: string;
  body_text?: string;
  mailbox_owner?: string;
  source_uri?: string;
};

export async function searchRestrictedEmailEvidence(
  question: string,
  actor: AuthenticatedActor,
  requestId: string,
  config: RuntimeConfig,
) {
  if (!actorMayReadRestrictedEmailEvidence(actor, config)) {
    throw new Error("restricted-email-evidence-forbidden");
  }

  const { endpoint, indexName, managedIdentityClientId } = config.emailEvidence;
  if (!endpoint || !indexName || !managedIdentityClientId) {
    throw new Error("restricted-email-evidence-not-configured");
  }

  const token = await getAzureAccessTokenForClient(
    "https://search.azure.com/.default",
    managedIdentityClientId,
  );
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
      body: JSON.stringify(buildRestrictedEmailSearchRequest(question, config.search.top)),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    },
  );

  if (!response.ok) {
    throw await azureRequestError(response, {
      service: "Azure AI Search",
      stage: "search-email",
    });
  }

  const payload = (await response.json()) as { value?: EmailSearchDocument[] };
  return (payload.value ?? [])
    .filter((document) => document.body_text && document.message_id)
    .map<ConsultCitation>((document, index) => ({
      id: document.chunk_id ?? `email-citation-${index + 1}`,
      title: document.subject || `Restricted email evidence ${index + 1}`,
      sourceId: document.evidence_ref ?? document.message_id ?? `email-${index + 1}`,
      section: document.mailbox_owner || undefined,
      excerpt: buildControlledEvidenceExcerpt(document.body_text ?? ""),
      sourceUri: document.source_uri || undefined,
      score:
        typeof document["@search.score"] === "number"
          ? document["@search.score"]
          : undefined,
      sourceType: "email",
      citationNamespace: "E",
      marker: `E${index + 1}`,
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
    throw await azureRequestError(response, {
      service: "Azure AI Search",
      stage: "search-count",
    });
  }

  return Number.parseInt(await response.text(), 10);
}
