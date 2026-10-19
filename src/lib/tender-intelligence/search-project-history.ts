import { ManagedIdentityCredential } from "@azure/identity";

import { normalizeText } from "./policy.ts";
import type { HistoricalProjectMatch, LeadParty, TenderOpportunity } from "./types.ts";

type SearchDocument = {
  "@search.score"?: number;
  "@search.rerankerScore"?: number;
  source_id?: string;
  source_uri?: string;
  title?: string;
  section?: string;
  content?: string;
};

type ProjectHistoryConfig = {
  endpoint: string;
  indexName: string;
  managedIdentityClientId?: string;
  apiVersion: string;
  permissionScope: string;
  semanticConfiguration?: string;
  maximumRecords: number;
};

const STOP_WORDS = new Set([
  "and", "the", "for", "from", "with", "into", "new", "development", "developments",
  "project", "projects", "building", "buildings", "alteration", "alterations", "construction",
  "ireland", "county", "company", "limited", "ltd", "planning", "application", "proposed",
]);

function config(): ProjectHistoryConfig | undefined {
  if (process.env.HELMONIC_PROJECT_HISTORY_SEARCH_ENABLED !== "true") return undefined;
  const endpoint = (process.env.AZURE_PROJECT_HISTORY_SEARCH_ENDPOINT || process.env.AZURE_SEARCH_ENDPOINT)
    ?.trim().replace(/\/$/, "");
  const indexName = (process.env.AZURE_PROJECT_HISTORY_SEARCH_INDEX || process.env.AZURE_SEARCH_INDEX)?.trim();
  if (!endpoint || !indexName) {
    throw new Error("Project-history search is enabled but its Azure AI Search endpoint or index is missing.");
  }
  const parsedMaximum = Number.parseInt(process.env.HELMONIC_PROJECT_HISTORY_SEARCH_MAX_RECORDS || "1000", 10);
  return {
    endpoint,
    indexName,
    managedIdentityClientId: (process.env.AZURE_PROJECT_HISTORY_SEARCH_CLIENT_ID
      || process.env.AZURE_SEARCH_CLIENT_ID)?.trim() || undefined,
    apiVersion: process.env.AZURE_SEARCH_API_VERSION?.trim() || "2025-09-01",
    permissionScope: process.env.HELMONIC_DEMO_PROFILE?.trim() || "iAcoustics",
    semanticConfiguration: process.env.HELMONIC_PROJECT_HISTORY_SEMANTIC_ENABLED === "true"
      ? process.env.AZURE_SEARCH_SEMANTIC_CONFIGURATION?.trim()
      : undefined,
    maximumRecords: Number.isFinite(parsedMaximum) && parsedMaximum > 0 ? parsedMaximum : 1000,
  };
}

function normalized(value: unknown) {
  return normalizeText(String(value ?? "")).toLowerCase().replace(/[^a-z0-9@.+-]+/g, " ").replace(/\s+/g, " ").trim();
}

function words(value: unknown) {
  return normalized(value).split(" ")
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
}

function unique(values: Array<string | undefined>) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function parties(record: TenderOpportunity) {
  const output = [...(record.parties ?? [])];
  if (record.applicant && !output.some((party) => normalized(party.name) === normalized(record.applicant))) {
    output.push({ name: record.applicant, role: "applicant" });
  }
  return output;
}

function organisations(record: TenderOpportunity) {
  return unique([
    record.applicant,
    record.buyer,
    ...parties(record).flatMap((party) => [party.organisation, party.name]),
  ]).filter((value) => words(value).length >= 2);
}

function contactValues(record: TenderOpportunity) {
  return parties(record).flatMap((party: LeadParty) => [party.email, party.name])
    .map(normalized)
    .filter((value) => value.includes("@") || value.split(" ").length >= 2);
}

function projectQuery(record: TenderOpportunity) {
  return unique([
    record.projectReference,
    record.title.replace(/^\s*[€£$]?\d[\d.,]*[mk]?\s*/i, ""),
    record.location,
    record.projectSector,
    ...organisations(record).slice(0, 4),
    ...parties(record).map((party) => party.email).filter(Boolean).slice(0, 3),
  ]).join(" ").slice(0, 900);
}

function exactPhrase(haystack: string, value: string | undefined) {
  const needle = normalized(value);
  return needle.length >= 4 && haystack.includes(needle);
}

function classifyMatch(record: TenderOpportunity, document: SearchDocument): HistoricalProjectMatch | undefined {
  const documentText = normalized(`${document.title ?? ""} ${document.section ?? ""} ${document.content ?? ""}`);
  if (!documentText) return undefined;
  const titleTokens = new Set(words(record.title));
  const documentTokens = new Set(words(documentText));
  const sharedTitle = [...titleTokens].filter((token) => documentTokens.has(token));
  const titleCoverage = titleTokens.size ? sharedTitle.length / titleTokens.size : 0;
  const referenceMatch = exactPhrase(documentText, record.projectReference);
  const matchingOrganisations = organisations(record).filter((value) => exactPhrase(documentText, value));
  const matchingContacts = contactValues(record).filter((value) => documentText.includes(value));
  const sectorTokens = words(record.projectSector);
  const sectorMatch = sectorTokens.length > 0 && sectorTokens.some((token) => documentTokens.has(token));

  let relationship: HistoricalProjectMatch["relationship"] | undefined;
  const matchedOn: string[] = [];
  if (referenceMatch || (sharedTitle.length >= 3 && titleCoverage >= 0.72)) {
    relationship = "same-project";
    if (referenceMatch) matchedOn.push(`project reference ${record.projectReference}`);
    if (sharedTitle.length) matchedOn.push(`project name (${sharedTitle.slice(0, 8).join(", ")})`);
  } else if (matchingContacts.length > 0) {
    relationship = "same-contact";
    matchedOn.push(`contact ${matchingContacts.slice(0, 3).join(", ")}`);
  } else if (matchingOrganisations.length > 0) {
    relationship = "same-organisation";
    matchedOn.push(`organisation ${matchingOrganisations.slice(0, 3).join(", ")}`);
  } else if ((sharedTitle.length >= 3 && titleCoverage >= 0.28)
    || (sharedTitle.length >= 2 && titleCoverage >= 0.22 && sectorMatch)) {
    relationship = "similar-project";
    matchedOn.push(`similar project wording (${sharedTitle.slice(0, 8).join(", ")})`);
    if (sectorMatch && record.projectSector) matchedOn.push(`sector ${record.projectSector}`);
  }
  if (!relationship) return undefined;

  const excerpt = normalizeText(document.content).slice(0, 420);
  const score = typeof document["@search.rerankerScore"] === "number"
    ? document["@search.rerankerScore"]
    : document["@search.score"];
  return {
    title: normalizeText(document.title) || normalizeText(document.source_id) || "Historical iAcoustics project evidence",
    relationship,
    matchedOn,
    sourceId: normalizeText(document.source_id) || "azure-rag-project-history",
    ...(document.source_uri ? { sourceUri: normalizeText(document.source_uri) } : {}),
    excerpt: excerpt ? `${excerpt}${normalizeText(document.content).length > 420 ? "…" : ""}` : "Historical project evidence matched in the controlled Azure RAG index.",
    ...(typeof score === "number" ? { score } : {}),
  };
}

function strongestMatches(matches: HistoricalProjectMatch[]) {
  const weight: Record<HistoricalProjectMatch["relationship"], number> = {
    "same-project": 4,
    "same-contact": 3,
    "same-organisation": 2,
    "similar-project": 1,
  };
  const bySource = new Map<string, HistoricalProjectMatch>();
  for (const match of matches) {
    const prior = bySource.get(match.sourceId);
    if (!prior || weight[match.relationship] > weight[prior.relationship]
      || (weight[match.relationship] === weight[prior.relationship] && (match.score ?? 0) > (prior.score ?? 0))) {
      bySource.set(match.sourceId, match);
    }
  }
  return [...bySource.values()]
    .sort((left, right) => weight[right.relationship] - weight[left.relationship]
      || (right.score ?? 0) - (left.score ?? 0)
      || left.title.localeCompare(right.title))
    .slice(0, 5);
}

async function searchOne(
  record: TenderOpportunity,
  configuration: ProjectHistoryConfig,
  token: string,
  fetcher: typeof fetch,
) {
  const query = projectQuery(record);
  if (!query) return [];
  const request: Record<string, unknown> = {
    search: query,
    queryType: configuration.semanticConfiguration ? "semantic" : "simple",
    searchMode: "any",
    searchFields: "title,section,content",
    filter: `permission_scope eq '${configuration.permissionScope.replace(/'/g, "''")}'`,
    top: 12,
    select: "source_id,source_uri,title,section,content",
  };
  if (configuration.semanticConfiguration) request.semanticConfiguration = configuration.semanticConfiguration;
  const response = await fetcher(
    `${configuration.endpoint}/indexes/${encodeURIComponent(configuration.indexName)}/docs/search?api-version=${encodeURIComponent(configuration.apiVersion)}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error(`Project-history search failed with status ${response.status}.`);
  const payload = await response.json() as { value?: SearchDocument[] };
  return strongestMatches((payload.value ?? []).flatMap((document) => {
    const match = classifyMatch(record, document);
    return match ? [match] : [];
  }));
}

export async function enrichWithHistoricalProjectMatches(
  records: TenderOpportunity[],
  options: { fetcher?: typeof fetch; accessToken?: string } = {},
): Promise<{
  records: TenderOpportunity[];
  enabled: boolean;
  queriedRecords: number;
  matchedRecords: number;
  failedRecords: number;
}> {
  const configuration = config();
  if (!configuration) {
    return {
      records: records.map((record) => ({ ...record, projectHistoryStatus: record.projectHistoryStatus ?? "disabled" })),
      enabled: false,
      queriedRecords: 0,
      matchedRecords: records.filter((record) => (record.historicalProjectMatches?.length ?? 0) > 0).length,
      failedRecords: 0,
    };
  }
  const targets = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.cycleStatus !== "resolved")
    .slice(0, configuration.maximumRecords);
  const fetcher = options.fetcher ?? fetch;
  const credential = configuration.managedIdentityClientId
    ? new ManagedIdentityCredential(configuration.managedIdentityClientId)
    : new ManagedIdentityCredential();
  const token = options.accessToken || (await credential.getToken("https://search.azure.com/.default"))?.token;
  if (!token) throw new Error("Project-history search token was unavailable.");
  const enriched = [...records];
  let next = 0;
  let matchedRecords = 0;
  let failedRecords = 0;
  await Promise.all(Array.from({ length: Math.min(4, targets.length) }, async () => {
    while (true) {
      const targetIndex = next;
      next += 1;
      if (targetIndex >= targets.length) return;
      const { record, index } = targets[targetIndex];
      try {
        const matches = await searchOne(record, configuration, token, fetcher);
        if (matches.length > 0) matchedRecords += 1;
        enriched[index] = {
          ...record,
          projectHistoryStatus: matches.length > 0 ? "matched" : "no-match",
          historicalProjectMatches: matches,
        };
      } catch {
        failedRecords += 1;
        enriched[index] = {
          ...record,
          projectHistoryStatus: "index-unavailable",
          historicalProjectMatches: record.historicalProjectMatches,
        };
      }
    }
  }));
  return {
    records: enriched,
    enabled: true,
    queriedRecords: targets.length,
    matchedRecords,
    failedRecords,
  };
}
