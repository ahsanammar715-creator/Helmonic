import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assertCandidateTarget,
  validateCorpusPilotPayload,
} from "./corpus-pilot-contract.mjs";

function payload() {
  return {
    batch: { id: "corpus-pilot-100-v1", promotionReady: false },
    extraction: { version: 2, tableStrategy: "atomic-markdown-or-key-value" },
    documents: Array.from({ length: 100 }, (_, index) => {
      const content = `content ${index}`;
      return {
        sourceId: `src-${index}`,
        sourceHash: "a".repeat(64),
        permissionScope: "iAcoustics",
        citationNamespace: "D",
        integrity: {
          outcome: "verified",
          expectedPages: 1,
          pdfminerPages: 1,
          pypdfPages: 1,
          readablePages: 1,
          pageCountsMatch: true,
          corruptionDetected: false,
          recoveryApplied: false,
          pypdfFailures: [],
        },
        chunks: [
          {
            chunkId: `chunk-${index}`,
            pageNumber: 1,
            content,
            contentHash: createHash("sha256").update(content).digest("hex"),
            kind: "text",
            contentFormat: "plain_text",
          },
        ],
      };
    }),
  };
}

test("candidate target cannot be a live or rollback index", () => {
  assert.throws(() => assertCandidateTarget("consult-demo-v2", "consult-demo-v2"));
  assert.throws(() => assertCandidateTarget("consult-demo-v1", "consult-demo-v2"));
  assert.doesNotThrow(() => assertCandidateTarget("consult-candidate-pilot-100-v1", "consult-demo-v2"));
});

test("payload contract requires exactly 100 internal controlled documents", () => {
  const valid = payload();
  assert.equal(validateCorpusPilotPayload(valid).sourceIds.size, 100);
  valid.documents[0].permissionScope = "public";
  assert.throws(() => validateCorpusPilotPayload(valid), /Invalid corpus source contract/);
});

test("payload contract rejects a document without completed two-reader verification", () => {
  const invalid = payload();
  invalid.documents[0].integrity.readablePages = 0;
  assert.throws(
    () => validateCorpusPilotPayload(invalid),
    /Two-reader integrity verification is incomplete/,
  );
});
