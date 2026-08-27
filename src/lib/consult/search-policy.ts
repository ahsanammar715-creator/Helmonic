export type ControlledSearchRequest = {
  search: string;
  queryType: "simple";
  searchMode: "all";
  searchFields: string;
  filter: string;
  top: number;
  select: string;
};

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
