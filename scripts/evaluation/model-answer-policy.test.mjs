import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConsultSystemPrompt,
  framePublicWebEvidence,
  NO_DOCUMENT_EVIDENCE_NOTICE,
  validateExperienceAnswer,
  validateDocumentAnswerCitations,
} from "../../src/lib/consult/model-policy.ts";
import {
  batchClaimEvidenceAudit,
  buildClaimEvidenceAudit,
  extractCitedClaimBlocks,
  validateClaimCitationCoverage,
  validateClaimSupportVerdicts,
} from "../../src/lib/consult/claim-evidence-policy.ts";

test("claim-to-evidence audits are split into bounded complete batches", () => {
  const claims = Array.from({ length: 13 }, (_, index) => ({
    id: `C${index + 1}`,
    text: `Claim ${index + 1}. [D1]`,
    markers: ["D1"],
  }));

  const batches = batchClaimEvidenceAudit(claims);
  assert.deepEqual(batches.map((batch) => batch.length), [6, 6, 1]);
  assert.deepEqual(batches.flat().map((claim) => claim.id), claims.map((claim) => claim.id));
});

test("system prompt enforces the professional acoustician register and citation taxonomy", () => {
  const prompt = buildConsultSystemPrompt({
    profile: "iAcoustics",
    allowGeneralKnowledge: false,
  });
  assert.match(prompt, /acoustician-to-acoustician/);
  assert.match(prompt, /Every nonblank response block must end with at least one applicable/i);
  assert.match(prompt, /Avoid standalone headings, labels, lead-ins/i);
  assert.match(prompt, /Rw versus DnT,w/);
  assert.match(prompt, /C and Ctr/);
  assert.match(prompt, /one-third-octave-band/);
  assert.match(prompt, /\[S#\]/);
  assert.match(prompt, /\[B#\]/);
  assert.match(prompt, /\[E#\]/);
  assert.match(prompt, /\[W#\]/);
  assert.match(prompt, /hidden title, author, publisher, filename, URI, or section/);
});

test("experience mode requires a three-project de-identified pattern", () => {
  const prompt = buildConsultSystemPrompt({
    profile: "iAcoustics",
    allowGeneralKnowledge: false,
    experienceMode: true,
  });
  const experienceCitations = [1, 2, 3].map((number) => ({
    id: `experience-case-${number}`,
    title: `De-identified experience case ${number}`,
    sourceId: `experience-case-${number}`,
    excerpt: "Generic technical pattern.",
    sourceType: "experience",
    citationNamespace: "E",
    marker: `E${number}`,
  }));

  assert.match(prompt, /at least three distinct \[E#\] cases/i);
  assert.match(prompt, /Based on experience across comparable projects/);
  assert.match(prompt, /Never reveal or infer names, firms, projects, addresses, dates/i);
  assert.equal(
    validateExperienceAnswer(
      "Based on experience across comparable projects, early coordination reduced rework. [E1] [E2] [E3]",
      experienceCitations,
    ).valid,
    true,
  );
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

test("public-web evidence produces a normal framed answer with a verified W marker", () => {
  const webCitation = {
    id: "web-1",
    title: "Official public guidance",
    sourceId: "https://example.gov.ie/guidance",
    sourceUri: "https://example.gov.ie/guidance",
    excerpt: "The current public guidance requires an acoustic assessment.",
    sourceType: "web",
    citationNamespace: "W",
    marker: "W1",
  };
  const result = validateDocumentAnswerCitations(
    "Current public guidance requires an acoustic assessment. [W1]",
    [webCitation],
    { requireWebEvidence: true },
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.markers, ["W1"]);
});

test("public-web evidence is deterministically framed before validation", () => {
  const answer = framePublicWebEvidence(
    "The official page lists the current requirement. [W1]\n\nThe project report records the design response. [D1]",
  );

  assert.match(answer, /^Current public-web evidence:/);
  assert.match(answer, /\[W1\]\n\nThe project report/);
});

test("public-web evidence cannot be disguised as internal evidence or omitted", () => {
  const webCitation = {
    id: "web-1",
    title: "Official public guidance",
    sourceId: "https://example.gov.ie/guidance",
    excerpt: "Current public guidance.",
    sourceType: "web",
    citationNamespace: "W",
    marker: "W1",
  };
  const mixed = validateDocumentAnswerCitations(
    "The project and current public guidance require this approach. [D1] [W1]",
    [citations[0], webCitation],
    { requireWebEvidence: true },
  );
  const omitted = validateDocumentAnswerCitations(
    "The controlled report supports this conclusion. [D1]",
    [citations[0], webCitation],
    { requireWebEvidence: true },
  );

  assert.equal(mixed.valid, false);
  assert.match(mixed.errors.join(" "), /mixes public-web/);
  assert.equal(omitted.valid, false);
  assert.match(omitted.errors.join(" "), /omits the retrieved public-web/);
});

test("claim coverage rejects an uncited factual paragraph", () => {
  const result = validateClaimCitationCoverage({
    answer: "The tested wall achieved 52 dB.\n\nFurther testing is required. [D1]",
    allowGeneralKnowledge: false,
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /C1.*without a retrieved evidence marker/);
});

test("claim coverage keeps general knowledge separate from retrieved evidence", () => {
  const result = validateClaimCitationCoverage({
    answer: "The report records a 52 dB result [D1], while general practice suggests a margin [G1].",
    allowGeneralKnowledge: true,
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /mixes retrieved evidence and general knowledge/);
});

test("claim audit exposes only the excerpts cited by each claim", () => {
  const claims = extractCitedClaimBlocks(
    "The report records a 52 dB result. [D1]\n\nThe standard defines the method. [S1]",
  );
  const audit = buildClaimEvidenceAudit({ claims, citations: mixedCitations });

  assert.deepEqual(audit.claims[0].evidence, [
    { marker: "D1", excerpt: "A controlled passage." },
  ]);
  assert.deepEqual(audit.claims[1].evidence, [
    { marker: "S1", excerpt: "Field measurement method." },
  ]);
});

test("claim audit fails closed on an unsupported verdict or omitted claim", () => {
  const claims = extractCitedClaimBlocks(
    "The report records a 52 dB result. [D1]\n\nThe standard defines the method. [S1]",
  );
  const result = validateClaimSupportVerdicts({
    claims,
    verdicts: [{ claimId: "C1", supported: false, reason: "The excerpt contains no value." }],
  });

  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /C1 is not supported/);
  assert.match(result.errors.join(" "), /omitted C2/);
  assert.deepEqual(result.unsupportedClaimIds, ["C1"]);
});
