import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const EXPECTED_BATCH_ID =
  process.env.HELMONIC_INGESTION_EXPECTED_BATCH_ID || "corpus-pilot-100-v1";
export const EXPECTED_DOCUMENT_COUNT = Number.parseInt(
  process.env.HELMONIC_INGESTION_EXPECTED_DOCUMENT_COUNT || "100",
  10,
);
export const EXPECTED_PERMISSION_SCOPE = "iAcoustics";
export const CANDIDATE_INDEX_PREFIX = "consult-candidate-";
export const MAX_EMBEDDING_INPUT_BYTES = 7_000;
export const RETRIEVAL_PROBE_OVERRIDES = Object.freeze({
  "src-779696c36d01b083fc855b9c":
    "Where is the accessible shower provision located on the ground floor plan?",
});

const DRAWING_METADATA_LABELS = Object.freeze([
  "Project Title",
  "Site Address",
  "Site Addres",
  "Drawing Title",
  "Drawing Number",
  "Revision",
  "Status",
  "Scale",
  "Sheet Size",
  "Drawn By",
  "Date and Time",
]);

if (!/^corpus-[a-z0-9-]+$/.test(EXPECTED_BATCH_ID)) {
  throw new Error("Expected corpus batch ID is invalid");
}
if (!Number.isSafeInteger(EXPECTED_DOCUMENT_COUNT) || EXPECTED_DOCUMENT_COUNT < 1) {
  throw new Error("Expected corpus document count must be positive");
}

export function assertCandidateTarget(indexName, liveIndexName) {
  if (!indexName.startsWith(CANDIDATE_INDEX_PREFIX)) {
    throw new Error(`Candidate index must start with ${CANDIDATE_INDEX_PREFIX}`);
  }
  if (indexName === liveIndexName || indexName === "consult-demo-v1") {
    throw new Error("Corpus pilot must not target a live or rollback index");
  }
}

export function buildRetrievalProbeQuestion(document) {
  const override = RETRIEVAL_PROBE_OVERRIDES[document?.sourceId];
  if (override) return override;
  const drawingQuestion = buildDrawingRetrievalProbeQuestion(document);
  if (drawingQuestion) return drawingQuestion;
  const words = (document?.chunks || [])
    .slice(0, 4)
    .flatMap((chunk) => chunk.content?.match(/[A-Za-z][A-Za-z'-]{5,}/g) || [])
    .map((word) => word.toLowerCase())
    .filter(
      (word) =>
        !["acoustic", "report", "project", "document", "assessment", "consultant"].includes(
          word,
        ),
    );
  return [...new Set(words)].slice(0, 6).join(" ");
}

function buildDrawingRetrievalProbeQuestion(document) {
  const content = (document?.chunks || [])
    .slice(0, 8)
    .map((chunk) => chunk.content || "")
    .join("\n");
  const drawingTitle = extractDrawingMetadataValue(content, "Drawing Title");
  if (!drawingTitle) return null;
  const projectTitle = extractDrawingMetadataValue(content, "Project Title");
  return projectTitle
    ? `Where can I find the ${drawingTitle} drawing for ${projectTitle}?`
    : `Where can I find the ${drawingTitle} drawing?`;
}

function extractDrawingMetadataValue(content, label) {
  if (!content) return null;
  const escapedLabel = escapeRegularExpression(label);
  const tableRow = content.match(new RegExp(`\\|\\s*${escapedLabel}\\s*:\\s*([^|\\r\\n]+)`, "i"));
  if (tableRow?.[1]) return normalizeDrawingMetadataValue(tableRow[1]);

  const labels = DRAWING_METADATA_LABELS.map(escapeRegularExpression).join("|");
  const plainText = content.match(
    new RegExp(
      `(?:^|\\r?\\n)\\s*${escapedLabel}\\s*:\\s*([^\\r\\n]*(?:\\r?\\n(?!\\s*(?:${labels})\\s*:)[^\\r\\n]*){0,2})`,
      "i",
    ),
  );
  return plainText?.[1] ? normalizeDrawingMetadataValue(plainText[1]) : null;
}

function normalizeDrawingMetadataValue(value) {
  const normalized = value
    .replace(/^\|+|\|+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || null;
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export function buildOriginalBlobMetadata(document) {
  if (
    !document?.sourceId ||
    !/^[a-f0-9]{64}$/.test(document.sourceHash || "") ||
    document.permissionScope !== EXPECTED_PERMISSION_SCOPE ||
    !["D", "B"].includes(document.citationNamespace)
  ) {
    throw new Error("Original Blob metadata requires a valid controlled document");
  }
  return {
    "x-ms-meta-sourceid": document.sourceId,
    "x-ms-meta-sourcesha256": document.sourceHash,
    "x-ms-meta-permissionscope": document.permissionScope,
    "x-ms-meta-citationnamespace": document.citationNamespace,
  };
}

export function isSafeExistingBlobResponse(status, errorCode) {
  return status === 412 || (status === 409 && errorCode === "BlobAlreadyExists");
}

export function splitEmbeddingInput(content, maxBytes = MAX_EMBEDDING_INPUT_BYTES) {
  if (typeof content !== "string" || !content.length) {
    throw new Error("Embedding input must be a non-empty string");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 256) {
    throw new Error("Embedding input byte limit must be an integer of at least 256");
  }
  if (Buffer.byteLength(content, "utf8") <= maxBytes) return [content];

  const parts = [];
  let start = 0;
  while (start < content.length) {
    let low = start + 1;
    let high = content.length;
    let end = low;
    while (low <= high) {
      const candidate = Math.floor((low + high) / 2);
      if (Buffer.byteLength(content.slice(start, candidate), "utf8") <= maxBytes) {
        end = candidate;
        low = candidate + 1;
      } else {
        high = candidate - 1;
      }
    }
    if (
      end < content.length &&
      /[\uD800-\uDBFF]/.test(content[end - 1]) &&
      /[\uDC00-\uDFFF]/.test(content[end])
    ) {
      end -= 1;
    }
    if (end < content.length) {
      const whitespace = content.slice(start, end).search(/\s+\S*$/);
      if (whitespace >= Math.floor((end - start) / 2)) end = start + whitespace + 1;
    }
    const part = content.slice(start, end);
    if (!part || Buffer.byteLength(part, "utf8") > maxBytes) {
      throw new Error("Could not safely partition an oversized embedding input");
    }
    parts.push(part);
    start = end;
  }
  if (parts.join("") !== content) throw new Error("Embedding input partition lost content");
  return parts;
}

export function combineEmbeddingSegments(segments) {
  if (!Array.isArray(segments) || !segments.length) {
    throw new Error("At least one embedding segment is required");
  }
  const dimensions = segments[0]?.embedding?.length;
  if (!Number.isSafeInteger(dimensions) || dimensions < 1) {
    throw new Error("Embedding segments require non-empty vectors");
  }
  const combined = Array.from({ length: dimensions }, () => 0);
  let totalWeight = 0;
  for (const segment of segments) {
    if (
      !Array.isArray(segment.embedding) ||
      segment.embedding.length !== dimensions ||
      !Number.isFinite(segment.weight) ||
      segment.weight <= 0
    ) {
      throw new Error("Embedding segments must have matching vectors and positive weights");
    }
    totalWeight += segment.weight;
    segment.embedding.forEach((value, index) => {
      combined[index] += value * segment.weight;
    });
  }
  const averaged = combined.map((value) => value / totalWeight);
  const norm = Math.sqrt(averaged.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) throw new Error("Combined embedding has zero magnitude");
  return averaged.map((value) => value / norm);
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
  const attemptedDocumentCount =
    payload?.batch?.attemptedDocumentCount ?? EXPECTED_DOCUMENT_COUNT;
  const quarantineCount = payload?.batch?.quarantineCount ?? 0;
  if (
    attemptedDocumentCount !== EXPECTED_DOCUMENT_COUNT ||
    !Number.isSafeInteger(quarantineCount) ||
    quarantineCount < 0 ||
    !Array.isArray(payload.documents) ||
    payload.documents.length < 1 ||
    payload.documents.length !== EXPECTED_DOCUMENT_COUNT - quarantineCount
  ) {
    throw new Error(
      `Corpus batch must account for all ${EXPECTED_DOCUMENT_COUNT} attempted documents`,
    );
  }
  const sourceIds = new Set();
  const chunkIds = new Set();
  for (const document of payload.documents) {
    if (!document.sourceId || sourceIds.has(document.sourceId)) {
      throw new Error("Every corpus source ID must be unique");
    }
    if (
      document.permissionScope !== EXPECTED_PERMISSION_SCOPE ||
      !["D", "B"].includes(document.citationNamespace) ||
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
