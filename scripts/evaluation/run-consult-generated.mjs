import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const suite = JSON.parse(
  await readFile(join(scriptDirectory, "consult-retrieval.json"), "utf8"),
);
const live = process.argv.includes("--live");

function answerMarkers(answer) {
  return Array.from(answer.matchAll(/\[([DA]\d+)\]/g), (match) => match[1]);
}

function validateGeneratedAnswer(answer, citations) {
  const allowed = new Set(
    citations.map((citation, index) => citation.marker || `D${index + 1}`),
  );
  const markers = answerMarkers(answer);
  return {
    markers,
    valid:
      Boolean(answer.trim()) &&
      markers.length > 0 &&
      markers.every((marker) => allowed.has(marker)) &&
      !/\[(?:G\d+|\d+)\]/.test(answer),
  };
}

function validateSuiteAndPolicy() {
  if (suite.version !== 1 || !Array.isArray(suite.cases) || suite.cases.length < 5) {
    throw new Error("Generated-answer suite must contain at least five version-1 cases");
  }

  const citations = [{ marker: "D1" }, { marker: "A1" }];
  const contracts = [
    validateGeneratedAnswer("Supported statement. [D1]", citations).valid,
    validateGeneratedAnswer("Supported attachment. [A1]", citations).valid,
    !validateGeneratedAnswer("Unsupported marker. [D2]", citations).valid,
    !validateGeneratedAnswer("General marker. [G1]", citations).valid,
    !validateGeneratedAnswer("Missing citation.", citations).valid,
  ];
  if (contracts.some((passed) => !passed)) {
    throw new Error("Generated-answer citation policy validation failed");
  }
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for --live evaluation`);
  return value;
}

async function runLiveEvaluation() {
  const endpoint = required("HELMONIC_CONSULT_URL").replace(/\/+$/, "");
  const outcomes = [];

  for (const evaluationCase of suite.cases) {
    const response = await fetch(`${endpoint}/api/consult/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ms-client-request-id": crypto.randomUUID(),
      },
      body: JSON.stringify({ question: evaluationCase.question }),
      cache: "no-store",
      signal: AbortSignal.timeout(150_000),
    });
    const payload = await response.json();

    if (!response.ok) {
      outcomes.push({
        id: evaluationCase.id,
        passed: false,
        status: response.status,
        error: payload.error || "request failed",
      });
      continue;
    }

    const citations = Array.isArray(payload.citations) ? payload.citations : [];
    const titles = citations.map((citation) => String(citation.title || ""));
    if (evaluationCase.expectedNoEvidence) {
      outcomes.push({
        id: evaluationCase.id,
        passed:
          payload.mode === "no-evidence" &&
          payload.answer === null &&
          citations.length === 0,
        mode: payload.mode,
        citationCount: citations.length,
        titles,
      });
      continue;
    }

    const answer = typeof payload.answer === "string" ? payload.answer : "";
    const citationValidation = validateGeneratedAnswer(answer, citations);
    const expectedTitle = evaluationCase.expectedTitleIncludes.some((expected) =>
      titles.some((title) => title.toLowerCase().includes(expected.toLowerCase())),
    );
    outcomes.push({
      id: evaluationCase.id,
      passed:
        payload.mode === "generated" &&
        citations.length >= (evaluationCase.minimumCitations || 1) &&
        expectedTitle &&
        citationValidation.valid,
      mode: payload.mode,
      citationCount: citations.length,
      markers: citationValidation.markers,
      titles,
    });
  }

  const failures = outcomes.filter((outcome) => !outcome.passed);
  process.stdout.write(
    `${JSON.stringify({ status: failures.length ? "failed" : "passed", outcomes }, null, 2)}\n`,
  );
  if (failures.length) process.exitCode = 1;
}

validateSuiteAndPolicy();

if (live) {
  await runLiveEvaluation();
} else {
  process.stdout.write(
    `${JSON.stringify({ status: "validated", cases: suite.cases.length, live: false })}\n`,
  );
}
