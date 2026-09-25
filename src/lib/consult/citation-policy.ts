import type { ConsultCitation } from "@/lib/consult/types";

export type ControlledCitationNamespace = "D" | "S" | "B";
export type CitationMarker = `${ControlledCitationNamespace | "A" | "E"}${number}`;

export function controlledCitationNamespace(value: unknown): ControlledCitationNamespace {
  return value === "S" || value === "B" ? value : "D";
}

export function nextControlledMarker(
  namespace: ControlledCitationNamespace,
  counters: Record<ControlledCitationNamespace, number>,
): CitationMarker {
  counters[namespace] += 1;
  return `${namespace}${counters[namespace]}`;
}

export function publicControlledCitation(citation: ConsultCitation): ConsultCitation {
  if (citation.citationNamespace !== "B") return citation;

  return {
    ...citation,
    id: citation.marker ?? citation.id,
    title: "Approved acoustics reference",
    sourceId: citation.marker ?? "approved-book",
    section: undefined,
    sourceUri: undefined,
  };
}

export type PrivateBookCitationAuditRecord = {
  event: "private-book-citation";
  requestId: string;
  marker: CitationMarker;
  chunkId: string;
  sourceId: string;
  title: string;
  section?: string;
  sourceUri?: string;
  pageNumber?: number;
};

export function privateBookCitationAuditRecord(
  requestId: string,
  citation: ConsultCitation,
): PrivateBookCitationAuditRecord | null {
  if (citation.citationNamespace !== "B" || !citation.marker) return null;
  return {
    event: "private-book-citation",
    requestId,
    marker: citation.marker,
    chunkId: citation.id,
    sourceId: citation.sourceId,
    title: citation.title,
    section: citation.section,
    sourceUri: citation.sourceUri,
    pageNumber: citation.pageNumber,
  };
}
