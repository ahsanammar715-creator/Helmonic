import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assertCandidateTarget,
  buildCandidateIndexProbe,
  buildOriginalBlobMetadata,
  combineEmbeddingSegments,
  splitEmbeddingInput,
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

test("candidate schema probe uses only document-data operations", () => {
  const probe = buildCandidateIndexProbe(1536);
  assert.equal(probe.filter, "permission_scope eq 'iAcoustics'");
  assert.equal(probe.select, "chunk_id");
  assert.equal(probe.vectorQueries[0].fields, "content_vector");
  assert.equal(probe.vectorQueries[0].vector.length, 1536);
  assert.throws(() => buildCandidateIndexProbe(0), /positive integer/);
});

test("original Blob metadata uses Azure-safe names", () => {
  const metadata = buildOriginalBlobMetadata({
    sourceId: "src-001",
    sourceHash: "a".repeat(64),
    permissionScope: "iAcoustics",
    citationNamespace: "D",
  });
  assert.deepEqual(metadata, {
    "x-ms-meta-sourceid": "src-001",
    "x-ms-meta-sourcesha256": "a".repeat(64),
    "x-ms-meta-permissionscope": "iAcoustics",
    "x-ms-meta-citationnamespace": "D",
  });
  assert.ok(
    Object.keys(metadata).every((name) => /^x-ms-meta-[a-z][a-z0-9_]*$/i.test(name)),
  );
});

test("oversized embedding inputs are losslessly split under the byte ceiling", () => {
  const content = `${"evidence row | value 😀\n".repeat(700)}終`;
  const parts = splitEmbeddingInput(content, 7000);
  assert.ok(parts.length > 1);
  assert.equal(parts.join(""), content);
  assert.ok(parts.every((part) => Buffer.byteLength(part, "utf8") <= 7000));
});

test("embedding segments combine into one normalized vector", () => {
  const combined = combineEmbeddingSegments([
    { embedding: [1, 0], weight: 3 },
    { embedding: [0, 1], weight: 1 },
  ]);
  assert.equal(combined.length, 2);
  assert.ok(Math.abs(Math.hypot(...combined) - 1) < 1e-12);
  assert.ok(combined[0] > combined[1]);
});

test("payload contract requires exactly 100 internal controlled documents", () => {
  const valid = payload();
  assert.equal(validateCorpusPilotPayload(valid).sourceIds.size, 100);
  valid.documents[0].permissionScope = "public";
  assert.throws(() => validateCorpusPilotPayload(valid), /Invalid corpus source contract/);
});

test("payload contract retains the approved book citation namespace", () => {
  const valid = payload();
  valid.documents[0].citationNamespace = "B";
  assert.equal(validateCorpusPilotPayload(valid).sourceIds.size, 100);
  valid.documents[0].citationNamespace = "G";
  assert.throws(() => validateCorpusPilotPayload(valid), /Invalid corpus source contract/);
});

test("payload contract accounts honestly for quarantined documents without backfill", () => {
  const valid = payload();
  valid.batch.attemptedDocumentCount = 100;
  valid.batch.quarantineCount = 1;
  valid.documents.pop();
  assert.equal(validateCorpusPilotPayload(valid).sourceIds.size, 99);
  valid.batch.quarantineCount = 0;
  assert.throws(
    () => validateCorpusPilotPayload(valid),
    /account for all 100 attempted documents/,
  );
});

test("payload contract rejects a document without completed two-reader verification", () => {
  const invalid = payload();
  invalid.documents[0].integrity.readablePages = 0;
  assert.throws(
    () => validateCorpusPilotPayload(invalid),
    /Two-reader integrity verification is incomplete/,
  );
});
