import {
  buildPlanningLeadsSearchUrls,
  filterRecentPlanningLeads,
  parsePlanningLeads,
} from "../../src/lib/tender-intelligence/official-sources.ts";
import { deduplicateOpportunities } from "../../src/lib/tender-intelligence/policy.ts";

const apiKey = process.env.PLANNINGLEADS_API_KEY?.trim();
if (!apiKey) {
  console.error("PlanningLeads key is not configured.");
  process.exit(2);
}

const endpoint = process.env.PLANNINGLEADS_API_ENDPOINT?.trim() || "https://planningleads.ie/api/v1";
const urls = buildPlanningLeadsSearchUrls({ enabled: true, endpoint, pageSize: 100 });
const records = [];
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
  if (!response.ok) {
    console.error(`PlanningLeads connection failed with HTTP ${response.status}.`);
    process.exit(1);
  }
  const remaining = Number.parseInt(response.headers.get("x-ratelimit-remaining") ?? "", 10);
  if (Number.isFinite(remaining)) {
    minimumRemaining = minimumRemaining === undefined ? remaining : Math.min(minimumRemaining, remaining);
  }
  records.push(...parsePlanningLeads(await response.json()));
}

const unique = filterRecentPlanningLeads(deduplicateOpportunities(records));
console.log(JSON.stringify({
  status: "passed",
  boundedRequests: urls.length,
  discoveryRecords: unique.length,
  officialEvidenceRecords: unique.filter((record) => record.evidenceStatus === "official-text").length,
  allResultsDiscoveryOnly: unique.every((record) => record.evidenceStatus === "discovery-only"),
  minimumRateLimitRemaining: minimumRemaining ?? null,
}, null, 2));
