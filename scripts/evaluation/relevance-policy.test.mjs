import assert from "node:assert/strict";
import test from "node:test";

import {
  buildControlledEvidenceExcerpt,
  buildControlledHybridSearchRequest,
  normalizeControlledSearchQuery,
  retainRelevantHybridDocuments,
} from "../../src/lib/consult/search-policy.ts";

test("semantic relevance threshold fails closed on missing or weak scores", () => {
  const retained = retainRelevantHybridDocuments(
    [
      { id: "missing", "@search.score": 0.03 },
      { id: "weak", "@search.rerankerScore": 1.99 },
      { id: "boundary", "@search.rerankerScore": 2 },
      { id: "strong", "@search.rerankerScore": 3.2 },
    ],
    { scoreKind: "semantic", minimumScore: 2 },
  );
  assert.deepEqual(retained.map((document) => document.id), ["boundary", "strong"]);
});

test("RRF fallback uses only the configured RRF score", () => {
  const retained = retainRelevantHybridDocuments(
    [
      { id: "weak", "@search.score": 0.0149, "@search.rerankerScore": 4 },
      { id: "boundary", "@search.score": 0.015 },
    ],
    { scoreKind: "rrf", minimumScore: 0.015 },
  );
  assert.deepEqual(retained.map((document) => document.id), ["boundary"]);
});

test("hybrid request applies permission scope before HNSW scoring", () => {
  const request = buildControlledHybridSearchRequest(
    "How did the project perform?",
    "scope'with-quote",
    4,
    [0.25, -0.5],
    { vectorK: 50, semanticConfiguration: "consult-semantic-v2" },
  );
  assert.equal(request.filter, "permission_scope eq 'scope''with-quote'");
  assert.equal(request.vectorFilterMode, "preFilter");
  assert.equal(request.queryType, "semantic");
  assert.match(request.select, /chunk_kind/);
  assert.equal(request.vectorQueries[0].fields, "content_vector");
  assert.equal(request.vectorQueries[0].k, 50);
});

test("hybrid request rejects empty or malformed embeddings", () => {
  assert.throws(
    () =>
      buildControlledHybridSearchRequest("question", "scope", 4, [], {
        vectorK: 50,
      }),
    /finite query embedding/,
  );
  assert.throws(
    () =>
      buildControlledHybridSearchRequest("question", "scope", 4, [Number.NaN], {
        vectorK: 50,
      }),
    /finite query embedding/,
  );
});

test("table evidence preserves numeric comparisons beyond the narrative excerpt limit", () => {
  const tableEvidence = `${"Narrative context ".repeat(250)}\n\nTable 1\n| Description | 125Hz | 250Hz | 500Hz |\n| --- | --- | --- | --- |\n| Noise Levels Impacting on Bedroom Window | 47 | 51 | 54 |\n\nTable 2\n| Noise Type | Result |\n| --- | --- |\n| Rating Level | 66dB |\n| Background Sound Level | 47dB |\n| Excess | 19dB |`;
  const excerpt = buildControlledEvidenceExcerpt(tableEvidence, "table");

  assert.match(excerpt, /^Table 1/);
  assert.match(excerpt, /500Hz/);
  assert.match(excerpt, /Bedroom Window \| 47 \| 51 \| 54/);
  assert.match(excerpt, /66dB/);
  assert.match(excerpt, /47dB/);
  assert.match(excerpt, /19dB/);
  assert.equal(excerpt.length, 3_000);
});

test("numeric lookup keeps exact project, scenario, location, and frequency terms", () => {
  assert.equal(
    normalizeControlledSearchQuery(
      "For the future Wetherspoon scenario, what level was predicted at the bedroom window in the 500 Hz band?",
    ),
    "future Wetherspoon bedroom window 500 Hz",
  );
});

test("ordinary narrative evidence retains the compact 420-character bound", () => {
  const excerpt = buildControlledEvidenceExcerpt("Narrative context ".repeat(40), "text");
  assert.equal(excerpt.length, 420);
  assert.match(excerpt, /…$/);
});
