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
  "band",
  "did",
  "do",
  "does",
  "evidence",
  "for",
  "in",
  "is",
  "level",
  "me",
  "of",
  "on",
  "please",
  "predicted",
  "recorded",
  "say",
  "says",
  "scenario",
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
    select: "chunk_id,source_id,source_uri,title,section,page_number,content,chunk_kind",
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

export function buildControlledEvidenceExcerpt(value: string, chunkKind?: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  const maximumLength = chunkKind === "table" ? 3_000 : 420;
  return compact.length > maximumLength
    ? `${compact.slice(0, maximumLength - 1)}…`
    : compact;
}
