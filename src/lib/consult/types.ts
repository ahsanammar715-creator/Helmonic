export type ConsultCitation = {
  id: string;
  title: string;
  sourceId: string;
  section?: string;
  pageNumber?: number;
  excerpt: string;
  sourceUri?: string;
  score?: number;
  sourceType?: "controlled" | "attachment";
  marker?: `D${number}` | `A${number}`;
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
  generalKnowledgeUsed: boolean;
  documentAnswer: {
    status: ConsultAnswerMode;
    text: string | null;
    citations: ConsultCitation[];
  };
};

export type ConsultErrorResponse = {
  error: string;
  requestId: string;
};
