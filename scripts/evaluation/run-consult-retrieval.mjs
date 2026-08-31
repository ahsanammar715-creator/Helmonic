import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  REVIEWABLE_HYBRID_THRESHOLDS,
  buildControlledHybridSearchRequest,
  buildControlledTableSiblingRequest,
  mergeControlledPageEvidence,
  retainRelevantHybridDocuments,
} from "../../src/lib/consult/search-policy.ts";
import { createUserAssignedManagedIdentityCredential } from "../managed-identity.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(
  await readFile(join(scriptDirectory, "consult-retrieval.json"), "utf8"),
);
const live = process.argv.includes("--live");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for --live evaluation`);
  return value;
}

function includesAny(values, expectedValues) {
  return expectedValues.some((expected) =>
    values.some((value) => value.toLowerCase().includes(expected.toLowerCase())),
  );
}

function includesEvery(values, expectedValues) {
  const combined = values.join(" ").toLowerCase().replace(/\s+/g, "");
  return expectedValues.every((expected) =>
    combined.includes(expected.toLowerCase().replace(/\s+/g, "")),
  );
}

function validateSuite() {
  if (suite.version !== 2 || !Array.isArray(suite.cases) || suite.cases.length < 8) {
    throw new Error("Hybrid retrieval evaluation suite must contain at least eight version-2 cases");
  }
  if (
    suite.thresholds?.semantic !== REVIEWABLE_HYBRID_THRESHOLDS.semantic ||
    suite.thresholds?.rrf !== REVIEWABLE_HYBRID_THRESHOLDS.rrf
  ) {
    throw new Error("Evaluation thresholds must match the reviewable runtime policy");
  }

  const ids = new Set();
  const categories = new Set();
  for (const evaluationCase of suite.cases) {
    if (!evaluationCase.id || ids.has(evaluationCase.id)) {
      throw new Error("Every retrieval evaluation case needs a unique id");
    }
    if (!evaluationCase.question?.trim() || !evaluationCase.category) {
      throw new Error(`Evaluation case ${evaluationCase.id} needs a question and category`);
    }
    if (
      evaluationCase.expectedNoEvidence !== true &&
      (!Array.isArray(evaluationCase.expectedTitleIncludes) ||
        evaluationCase.expectedTitleIncludes.length === 0)
    ) {
      throw new Error(
        `Evaluation case ${evaluationCase.id} needs expected titles or expectedNoEvidence`,
      );
    }
    ids.add(evaluationCase.id);
    categories.add(evaluationCase.category);
  }

  for (const requiredCategory of [
    "paraphrase",
    "regression",
    "numeric",
    "out-of-scope",
    "permission",
  ]) {
    if (!categories.has(requiredCategory)) {
      throw new Error(`Evaluation suite is missing ${requiredCategory} coverage`);
    }
  }

  const policy = buildControlledHybridSearchRequest(
    "project evidence",
    "iAcoustics",
    4,
    [0.1, 0.2],
    { vectorK: 50, semanticConfiguration: "consult-semantic-v2" },
  );
  if (
    policy.queryType !== "semantic" ||
    policy.vectorFilterMode !== "preFilter" ||
    policy.searchFields !== "title,section,content" ||
    policy.vectorQueries[0]?.fields !== "content_vector" ||
    policy.filter !== "permission_scope eq 'iAcoustics'"
  ) {
    throw new Error("Controlled hybrid retrieval must remain semantic, vectorized, and pre-filtered");
  }
}

async function createEmbedding(endpoint, deployment, apiVersion, dimensions, token, input) {
  const response = await fetch(
    `${endpoint}/openai/deployments/${encodeURIComponent(
      deployment,
    )}/embeddings?api-version=${encodeURIComponent(apiVersion)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-ms-client-request-id": crypto.randomUUID(),
      },
      body: JSON.stringify({ input, dimensions }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Evaluation embedding failed with ${response.status}`);
  }
  const payload = await response.json();
  const vector = payload.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== dimensions) {
    throw new Error("Evaluation embedding has the wrong dimensions");
  }
  return vector;
}

async function runLiveEvaluation() {
  const endpoint = required("AZURE_SEARCH_ENDPOINT").replace(/\/+$/, "");
  const indexName = required("AZURE_SEARCH_INDEX");
  const apiVersion = process.env.AZURE_SEARCH_API_VERSION?.trim() || "2025-09-01";
  const embeddingEndpoint = (
    process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT || required("AZURE_OPENAI_ENDPOINT")
  ).replace(/\/+$/, "");
  const embeddingDeployment = required("AZURE_OPENAI_EMBEDDING_DEPLOYMENT");
  const embeddingApiVersion =
    process.env.AZURE_OPENAI_EMBEDDING_API_VERSION?.trim() || "2024-10-21";
  const embeddingDimensions = Number.parseInt(
    process.env.AZURE_OPENAI_EMBEDDING_DIMENSIONS || "1536",
    10,
  );
  const semanticConfiguration = required("AZURE_SEARCH_SEMANTIC_CONFIGURATION");
  const credential = createUserAssignedManagedIdentityCredential();
  const [searchAccessToken, embeddingAccessToken] = await Promise.all([
    credential.getToken("https://search.azure.com/.default"),
    credential.getToken("https://cognitiveservices.azure.com/.default"),
  ]);
  if (!searchAccessToken?.token || !embeddingAccessToken?.token) {
    throw new Error("Azure managed-identity tokens are unavailable");
  }

  const outcomes = [];
  for (const evaluationCase of suite.cases) {
    const vector = await createEmbedding(
      embeddingEndpoint,
      embeddingDeployment,
      embeddingApiVersion,
      embeddingDimensions,
      embeddingAccessToken.token,
      evaluationCase.question,
    );
    const vectorRequest = buildControlledHybridSearchRequest(
      evaluationCase.question,
      evaluationCase.permissionScope || suite.profile,
      4,
      vector,
      { vectorK: 50, semanticConfiguration },
    );
    const response = await fetch(
      `${endpoint}/indexes/${encodeURIComponent(indexName)}/docs/search?api-version=${encodeURIComponent(apiVersion)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${searchAccessToken.token}`,
          "Content-Type": "application/json",
          "x-ms-client-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify(vectorRequest),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Search evaluation ${evaluationCase.id} failed with ${response.status}`);
    }

    const payload = await response.json();
    const rawResults = Array.isArray(payload.value) ? payload.value : [];
    let results = retainRelevantHybridDocuments(rawResults, {
      scoreKind: "semantic",
      minimumScore: suite.thresholds.semantic,
    });
    const thresholdRetainedCount = results.length;
    let samePageTableCount = 0;
    const tableSiblingRequest = buildControlledTableSiblingRequest(
      results,
      evaluationCase.permissionScope || suite.profile,
      4,
    );
    if (tableSiblingRequest) {
      const siblingResponse = await fetch(
        `${endpoint}/indexes/${encodeURIComponent(indexName)}/docs/search?api-version=${encodeURIComponent(apiVersion)}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${searchAccessToken.token}`,
            "Content-Type": "application/json",
            "x-ms-client-request-id": crypto.randomUUID(),
          },
          body: JSON.stringify(tableSiblingRequest),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!siblingResponse.ok) {
        throw new Error(
          `Search table expansion ${evaluationCase.id} failed with ${siblingResponse.status}`,
        );
      }
      const siblingPayload = await siblingResponse.json();
      const samePageTables = Array.isArray(siblingPayload.value) ? siblingPayload.value : [];
      samePageTableCount = samePageTables.length;
      results = mergeControlledPageEvidence(results, samePageTables);
    }
    const titles = results.map((result) => String(result.title || ""));
    const contents = results.map((result) => String(result.content || ""));
    const expectedTitles = evaluationCase.expectedTitleIncludes || [];
    const forbiddenTitles = evaluationCase.forbiddenTitleIncludes || [];
    const expectedContents = evaluationCase.expectedContentIncludes || [];
    const passed = evaluationCase.expectedNoEvidence
      ? results.length === 0
      : results.length >= (evaluationCase.minimumCitations || 1) &&
        includesAny(titles, expectedTitles) &&
        !includesAny(titles, forbiddenTitles) &&
        includesEvery(contents, expectedContents);

    outcomes.push({
      id: evaluationCase.id,
      passed,
      rawResultCount: rawResults.length,
      thresholdRetainedCount,
      samePageTableCount,
      retainedResultCount: results.length,
      titles,
      scores: results.map((result) => ({
        rrf: result["@search.score"],
        semantic: result["@search.rerankerScore"],
      })),
    });
  }

  const failures = outcomes.filter((outcome) => !outcome.passed);
  process.stdout.write(
    `${JSON.stringify({ status: failures.length ? "failed" : "passed", outcomes }, null, 2)}\n`,
  );
  if (failures.length) process.exitCode = 1;
}

validateSuite();

if (live) {
  await runLiveEvaluation();
} else {
  process.stdout.write(
    `${JSON.stringify({
      status: "validated",
      cases: suite.cases.length,
      thresholds: suite.thresholds,
      live: false,
    })}\n`,
  );
}
