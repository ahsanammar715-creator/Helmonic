import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectOfficialSourceSnapshot } from "../../src/lib/tender-intelligence/official-sources.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const envPath = path.join(repoRoot, ".env.local");
const outputPath = path.join(
  repoRoot,
  "local-artifacts",
  "tender-intelligence",
  "live-source-status.json",
);

function parseEnv(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
      .map((line) => {
        const delimiter = line.indexOf("=");
        return [line.slice(0, delimiter), line.slice(delimiter + 1)];
      }),
  );
}

let localEnv = {};
try {
  localEnv = parseEnv(await readFile(envPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const value = (name) => process.env[name]?.trim() || localEnv[name]?.trim();
const snapshot = await collectOfficialSourceSnapshot({
  planningLeads: {
    enabled: value("HELMONIC_PLANNINGLEADS_ENABLED") === "true",
    endpoint: value("PLANNINGLEADS_API_ENDPOINT") || "https://planningleads.ie/api/v1",
    apiKey: value("PLANNINGLEADS_API_KEY"),
    pageSize: Number.parseInt(value("HELMONIC_PLANNINGLEADS_PAGE_SIZE") || "100", 10),
    cacheHours: 1,
  },
});

const countsBySource = Object.fromEntries(
  snapshot.opportunities.reduce((counts, opportunity) => {
    counts.set(opportunity.sourceSystem, (counts.get(opportunity.sourceSystem) || 0) + 1);
    return counts;
  }, new Map()),
);
const classificationCounts = Object.fromEntries(
  snapshot.opportunities.reduce((counts, opportunity) => {
    const key = opportunity.classification || "formal-public-tender";
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map()),
);
const dccEvidence = snapshot.opportunities.filter((opportunity) =>
  opportunity.type === "planning-pipeline-lead" &&
  (opportunity.sourceSystem === "DCC" || /dublin city council/i.test(opportunity.planningAuthority || "")),
);
const dccDocumentAudit = {
  applicationsInspected: dccEvidence.length,
  evidenceStatusCounts: Object.fromEntries(
    dccEvidence.reduce((counts, opportunity) => {
      counts.set(opportunity.evidenceStatus, (counts.get(opportunity.evidenceStatus) || 0) + 1);
      return counts;
    }, new Map()),
  ),
  listedDocuments: dccEvidence.reduce((count, opportunity) => count + (opportunity.evidenceDocuments?.length || 0), 0),
  fetchedDocuments: dccEvidence.reduce(
    (count, opportunity) => count + (opportunity.evidenceDocuments || []).filter((document) => document.fetchStatus === "fetched").length,
    0,
  ),
  confirmedPlanningOpportunities: dccEvidence.filter((opportunity) => [
    "noise-related-rfi",
    "granted-with-noise-conditions",
    "refused-on-noise-grounds",
  ].includes(opportunity.classification)).length,
};
const nationalAuthorities = new Set(
  snapshot.opportunities
    .filter((opportunity) => opportunity.sourceSystem === "National Planning Register")
    .map((opportunity) => opportunity.planningAuthority)
    .filter(Boolean),
).size;
const result = {
  checkedAtUtc: snapshot.generatedAt,
  probe: "fresh-read-through-production-collector",
  writeOperations: 0,
  sources: snapshot.sources,
  totalCurrentOpportunities: snapshot.opportunities.length,
  countsBySource,
  classificationCounts,
  nationalAuthorities,
  dccDocumentAudit,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...result, reportPath: outputPath }, null, 2));

if (snapshot.sources.some((source) => source.status === "failed")) process.exitCode = 1;
