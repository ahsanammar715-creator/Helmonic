import assert from "node:assert/strict";
import test from "node:test";

import {
  buildControlledHybridSearchRequest,
  buildControlledTableSiblingRequest,
  mergeControlledPageEvidence,
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

test("same-page table expansion remains permission scoped and bounded", () => {
  const request = buildControlledTableSiblingRequest(
    [
      { chunk_id: "a", source_id: "source'one", page_number: 7 },
      { chunk_id: "b", source_id: "source'one", page_number: 7 },
      { chunk_id: "c", source_id: "source-two", page_number: 3 },
      { chunk_id: "invalid", source_id: "source-three" },
    ],
    "scope'one",
    4,
  );

  assert.ok(request);
  assert.equal(request.search, "*");
  assert.equal(request.queryType, "simple");
  assert.equal(request.top, 2);
  assert.match(request.filter, /permission_scope eq 'scope''one'/);
  assert.match(request.filter, /chunk_kind eq 'table'/);
  assert.match(request.filter, /source_id eq 'source''one' and page_number eq 7/);
  assert.match(request.filter, /source_id eq 'source-two' and page_number eq 3/);
});

test("same-page table evidence is merged after ranked evidence without duplicates", () => {
  const merged = mergeControlledPageEvidence(
    [
      { chunk_id: "ranked", content: "ranked" },
      { chunk_id: "table", content: "already present" },
    ],
    [
      { chunk_id: "table", content: "duplicate" },
      { chunk_id: "sibling", content: "66dB - 47dB = 19dB" },
    ],
  );

  assert.deepEqual(
    merged.map((document) => document.chunk_id),
    ["ranked", "table", "sibling"],
  );
});

test("same-page table expansion skips evidence without a source and page", () => {
  assert.equal(
    buildControlledTableSiblingRequest(
      [
        { chunk_id: "missing-page", source_id: "source" },
        { chunk_id: "missing-source", page_number: 7 },
      ],
      "scope",
    ),
    null,
  );
});
