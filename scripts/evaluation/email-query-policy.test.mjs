import assert from "node:assert/strict";
import test from "node:test";

import {
  actorMayReadRestrictedEmailEvidence,
  emailEvidenceConfigurationErrors,
} from "../../src/lib/consult/email-evidence-policy.ts";
import { buildRestrictedEmailSearchRequest } from "../../src/lib/consult/email-search-policy.ts";
import {
  buildDeidentifiedExperienceEvidence,
  deidentifyExperienceText,
  minimumExperienceProjectCount,
  validateDeidentifiedExperienceAnswer,
} from "../../src/lib/consult/experience-evidence-policy.ts";

function config() {
  return {
    search: {
      indexName: "consult-candidate-consolidated-2063-v1",
    },
    emailEvidence: {
      enabled: true,
      endpoint: "https://search.example.test",
      indexName: "consult-email-relationship-restricted-v1",
      managedIdentityClientId: "11111111-1111-4111-8111-111111111111",
      leadershipObjectIds: ["22222222-2222-4222-8222-222222222222"],
      leadershipGroupIds: ["33333333-3333-4333-8333-333333333333"],
    },
  };
}

test("email evidence must use a separate index and dedicated identity", () => {
  assert.deepEqual(emailEvidenceConfigurationErrors(config()), []);

  const invalid = config();
  invalid.emailEvidence.indexName = invalid.search.indexName;
  assert.match(emailEvidenceConfigurationErrors(invalid).join(" "), /separate index/);
});

test("only configured leadership users or groups pass the access gate", () => {
  const direct = {
    objectId: "22222222-2222-4222-8222-222222222222",
    groupObjectIds: [],
  };
  const group = {
    objectId: "44444444-4444-4444-8444-444444444444",
    groupObjectIds: ["33333333-3333-4333-8333-333333333333"],
  };
  const ordinary = {
    objectId: "55555555-5555-4555-8555-555555555555",
    groupObjectIds: [],
  };

  assert.equal(actorMayReadRestrictedEmailEvidence(direct, config()), true);
  assert.equal(actorMayReadRestrictedEmailEvidence(group, config()), true);
  assert.equal(actorMayReadRestrictedEmailEvidence(ordinary, config()), false);
});

test("email search is bounded and requests only the evidence fields needed by Consult", () => {
  const request = buildRestrictedEmailSearchRequest("  architect relationship  ", 200);

  assert.equal(request.search, "architect relationship");
  assert.equal(request.top, 20);
  assert.match(request.searchFields, /relationship_people/);
  assert.match(request.select, /evidence_ref/);
  assert.doesNotMatch(request.select, /attachment/);
});

test("experience sanitizer removes direct identifiers while retaining technical substance", () => {
  const text = deidentifyExperienceText(
    "From: Jane Architect <jane@example.com>\nSubject: J2701 Goatstown PBSA\nJane Architect at Example Design confirmed that the riser detail required an acoustic seal on 12/09/2026. Call 086 200 8748.",
    ["Jane Architect", "Example Design", "Goatstown PBSA", "J2701"],
  );

  assert.doesNotMatch(text, /Jane|Example Design|Goatstown|J2701|jane@example|086 200 8748|12\/09\/2026/i);
  assert.match(text, /riser detail required an acoustic seal/i);
});

function experienceDocument(projectName, number) {
  return {
    score: 10 - number,
    chunkId: `chunk-${number}`,
    messageId: `message-${number}`,
    evidenceRef: `[E:glen:${number}]`,
    bodyText:
      "The consultant coordination record identified a recurring need to close service penetrations and confirm the junction detail before installation to avoid acoustic leakage during construction.",
    subject: `${projectName} coordination`,
    mailboxOwner: "glen.plunkett@iacoustics.net",
    participants: [`person${number}@example.com`],
    participantNames: [`Person ${number}`],
    firm: `Firm ${number}`,
    projectNames: [projectName],
    relationshipPeople: [`Person ${number}`],
  };
}

test("experience evidence fails closed with fewer than three distinct projects", () => {
  const result = buildDeidentifiedExperienceEvidence([
    experienceDocument("Project Alpha", 1),
    experienceDocument("Project Beta", 2),
  ]);

  assert.equal(minimumExperienceProjectCount, 3);
  assert.deepEqual(result.citations, []);
  assert.deepEqual(result.auditSources, []);
});

test("experience evidence exposes generic cases while retaining private traceability", () => {
  const result = buildDeidentifiedExperienceEvidence([
    experienceDocument("Project Alpha", 1),
    experienceDocument("Project Beta", 2),
    experienceDocument("Project Gamma", 3),
  ]);

  assert.equal(result.citations.length, 3);
  assert.equal(result.auditSources.length, 3);
  assert.deepEqual(result.citations.map((citation) => citation.marker), ["E1", "E2", "E3"]);
  for (const citation of result.citations) {
    assert.equal(citation.sourceType, "experience");
    assert.match(citation.title, /^De-identified experience case \d+$/);
    assert.equal(citation.sourceUri, undefined);
    assert.doesNotMatch(JSON.stringify(citation), /message-|Project Alpha|Project Beta|Project Gamma|example\.com/i);
  }
  assert.deepEqual(result.auditSources.map((source) => source.messageId), [
    "message-1",
    "message-2",
    "message-3",
  ]);
});

test("experience answers require three cases and prohibit evidence-channel disclosure", () => {
  const citations = [1, 2, 3].map((number) => ({
    id: `experience-case-${number}`,
    title: `De-identified experience case ${number}`,
    sourceId: `experience-case-${number}`,
    excerpt: "A generic technical pattern.",
    sourceType: "experience",
    citationNamespace: "E",
    marker: `E${number}`,
  }));
  const accepted = validateDeidentifiedExperienceAnswer(
    "Based on experience across comparable projects, early coordination of junction details reduced rework during construction. [E1] [E2] [E3]",
    citations,
  );
  const tooFew = validateDeidentifiedExperienceAnswer(
    "Based on experience across comparable projects, early coordination reduced rework. [E1] [E2]",
    citations,
  );
  const disclosed = validateDeidentifiedExperienceAnswer(
    "Based on experience across comparable projects, the client conversation confirms the point. [E1] [E2] [E3]",
    citations,
  );

  assert.equal(accepted.valid, true);
  assert.equal(tooFew.valid, false);
  assert.equal(disclosed.valid, false);
});
