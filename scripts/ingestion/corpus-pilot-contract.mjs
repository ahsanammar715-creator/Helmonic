import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const EXPECTED_BATCH_ID = "corpus-pilot-100-v1";
export const EXPECTED_DOCUMENT_COUNT = 100;
export const EXPECTED_PERMISSION_SCOPE = "iAcoustics";
export const CANDIDATE_INDEX_PREFIX = "consult-candidate-";

export function assertCandidateTarget(indexName, liveIndexName) {
  if (!indexName.startsWith(CANDIDATE_INDEX_PREFIX)) {
    throw new Error(`Candidate index must start with ${CANDIDATE_INDEX_PREFIX}`);
  }
  if (indexName === liveIndexName || indexName === "consult-demo-v1") {
    throw new Error("Corpus pilot must not target a live or rollback index");
  }
}

export function buildCandidateIndexProbe(dimensions) {
  if (!Number.isSafeInteger(dimensions) || dimensions < 1) {
    throw new Error("Candidate probe dimensions must be a positive integer");
  }
  const component = 1 / Math.sqrt(dimensions);
  return {
    search: "*",
    filter: `permission_scope eq '${EXPECTED_PERMISSION_SCOPE}'`,
    top: 1,
    select: "chunk_id",
    vectorFilterMode: "preFilter",
    vectorQueries: [
      {
        kind: "vector",
        vector: Array.from({ length: dimensions }, () => component),
        fields: "content_vector",
        k: 1,
      },
    ],
  };
}

export function validateCorpusPilotPayload(payload) {
  if (payload?.batch?.id !== EXPECTED_BATCH_ID || payload?.batch?.promotionReady !== false) {
    throw new Error("Payload must declare the non-promotable corpus pilot batch");
  }
  if (
    payload?.extraction?.version !== 2 ||
    payload?.extraction?.tableStrategy !== "atomic-markdown-or-key-value"
  ) {
    throw new Error("Corpus pilot requires extraction v2 and atomic table preservation");
  }
  if (!Array.isArray(payload.documents) || payload.documents.length !== EXPECTED_DOCUMENT_COUNT) {
    throw new Error(`Corpus pilot requires exactly ${EXPECTED_DOCUMENT_COUNT} documents`);
  }
  const sourceIds = new Set();
  const chunkIds = new Set();
  for (const document of payload.documents) {
    if (!document.sourceId || sourceIds.has(document.sourceId)) {
      throw new Error("Every corpus source ID must be unique");
    }
    if (
      document.permissionScope !== EXPECTED_PERMISSION_SCOPE ||
      document.citationNamespace !== "D" ||
      !/^[a-f0-9]{64}$/.test(document.sourceHash || "") ||
      !Array.isArray(document.chunks) ||
      document.chunks.length === 0
    ) {
      throw new Error(`Invalid corpus source contract for ${document.sourceId || "unknown"}`);
    }
    const integrity = document.integrity;
    if (
      !["verified", "repair_verified"].includes(integrity?.outcome) ||
      !Number.isInteger(integrity?.expectedPages) ||
      integrity.expectedPages < 1 ||
      integrity.pdfminerPages !== integrity.expectedPages ||
      integrity.pypdfPages !== integrity.expectedPages ||
      integrity.readablePages !== integrity.expectedPages ||
      integrity.pageCountsMatch !== true ||
      !Array.isArray(integrity.pypdfFailures) ||
      integrity.pypdfFailures.length !== 0 ||
      (integrity.outcome === "repair_verified" && integrity.recoveryApplied !== true)
    ) {
      throw new Error(`Two-reader integrity verification is incomplete for ${document.sourceId}`);
    }
    sourceIds.add(document.sourceId);
    for (const chunk of document.chunks) {
      if (!chunk.chunkId || chunkIds.has(chunk.chunkId) || !chunk.content?.trim()) {
        throw new Error("Every corpus chunk must be unique and non-empty");
      }
      const contentHash = createHash("sha256").update(chunk.content).digest("hex");
      if (contentHash !== chunk.contentHash || !Number.isInteger(chunk.pageNumber)) {
        throw new Error(`Invalid chunk hash/page for ${chunk.chunkId}`);
      }
      if (chunk.kind === "table" && (chunk.atomic !== true || chunk.contentFormat !== "markdown")) {
        throw new Error(`Table chunk ${chunk.chunkId} is not atomic Markdown`);
      }
      chunkIds.add(chunk.chunkId);
    }
  }
  return { sourceIds, chunkIds };
}

export async function assertOriginalHash(payloadRoot, document) {
  const bytes = await readFile(join(payloadRoot, "originals", document.fileName));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== document.sourceHash) {
    throw new Error(`Original hash mismatch for ${document.sourceId}`);
  }
  return bytes;
}
