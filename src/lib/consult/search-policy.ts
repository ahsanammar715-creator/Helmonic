export type ControlledSearchRequest = {
  search: string;
  queryType: "simple";
  searchMode: "all";
  searchFields: string;
  filter: string;
  top: number;
  select: string;
};

export type HybridScoreKind = "semantic" | "rrf";

export type HybridRelevancePolicy = {
  scoreKind: HybridScoreKind;
  minimumScore: number;
};

export type HybridSearchDocument = {
  "@search.score"?: number;
  "@search.rerankerScore"?: number;
};

export type ControlledPageDocument = {
  chunk_id?: string;
  source_id?: string;
  page_number?: number;
  content?: string;
};

export type ControlledTableSiblingRequest = {
  search: "*";
  queryType: "simple";
  filter: string;
  top: number;
  select: string;
};

export type ControlledHybridSearchRequest = Omit<
  ControlledSearchRequest,
  "queryType"
> & {
  queryType: "semantic" | "simple";
  semanticConfiguration?: string;
  vectorFilterMode: "preFilter";
  vectorQueries: Array<{
    kind: "vector";
    vector: number[];
    fields: "content_vector";
    k: number;
  }>;
};

export const REVIEWABLE_HYBRID_THRESHOLDS = {
  // These candidates are mirrored in scripts/evaluation/consult-retrieval.json.
  // They must be tuned against the private v2 index before traffic cutover.
  semantic: 2,
  rrf: 0.015,
} as const;

const CONTROLLED_QUERY_FILLER_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "assessed",
  "at",
  "about",
  "did",
  "do",
  "does",
  "evidence",
  "for",
  "in",
  "is",
  "me",
  "of",
  "on",
  "please",
  "recorded",
  "say",
  "says",
  "tell",
  "the",
  "to",
  "was",
  "were",
  "what",
]);

export function normalizeControlledSearchQuery(question: string) {
  const normalized = question
    .replace(/[^\p{L}\p{N}'-]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word && !CONTROLLED_QUERY_FILLER_WORDS.has(word.toLowerCase()))
    .join(" ");

  return normalized || question.trim();
}

function searchFilterValue(value: string) {
  return value.replace(/'/g, "''");
}

export function buildControlledSearchRequest(
  question: string,
  permissionScope: string,
  top: number,
): ControlledSearchRequest {
  return {
    search: normalizeControlledSearchQuery(question),
    queryType: "simple",
    // Precision is the safer default for a permissioned evidence store. In particular,
    // a missing project/company term must not fall back to passages that matched only
    // generic words from a broad natural-language question.
    searchMode: "all",
    searchFields: "title,section,content",
    filter: `permission_scope eq '${searchFilterValue(permissionScope)}'`,
    top,
    select: "chunk_id,source_id,source_uri,title,section,page_number,content",
  };
}

export function buildControlledHybridSearchRequest(
  question: string,
  permissionScope: string,
  top: number,
  vector: number[],
  options: {
    vectorK: number;
    semanticConfiguration?: string;
  },
): ControlledHybridSearchRequest {
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Hybrid retrieval requires a finite query embedding");
  }

  const request: ControlledHybridSearchRequest = {
    search: normalizeControlledSearchQuery(question),
    queryType: options.semanticConfiguration ? "semantic" : "simple",
    searchMode: "all",
    searchFields: "title,section,content",
    filter: `permission_scope eq '${searchFilterValue(permissionScope)}'`,
    top,
    select: "chunk_id,source_id,source_uri,title,section,page_number,content",
    vectorFilterMode: "preFilter",
    vectorQueries: [
      {
        kind: "vector",
        vector,
        fields: "content_vector",
        k: options.vectorK,
      },
    ],
  };

  if (options.semanticConfiguration) {
    request.semanticConfiguration = options.semanticConfiguration;
  }

  return request;
}

export function retainRelevantHybridDocuments<T extends HybridSearchDocument>(
  documents: T[],
  policy: HybridRelevancePolicy,
) {
  return documents.filter((document) => {
    const score =
      policy.scoreKind === "semantic"
        ? document["@search.rerankerScore"]
        : document["@search.score"];

    return typeof score === "number" && Number.isFinite(score) && score >= policy.minimumScore;
  });
}

export function buildControlledTableSiblingRequest(
  documents: ControlledPageDocument[],
  permissionScope: string,
  maximumPages = 8,
): ControlledTableSiblingRequest | null {
  const boundedMaximum = Math.max(1, Math.min(Math.trunc(maximumPages), 8));
  const anchors = new Map<string, { sourceId: string; pageNumber: number }>();

  for (const document of documents) {
    const sourceId = document.source_id?.trim();
    const pageNumber = document.page_number;
    if (!sourceId || !Number.isInteger(pageNumber) || (pageNumber ?? 0) < 1) continue;

    const key = `${sourceId}\u0000${pageNumber}`;
    if (!anchors.has(key)) {
      anchors.set(key, { sourceId, pageNumber: pageNumber as number });
    }
    if (anchors.size >= boundedMaximum) break;
  }

  if (anchors.size === 0) return null;

  const pageFilter = Array.from(anchors.values(), ({ sourceId, pageNumber }) =>
    `(source_id eq '${searchFilterValue(sourceId)}' and page_number eq ${pageNumber})`,
  ).join(" or ");

  return {
    search: "*",
    queryType: "simple",
    filter:
      `permission_scope eq '${searchFilterValue(permissionScope)}' ` +
      `and chunk_kind eq 'table' and (${pageFilter})`,
    top: anchors.size,
    select: "chunk_id,source_id,source_uri,title,section,page_number,content",
  };
}

export function mergeControlledPageEvidence<T extends ControlledPageDocument>(
  primary: T[],
  samePageTables: T[],
) {
  const merged: T[] = [];
  const seen = new Set<string>();

  for (const document of [...primary, ...samePageTables]) {
    const key =
      document.chunk_id?.trim() ||
      `${document.source_id ?? ""}\u0000${document.page_number ?? ""}\u0000${document.content ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(document);
  }

  return merged;
}
