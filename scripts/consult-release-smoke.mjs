const baseUrl = process.env.CONSULT_BASE_URL?.replace(/\/$/, "");
const accessToken = process.env.CONSULT_ACCESS_TOKEN;

if (!baseUrl || !accessToken) {
  throw new Error("CONSULT_BASE_URL and CONSULT_ACCESS_TOKEN are required.");
}

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

for (const test of tests) {
  const response = await fetch(`${baseUrl}/api/consult/query`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
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
    JSON.stringify({
      id: test.id,
      mode: payload.mode,
      citationCount: citations.length,
      webEvidenceStatus: payload.webEvidenceStatus,
      answerLength: answer.length,
    }),
  );
}
