const baseUrl = "http://127.0.0.1:8080";
const validationHeaders = {
  "content-type": "application/json",
  "x-ms-client-principal-id": "00000000-0000-4000-8000-000000000001",
  "x-ms-client-principal-name": "Helmonic release validation",
};

const tests = [
  { id: "definition-acoustics", question: "What is acoustics?", minimumLength: 120 },
  {
    id: "definition-sound-engineering",
    question: "What is sound engineering?",
    minimumLength: 120,
    mustContain: /sound|audio|acoustic/i,
  },
  {
    id: "definition-acoustic-panels",
    question: "What are acoustic panels?",
    minimumLength: 120,
    mustContain: /absorp|reflect|reverber/i,
  },
  {
    id: "airborne-standard",
    question: "What standard should I use for airborne sound insulation testing?",
    minimumLength: 120,
    requireCitation: true,
  },
  {
    id: "project-wetherspoon",
    question:
      "How serious was the beer-garden noise compared with the background at number 7 Camden Street?",
    minimumLength: 100,
    mustContain: /19\s*dB/i,
    requireCitation: true,
  },
];

async function main() {
  for (const test of tests) {
    const response = await fetch(`${baseUrl}/api/consult/query`, {
      method: "POST",
      headers: validationHeaders,
      body: JSON.stringify({
        question: test.question,
        includeGeneralContext: true,
      }),
      signal: AbortSignal.timeout(180_000),
    });

    const payload = await response.json().catch(() => ({}));
    const answer = typeof payload.answer === "string" ? payload.answer.trim() : "";
    const citations = Array.isArray(payload.citations) ? payload.citations : [];

    if (!response.ok) {
      throw new Error(
        `${test.id} returned HTTP ${response.status}; request=${payload.requestId ?? "unknown"}; error=${payload.error ?? "unavailable"}`,
      );
    }
    if (payload.mode !== "generated") {
      throw new Error(`${test.id} did not generate an answer; mode=${payload.mode ?? "unknown"}.`);
    }
    if (answer.length < test.minimumLength) {
      throw new Error(`${test.id} answer was only ${answer.length} characters.`);
    }
    if (/no generated summary/i.test(answer)) {
      throw new Error(`${test.id} regressed to retrieval-only prose.`);
    }
    if (test.mustContain && !test.mustContain.test(answer)) {
      throw new Error(`${test.id} omitted its required technical or project fact.`);
    }
    if (test.requireCitation && citations.length === 0) {
      throw new Error(`${test.id} returned no verified citations.`);
    }
    if (citations.length === 0 && !/\[G\d+\]/.test(answer)) {
      throw new Error(`${test.id} has neither citations nor labelled general knowledge.`);
    }

    console.log(
      `SMOKE_CASE=${test.id}|mode=${payload.mode}|length=${answer.length}|citations=${citations.length}|web=${payload.webEvidenceStatus}`,
    );
  }

  console.log("SMOKE_ALL_PASSED");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`SMOKE_FAILED=${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
