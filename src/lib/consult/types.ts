export type ConsultCitation = {
  id: string;
  title: string;
  sourceId: string;
  section?: string;
  pageNumber?: number;
  excerpt: string;
  sourceUri?: string;
  score?: number;
  sourceType?: "controlled" | "attachment" | "email" | "experience";
  citationNamespace?: "D" | "S" | "B" | "A" | "E";
  marker?: `D${number}` | `S${number}` | `B${number}` | `A${number}` | `E${number}`;
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
