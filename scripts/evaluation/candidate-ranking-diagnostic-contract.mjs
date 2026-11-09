const CANDIDATE_INDEX = "consult-candidate-batch-500-v1";
const LIVE_INDEX = "consult-demo-v2";

export function diagnosticConfiguration(environment = process.env) {
  const endpoint = environment.AZURE_SEARCH_ENDPOINT?.trim().replace(/\/+$/, "");
  const index = environment.AZURE_SEARCH_INDEX?.trim();
  const sourceId = environment.EXPECTED_SOURCE_ID?.trim();
  if (!endpoint?.startsWith("https://") || !index || !sourceId) {
    throw new Error("Search endpoint, candidate index, and expected source ID are required");
  }
  if (index !== CANDIDATE_INDEX || index === LIVE_INDEX) {
    throw new Error(`Diagnostic is pinned to ${CANDIDATE_INDEX}; received ${index}`);
  }
  return {
    endpoint,
    index,
    sourceId,
    apiVersion: environment.AZURE_SEARCH_API_VERSION?.trim() || "2025-09-01",
    semanticConfiguration:
      environment.AZURE_SEARCH_SEMANTIC_CONFIGURATION?.trim() || "consult-semantic-v2",
  };
}

export function buildSearchRequest(
  query,
  configuration,
  { top = 50, skip = 0, filter, mode = "semantic" } = {},
) {
  const request = {
    search: query,
    queryType: mode,
    searchMode: "any",
    searchFields: "title,section,content",
    select: "chunk_id,source_id,title,section,page_number,chunk_kind,content",
    count: true,
    top,
    skip,
  };
  if (mode === "semantic") request.semanticConfiguration = configuration.semanticConfiguration;
  if (filter) request.filter = filter;
  return request;
}

export const diagnosticQueries = Object.freeze([
  { id: "original", text: "legend shower provision location entrance rating" },
  {
    id: "natural-shower-location",
    text: "Where is the accessible shower provision located on the ground floor plan?",
  },
  {
    id: "natural-shower-lift",
    text: "Show the ground floor drawing with the shower tray and lift entrance.",
  },
  {
    id: "natural-fire-rating",
    text: "What fire rating is shown for the lift entrance on the ground floor plan?",
  },
]);

export { CANDIDATE_INDEX, LIVE_INDEX };
