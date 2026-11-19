import { createUserAssignedManagedIdentityCredential } from "../managed-identity.mjs";
import {
  buildSearchRequest,
  diagnosticConfiguration,
  diagnosticQueries,
} from "./candidate-ranking-diagnostic-contract.mjs";

const configuration = diagnosticConfiguration();
const credential = createUserAssignedManagedIdentityCredential();
const accessToken = await credential.getToken("https://search.azure.com/.default");
if (!accessToken?.token) throw new Error("Search managed-identity token is unavailable");

async function search(request) {
  const response = await fetch(
    `${configuration.endpoint}/indexes/${encodeURIComponent(configuration.index)}/docs/search?api-version=${encodeURIComponent(configuration.apiVersion)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        "Content-Type": "application/json",
        "x-ms-client-request-id": crypto.randomUUID(),
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Read-only Search query failed with ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function compactResult(result, rank) {
  return {
    rank,
    sourceId: result.source_id,
    chunkId: result.chunk_id,
    title: result.title,
    page: result.page_number,
    chunkKind: result.chunk_kind,
    searchScore: result["@search.score"],
    rerankerScore: result["@search.rerankerScore"] ?? null,
  };
}

async function directLookup(sourceId) {
  const escaped = sourceId.replaceAll("'", "''");
  const payload = await search({
    search: "*",
    filter: `source_id eq '${escaped}'`,
    select: "chunk_id,source_id,title,section,page_number,chunk_kind,content",
    count: true,
    top: 100,
  });
  return {
    count: payload["@odata.count"],
    chunks: (payload.value || []).map((result, index) => compactResult(result, index + 1)),
  };
}

async function rankSource(query, sourceId, mode) {
  const pageSize = 1000;
  if (mode === "semantic") {
    const payload = await search(buildSearchRequest(query, configuration, { top: 50, mode }));
    const values = payload.value || [];
    const relative = values.findIndex((result) => result.source_id === sourceId);
    return {
      mode,
      query,
      rank: relative >= 0 ? relative + 1 : null,
      rankLowerBound: relative >= 0 ? null : values.length,
      matchingChunk: relative >= 0 ? compactResult(values[relative], relative + 1) : null,
      resultCount: payload["@odata.count"] ?? values.length,
      topFive: values.slice(0, 5).map((result, index) => compactResult(result, index + 1)),
    };
  }
  let skip = 0;
  let total = null;
  const topFive = [];
  while (skip < 5000) {
    const payload = await search(
      buildSearchRequest(query, configuration, { top: pageSize, skip, mode: "simple" }),
    );
    const values = payload.value || [];
    total ??= payload["@odata.count"] ?? values.length;
    if (skip === 0) {
      topFive.push(...values.slice(0, 5).map((result, index) => compactResult(result, index + 1)));
    }
    const relative = values.findIndex((result) => result.source_id === sourceId);
    if (relative >= 0) {
      return {
        mode,
        query,
        rank: skip + relative + 1,
        matchingChunk: compactResult(values[relative], skip + relative + 1),
        resultCount: total,
        topFive,
      };
    }
    if (values.length < pageSize) break;
    skip += pageSize;
  }
  return { mode, query, rank: null, rankLowerBound: Math.min(total ?? 0, 5000), resultCount: total, topFive };
}

function peerQuery(title) {
  const clean = title.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return `Show me the drawing ${clean}`;
}

const expected = await directLookup(configuration.sourceId);
if (!expected.count) throw new Error(`Expected source ${configuration.sourceId} is absent from candidate index`);

const expectedRanks = [];
for (const item of diagnosticQueries) {
  expectedRanks.push({ id: item.id, ...(await rankSource(item.text, configuration.sourceId, "semantic")) });
  expectedRanks.push({ id: item.id, ...(await rankSource(item.text, configuration.sourceId, "simple")) });
}

const cohortPayload = await search(
  buildSearchRequest("floor plan drawing", configuration, { top: 50 }),
);
const peers = [];
const seen = new Set([configuration.sourceId]);
for (const result of cohortPayload.value || []) {
  const title = String(result.title || "");
  if (!/floor\s+plan|general\s+arrangement\s+plan/i.test(title) || seen.has(result.source_id)) continue;
  seen.add(result.source_id);
  peers.push({ sourceId: result.source_id, title });
  if (peers.length === 12) break;
}

const peerRanks = [];
for (const peer of peers) {
  const query = peerQuery(peer.title);
  peerRanks.push({ ...peer, ...(await rankSource(query, peer.sourceId, "semantic")) });
}

const rankedPeers = peerRanks.filter((item) => Number.isInteger(item.rank));
const ranks = rankedPeers.map((item) => item.rank).sort((a, b) => a - b);
const cohortSummary = {
  peerCount: peerRanks.length,
  found: rankedPeers.length,
  topFive: rankedPeers.filter((item) => item.rank <= 5).length,
  medianRank: ranks.length ? ranks[Math.floor(ranks.length / 2)] : null,
  queriesAreTitleDerived: true,
};

process.stdout.write(`${JSON.stringify({
  status: "complete",
  mode: "read-only-search-no-embeddings",
  limitation: "The prior hybrid-vector query embedding was not persisted; this bounded job measures direct presence and semantic/lexical ranking without creating a new embedding.",
  index: configuration.index,
  expectedSource: expected,
  expectedRanks,
  drawingCohort: cohortSummary,
  peerRanks,
}, null, 2)}\n`);
