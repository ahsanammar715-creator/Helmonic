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

export type GeneralCitation = {
  id: string;
  marker: `G${number}`;
  title: string;
  publisher: string;
  url: string;
  excerpt: string;
  retrievedAt: string;
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
  documentAnswer: {
    status: ConsultAnswerMode;
    text: string | null;
    citations: ConsultCitation[];
  };
  generalContext: {
    status: "generated" | "unavailable" | "insufficient-evidence" | "disabled";
    text: string | null;
    citations: GeneralCitation[];
  };
};

export type ConsultErrorResponse = {
  error: string;
  requestId: string;
};
