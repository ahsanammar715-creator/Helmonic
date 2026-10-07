import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPlanningLeadsSearchUrls,
  filterRecentPlanningLeads,
  parsePlanningLeads,
} from "../../src/lib/tender-intelligence/official-sources.ts";
import { deduplicateOpportunities } from "../../src/lib/tender-intelligence/policy.ts";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const envPath = path.join(repoRoot, ".env.local");
const outputPath = process.argv[2] || path.join(
  repoRoot,
  "local-artifacts",
  "tender-intelligence",
  "planningleads-discovery-28.json",
);

const localEnv = Object.fromEntries(
  (await readFile(envPath, "utf8"))
    .split(/\r?\n/)
    .filter((line) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .map((line) => {
      const delimiter = line.indexOf("=");
      return [line.slice(0, delimiter), line.slice(delimiter + 1)];
    }),
);
const apiKey = process.env.PLANNINGLEADS_API_KEY?.trim() || localEnv.PLANNINGLEADS_API_KEY?.trim();
if (!apiKey) throw new Error("PlanningLeads key is not configured in the process or .env.local.");

const endpoint = process.env.PLANNINGLEADS_API_ENDPOINT?.trim()
  || localEnv.PLANNINGLEADS_API_ENDPOINT?.trim()
  || "https://planningleads.ie/api/v1";
const urls = buildPlanningLeadsSearchUrls({ enabled: true, endpoint, pageSize: 100 });
const rawRecords = [];
let minimumRemaining;
for (const url of urls) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "Helmonic-Tender-Intelligence/1.0",
    },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`PlanningLeads snapshot failed with HTTP ${response.status}.`);
  const remaining = Number.parseInt(response.headers.get("x-ratelimit-remaining") ?? "", 10);
  if (Number.isFinite(remaining)) {
    minimumRemaining = minimumRemaining === undefined ? remaining : Math.min(minimumRemaining, remaining);
  }
  rawRecords.push(...parsePlanningLeads(await response.json()));
}

const deduplicated = deduplicateOpportunities(rawRecords);
// Reproduce the approved 23 September proof window instead of silently changing its
// membership based on the day this local relationship audit is rerun.
const asOf = Date.parse(process.env.PLANNINGLEADS_SNAPSHOT_AS_OF || "2026-09-23T23:59:59Z");
const records = filterRecentPlanningLeads(deduplicated, 120, asOf).map((record) => ({
  sourceRecordId: record.sourceRecordId,
  title: record.title,
  description: record.description,
  applicant: record.applicant,
  planningAuthority: record.planningAuthority,
  location: record.location,
  publishedAt: record.publishedAt,
  deadline: record.deadline,
  sourceUrl: record.sourceUrl,
  evidenceStatus: record.evidenceStatus,
  classification: record.classification,
  matchedTerms: record.matchedTerms,
  fitScore: record.fitScore,
}));

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  generatedUtc: new Date().toISOString(),
  snapshotAsOfUtc: new Date(asOf).toISOString(),
  source: "PlanningLeads free discovery API",
  boundedRequests: urls.length,
  rawParsedRecords: rawRecords.length,
  uniqueRecords: deduplicated.length,
  retainedRecords: records.length,
  allDiscoveryOnly: records.every((record) => record.evidenceStatus === "discovery-only"),
  minimumRateLimitRemaining: minimumRemaining ?? null,
  records,
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  status: "passed",
  outputPath,
  boundedRequests: urls.length,
  rawParsedRecords: rawRecords.length,
  uniqueRecords: deduplicated.length,
  retainedRecords: records.length,
  minimumRateLimitRemaining: minimumRemaining ?? null,
}, null, 2));
