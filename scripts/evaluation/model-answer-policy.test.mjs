import assert from "node:assert/strict";
import test from "node:test";

import {
  NO_DOCUMENT_EVIDENCE_NOTICE,
  validateDocumentAnswerCitations,
} from "../../src/lib/consult/model-policy.ts";

const citations = [
  {
    id: "document-1",
    title: "Controlled report",
    sourceId: "source-1",
    excerpt: "A controlled passage.",
    marker: "D1",
  },
];

test("fully document-grounded answers need no general marker or disclaimer", () => {
  const result = validateDocumentAnswerCitations(
    "The controlled report supports this conclusion. [D1]",
    citations,
    { allowGeneralKnowledge: true },
  );

  assert.equal(result.valid, true);
  assert.equal(result.generalKnowledgeUsed, false);
});

test("document and general context can flow through one answer with separate markers", () => {
  const result = validateDocumentAnswerCitations(
    "The report records the project result [D1], while this broader explanation comes from the model's unverified general knowledge. [G1]",
    citations,
    { allowGeneralKnowledge: true },
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.markers, ["D1"]);
  assert.deepEqual(result.generalMarkers, ["G1"]);
});

test("general-only fallback discloses that the permitted documents do not cover it", () => {
  const result = validateDocumentAnswerCitations(
    `${NO_DOCUMENT_EVIDENCE_NOTICE} A general explanation may still be useful, but it is not verified against those documents. [G1]`,
    [],
    { allowGeneralKnowledge: true },
  );

  assert.equal(result.valid, true);
  assert.equal(result.generalKnowledgeUsed, true);
});

test("a nonsensical question produces an honest no-evidence and uncertainty answer", () => {
  const result = validateDocumentAnswerCitations(
    `${NO_DOCUMENT_EVIDENCE_NOTICE} I do not know enough to answer this reliably.`,
    [],
    { allowGeneralKnowledge: true },
  );

  assert.equal(result.valid, true);
  assert.equal(result.generalKnowledgeUsed, false);
});

test("general fallback cannot conceal missing document evidence", () => {
  const result = validateDocumentAnswerCitations(
    "Here is an answer from general knowledge. [G1]",
    [],
    { allowGeneralKnowledge: true },
  );

  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /lack evidence/);
});

test("document-only mode still rejects general markers", () => {
  const result = validateDocumentAnswerCitations(
    "The report supports this conclusion [D1], plus general context. [G1]",
    citations,
  );

  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /general-knowledge marker/);
});
