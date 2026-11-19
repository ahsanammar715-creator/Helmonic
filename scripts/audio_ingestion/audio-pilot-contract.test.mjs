import assert from "node:assert/strict";
import test from "node:test";

import {
  encodeBlobName,
  projectReference,
  validatePilotPayload,
} from "./audio-pilot-contract.mjs";

function payload() {
  return {
    payload_version: 1,
    pilot_id: "audio-pilot-20260904T120000Z",
    source_was_not_modified: true,
    content_processing: "none",
    documents: Array.from({ length: 12 }, (_, index) => {
      const source = `src-${index.toString(16).padStart(24, "0")}`;
      return {
        source_id: source,
        relative_path: `IA-02.2\\J200${index} Example\\recording.wav`,
        local_name: `${source}.wav`,
        blob_name: `originals/${source}.wav`,
        size_bytes: 12,
        sha256: "a".repeat(64),
        permission_scope: "iAcoustics",
        citation_namespace: "AU",
        duration_seconds: 1,
        content_processing: "none",
        promotion_state: "pilot_only",
      };
    }),
  };
}

test("pilot contract is bounded and permission scoped", () => {
  assert.deepEqual(validatePilotPayload(payload()), { totalBytes: 144 });
});

test("pilot contract rejects promotion or traversal", () => {
  const promoted = payload();
  promoted.documents[0].promotion_state = "ready";
  assert.throws(() => validatePilotPayload(promoted), /contract failed/);

  const traversal = payload();
  traversal.documents[0].blob_name = "../outside.wav";
  assert.throws(() => validatePilotPayload(traversal), /Unsafe audio blob name/);
});

test("project and blob paths remain explicit", () => {
  assert.equal(projectReference("IA-06\\IRIS Testing Raw Data\\ir.wav"), "IA-06/IRIS Testing Raw Data");
  assert.equal(encodeBlobName("originals/a b.wav"), "originals/a%20b.wav");
});
