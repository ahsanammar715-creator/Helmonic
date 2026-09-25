import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConsultSystemPrompt,
  NO_DOCUMENT_EVIDENCE_NOTICE,
  validateDocumentAnswerCitations,
} from "../../src/lib/consult/model-policy.ts";

test("system prompt enforces the professional acoustician register and citation taxonomy", () => {
  const prompt = buildConsultSystemPrompt({
    profile: "iAcoustics",
    allowGeneralKnowledge: false,
  });
  assert.match(prompt, /acoustician-to-acoustician/);
  assert.match(prompt, /Rw versus DnT,w/);
  assert.match(prompt, /C and Ctr/);
  assert.match(prompt, /one-third-octave-band/);
  assert.match(prompt, /\[S#\]/);
  assert.match(prompt, /\[B#\]/);
  assert.match(prompt, /\[E#\]/);
  assert.match(prompt, /hidden title, author, publisher, filename, URI, or section/);
});

const citations = [
  {
    id: "document-1",
    title: "Controlled report",
    sourceId: "source-1",
    excerpt: "A controlled passage.",
    marker: "D1",
  },
];

const mixedCitations = [
  citations[0],
  {
    id: "standard-1",
    title: "ISO 16283-1",
    sourceId: "standard-source-1",
    excerpt: "Field measurement method.",
    citationNamespace: "S",
    marker: "S1",
  },
  {
    id: "book-1",
    title: "Approved acoustics reference",
    sourceId: "B1",
    excerpt: "Approved reference evidence.",
    citationNamespace: "B",
    marker: "B1",
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

test("standards and approved books are accepted as distinct grounded namespaces", () => {
  const result = validateDocumentAnswerCitations(
    "The field result follows the standard method [S1] and is consistent with the approved reference [B1], alongside the project evidence [D1].",
    mixedCitations,
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.markers, ["S1", "B1", "D1"]);
});

test("unretrieved standard or book markers fail closed", () => {
  const result = validateDocumentAnswerCitations(
    "The requirement is established by a standard [S2] and a book [B2].",
    mixedCitations,
  );

  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /unsupported markers: S2, B2/);
});

test("restricted email markers are accepted only when supplied as evidence", () => {
  const emailCitation = {
    id: "email-1",
    title: "Restricted email",
    sourceId: "[E:glen:1234]",
    excerpt: "A traceable relationship statement.",
    marker: "E1",
  };
  const accepted = validateDocumentAnswerCitations(
    "The relationship is supported by the authorised correspondence. [E1]",
    [emailCitation],
  );
  const rejected = validateDocumentAnswerCitations(
    "The relationship is supported by an email that was not retrieved. [E1]",
    citations,
  );

  assert.equal(accepted.valid, true);
  assert.equal(rejected.valid, false);
  assert.match(rejected.errors.join(" "), /unsupported markers/);
});
