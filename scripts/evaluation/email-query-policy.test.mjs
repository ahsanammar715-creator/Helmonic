import assert from "node:assert/strict";
import test from "node:test";

import {
  actorMayReadRestrictedEmailEvidence,
  emailEvidenceConfigurationErrors,
} from "../../src/lib/consult/email-evidence-policy.ts";
import { buildRestrictedEmailSearchRequest } from "../../src/lib/consult/email-search-policy.ts";

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
