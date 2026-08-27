export type ControlledSearchRequest = {
  search: string;
  queryType: "simple";
  searchMode: "all";
  searchFields: string;
  filter: string;
  top: number;
  select: string;
};

function searchFilterValue(value: string) {
  return value.replace(/'/g, "''");
}

export function buildControlledSearchRequest(
  question: string,
  permissionScope: string,
  top: number,
): ControlledSearchRequest {
  return {
    search: question.trim(),
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
