import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DefaultAzureCredential } from "@azure/identity";

import { buildControlledSearchRequest } from "../../src/lib/consult/search-policy.ts";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(
  await readFile(join(scriptDirectory, "consult-retrieval.json"), "utf8"),
);
const live = process.argv.includes("--live");

function validateSuite() {
  if (suite.version !== 1 || !Array.isArray(suite.cases) || suite.cases.length < 5) {
    throw new Error("Retrieval evaluation suite must contain at least five version-1 cases");
  }

  const ids = new Set();
  for (const evaluationCase of suite.cases) {
    if (!evaluationCase.id || ids.has(evaluationCase.id)) {
      throw new Error("Every retrieval evaluation case needs a unique id");
    }
    if (!evaluationCase.question?.trim()) {
      throw new Error(`Evaluation case ${evaluationCase.id} needs a question`);
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
  }

  const policy = buildControlledSearchRequest("project evidence", suite.profile, 4);
  if (
    policy.searchMode !== "all" ||
    policy.searchFields !== "title,section,content"
  ) {
    throw new Error("Controlled retrieval policy must remain precision-first and title-aware");
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for --live evaluation`);
  return value;
}

async function runLiveEvaluation() {
  const endpoint = required("AZURE_SEARCH_ENDPOINT").replace(/\/+$/, "");
  const indexName = required("AZURE_SEARCH_INDEX");
  const apiVersion = process.env.AZURE_SEARCH_API_VERSION?.trim() || "2025-09-01";
  const credential = new DefaultAzureCredential();
  const accessToken = await credential.getToken("https://search.azure.com/.default");
  if (!accessToken?.token) throw new Error("Azure Search access token unavailable");

  const outcomes = [];
  for (const evaluationCase of suite.cases) {
    const response = await fetch(
      `${endpoint}/indexes/${encodeURIComponent(indexName)}/docs/search?api-version=${encodeURIComponent(apiVersion)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken.token}`,
          "Content-Type": "application/json",
          "x-ms-client-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify(
          buildControlledSearchRequest(evaluationCase.question, suite.profile, 4),
        ),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new Error(`Search evaluation ${evaluationCase.id} failed with ${response.status}`);
    }

    const payload = await response.json();
    const results = Array.isArray(payload.value) ? payload.value : [];
    const titles = results.map((result) => String(result.title || ""));
    const passed = evaluationCase.expectedNoEvidence
      ? results.length === 0
      : results.length >= (evaluationCase.minimumCitations || 1) &&
        evaluationCase.expectedTitleIncludes.some((expected) =>
          titles.some((title) => title.toLowerCase().includes(expected.toLowerCase())),
        );

    outcomes.push({ id: evaluationCase.id, passed, resultCount: results.length, titles });
  }

  const failures = outcomes.filter((outcome) => !outcome.passed);
  process.stdout.write(`${JSON.stringify({ status: failures.length ? "failed" : "passed", outcomes }, null, 2)}\n`);
  if (failures.length) process.exitCode = 1;
}

validateSuite();

if (live) {
  await runLiveEvaluation();
} else {
  process.stdout.write(
    `${JSON.stringify({ status: "validated", cases: suite.cases.length, live: false })}\n`,
  );
}
