import assert from "node:assert/strict";
import test from "node:test";

import {
  CANDIDATE_INDEX,
  buildSearchRequest,
  diagnosticConfiguration,
  diagnosticQueries,
} from "./candidate-ranking-diagnostic-contract.mjs";

const valid = {
  AZURE_SEARCH_ENDPOINT: "https://srch-helmonic-dev-001.search.windows.net/",
  AZURE_SEARCH_INDEX: CANDIDATE_INDEX,
  EXPECTED_SOURCE_ID: "src-779696c36d01b083fc855b9c",
};

test("diagnostic is pinned to the existing candidate index", () => {
  assert.equal(diagnosticConfiguration(valid).index, CANDIDATE_INDEX);
  assert.throws(
    () => diagnosticConfiguration({ ...valid, AZURE_SEARCH_INDEX: "consult-demo-v2" }),
    /pinned/,
  );
});

test("diagnostic requests are query-only and semantic", () => {
  const configuration = diagnosticConfiguration(valid);
  const request = buildSearchRequest(diagnosticQueries[0].text, configuration);
  assert.equal(request.queryType, "semantic");
  assert.equal(request.semanticConfiguration, "consult-semantic-v2");
  assert.equal(request.vectorQueries, undefined);
  assert.equal(request.actions, undefined);
  assert.equal(request.top, 50);
});
