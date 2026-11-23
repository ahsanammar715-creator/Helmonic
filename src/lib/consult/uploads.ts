export type SessionDocumentState =
  | "uploading"
  | "stored"
  | "queued"
  | "processing"
  | "ready"
  | "duplicate"
  | "quarantined"
  | "failed"
  | "expired"
  | "deleted";

export type KnowledgePromotionState =
  | "not-requested"
  | "requested"
  | "promoted"
  | "rejected"
  | "failed";

export type SessionDocument = {
  id: string;
  conversationId: string;
  displayName: string;
  state: SessionDocumentState;
  sizeBytes: number;
  createdAt: string;
  knowledgePromotionState: KnowledgePromotionState;
};

export type SessionDocumentUploadResponse = {
  document: SessionDocument;
  requestId: string;
};

export type ComposerAttachment = {
  id: string;
  name: string;
  state: "uploading" | "queued" | "ready" | "failed";
  promoteToKnowledge?: boolean;
  knowledgePromotionState?: KnowledgePromotionState;
  error?: string;
};
