export type ConsultCitation = {
  id: string;
  title: string;
  sourceId: string;
  section?: string;
  pageNumber?: number;
  excerpt: string;
  sourceUri?: string;
  score?: number;
};

export type ConsultAnswerMode =
  | "generated"
  | "retrieval-only"
  | "no-evidence"
  | "not-configured";

export type ConsultQueryResponse = {
  answer: string | null;
  citations: ConsultCitation[];
  mode: ConsultAnswerMode;
  requestId: string;
};

export type ConsultErrorResponse = {
  error: string;
  requestId: string;
};
