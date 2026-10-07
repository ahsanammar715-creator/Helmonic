export function buildRestrictedEmailSearchRequest(question: string, top: number) {
  const search = question.trim();
  if (!search) throw new Error("A non-empty email evidence query is required");

  return {
    search,
    queryType: "simple",
    searchMode: "any",
    searchFields:
      "subject,body_text,participants,participant_names,firm,project_names,relationship_people,relationship_roles",
    top: Math.max(1, Math.min(20, Math.trunc(top))),
    select:
      "chunk_id,message_id,evidence_ref,subject,body_text,mailbox_owner,sent_at,participants,firm,project_names,source_uri",
  };
}
