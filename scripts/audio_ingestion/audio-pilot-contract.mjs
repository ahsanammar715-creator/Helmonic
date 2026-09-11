import { createHash } from "node:crypto";

export const EXPECTED_PILOT_COUNT = 12;
export const MAXIMUM_PILOT_BYTES = 536_870_912;

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function encodeBlobName(name) {
  return String(name).split("/").map(encodeURIComponent).join("/");
}

export function projectReference(relativePath) {
  const parts = String(relativePath).split(/[\\/]/).filter(Boolean);
  if (parts.length < 2) throw new Error("Audio path has no project context");
  return `${parts[0]}/${parts[1]}`;
}

export function validatePilotPayload(payload) {
  if (payload?.payload_version !== 1 || payload?.content_processing !== "none") {
    throw new Error("Unsupported or content-processing-enabled audio pilot payload");
  }
  if (!/^audio-pilot-[0-9]{8}T[0-9]{6}Z$/.test(payload.pilot_id || "")) {
    throw new Error("Invalid audio pilot ID");
  }
  if (!payload.source_was_not_modified || payload.documents?.length !== EXPECTED_PILOT_COUNT) {
    throw new Error(`Audio pilot requires exactly ${EXPECTED_PILOT_COUNT} preserved sources`);
  }

  const sourceIds = new Set();
  const blobNames = new Set();
  let totalBytes = 0;
  for (const item of payload.documents) {
    if (!/^src-[0-9a-f]{24}$/.test(item.source_id || "")) throw new Error("Invalid source ID");
    if (!/^originals\/src-[0-9a-f]{24}\.wav$/.test(item.blob_name || "")) {
      throw new Error(`Unsafe audio blob name for ${item.source_id}`);
    }
    if (item.local_name !== `${item.source_id}.wav`) throw new Error("Unsafe local audio filename");
    if (!/^[0-9a-f]{64}$/.test(item.sha256 || "")) throw new Error("Missing source SHA-256");
    if (
      item.permission_scope !== "iAcoustics" ||
      item.citation_namespace !== "AU" ||
      item.promotion_state !== "pilot_only" ||
      item.content_processing !== "none"
    ) {
      throw new Error(`Audio evidence contract failed for ${item.source_id}`);
    }
    if (!Number.isSafeInteger(item.size_bytes) || item.size_bytes < 1) throw new Error("Invalid size");
    if (!Number.isFinite(item.duration_seconds) || item.duration_seconds <= 0) {
      throw new Error("Invalid audio duration");
    }
    projectReference(item.relative_path);
    if (sourceIds.has(item.source_id) || blobNames.has(item.blob_name)) throw new Error("Duplicate pilot source");
    sourceIds.add(item.source_id);
    blobNames.add(item.blob_name);
    totalBytes += item.size_bytes;
  }
  if (totalBytes > MAXIMUM_PILOT_BYTES) throw new Error("Audio pilot exceeds byte ceiling");
  return { totalBytes };
}
