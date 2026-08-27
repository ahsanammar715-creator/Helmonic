import "server-only";

import type {
  ConsultCitation,
  GeneralCitation,
} from "@/lib/consult/types";

export type DocumentModelRequest = {
  requestId: string;
  question: string;
  evidence: ConsultCitation[];
};

export type GeneralContextModelRequest = {
  requestId: string;
  question: string;
  references: GeneralCitation[];
};

export interface ConsultModelGateway {
  createDocumentAnswer(request: DocumentModelRequest): Promise<string>;
  createGeneralContext(request: GeneralContextModelRequest): Promise<string>;
}

export class ModelGatewayValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelGatewayValidationError";
  }
}

export function validateGeneralCitationMarkers(text: string, citations: GeneralCitation[]) {
  const allowed = new Set(citations.map((citation) => citation.marker));
  const markers = text.match(/\[G\d+\]/g) ?? [];
  return markers.every((marker) => allowed.has(marker.slice(1, -1) as `G${number}`));
}
