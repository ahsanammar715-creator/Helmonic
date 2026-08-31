import "server-only";

import type { ConsultCitation } from "@/lib/consult/types";

export type DocumentModelRequest = {
  requestId: string;
  question: string;
  evidence: ConsultCitation[];
  allowGeneralKnowledge: boolean;
};

export interface ConsultModelGateway {
  createAnswer(request: DocumentModelRequest): Promise<string>;
}

export class ModelGatewayValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelGatewayValidationError";
  }
}
