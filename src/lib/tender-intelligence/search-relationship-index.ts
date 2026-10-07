import { ManagedIdentityCredential } from "@azure/identity";

import { buildRelationshipLookup, type RelationshipLookup } from "./relationship-routing.ts";
import { normalizeText } from "./policy.ts";
import type { LeadParty, TenderOpportunity } from "./types.ts";

type SearchDocument = {
  message_id?: string;
  evidence_ref?: string;
  subject?: string;
  body_text?: string;
  mailbox_owner?: string;
};

type RelationshipEntity = {
  name?: string;
  email?: string;
  domains?: string[];
  evidence_refs?: string[];
};

function config() {
  if (process.env.HELMONIC_EMAIL_RELATIONSHIP_SEARCH_ENABLED !== "true") return undefined;
  const endpoint = process.env.AZURE_EMAIL_SEARCH_ENDPOINT?.trim()?.replace(/\/$/, "");
  const indexName = process.env.AZURE_EMAIL_SEARCH_INDEX?.trim();
  const managedIdentityClientId = process.env.AZURE_EMAIL_SEARCH_CLIENT_ID?.trim();
  const apiVersion = process.env.AZURE_SEARCH_API_VERSION?.trim() || "2025-09-01";
  if (!endpoint || !indexName || !managedIdentityClientId) {
    throw new Error("Restricted relationship search is enabled but its endpoint, index or managed identity is missing.");
  }
  return { endpoint, indexName, managedIdentityClientId, apiVersion };
}

function normalizedName(value: string) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function partyKey(party: LeadParty) {
  return `${normalizedName(party.name)}|${normalizeText(party.email).toLowerCase()}`;
}

function parties(records: TenderOpportunity[]) {
  const output = new Map<string, LeadParty>();
  for (const record of records) {
    const recordParties = [...(record.parties ?? [])];
    if (record.applicant && !recordParties.some((party) => normalizedName(party.name) === normalizedName(record.applicant ?? ""))) {
      recordParties.push({ name: record.applicant, role: "applicant" });
    }
    for (const party of recordParties) {
      const name = normalizedName(party.name);
      const email = normalizeText(party.email).toLowerCase();
      if (name.split(" ").filter(Boolean).length < 2 && !email.includes("@")) continue;
      output.set(partyKey(party), party);
    }
  }
  return [...output.values()].slice(0, 300);
}

function owner(document: SearchDocument) {
  const reference = normalizeText(document.evidence_ref).toLowerCase();
  if (reference.includes("[e:glen:")) return "glen";
  if (reference.includes("[e:owen:")) return "owen";
  const mailbox = normalizeText(document.mailbox_owner).toLowerCase();
  if (/\bglen\b/.test(mailbox)) return "glen";
  if (/\bowen\b|\beoghan\b/.test(mailbox)) return "owen";
  return undefined;
}

function exactPartyMatch(party: LeadParty, document: SearchDocument) {
  const haystack = `${document.subject ?? ""} ${document.body_text ?? ""}`.toLowerCase();
  const email = normalizeText(party.email).toLowerCase();
  if (email.includes("@") && haystack.includes(email)) return true;
  const name = normalizedName(party.name);
  return name.split(" ").filter(Boolean).length >= 2 && normalizedName(haystack).includes(name);
}

export async function loadSearchRelationshipLookup(
  records: TenderOpportunity[],
  options: { fetcher?: typeof fetch; accessToken?: string } = {},
): Promise<{ lookup?: RelationshipLookup; enabled: boolean; queriedParties: number; matchedEntities: number }> {
  const configuration = config();
  if (!configuration) return { enabled: false, queriedParties: 0, matchedEntities: 0 };
  const targetParties = parties(records);
  const fetcher = options.fetcher ?? fetch;
  const token = options.accessToken || (await new ManagedIdentityCredential(configuration.managedIdentityClientId)
    .getToken("https://search.azure.com/.default"))?.token;
  if (!token) throw new Error("Restricted relationship search token was unavailable.");
  const entities: RelationshipEntity[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, targetParties.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= targetParties.length) return;
      const party = targetParties[index];
      const searchText = normalizeText(party.email) || normalizeText(party.name);
      const response = await fetcher(
        `${configuration.endpoint}/indexes/${encodeURIComponent(configuration.indexName)}/docs/search?api-version=${encodeURIComponent(configuration.apiVersion)}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            search: `\"${searchText.replaceAll("\"", "\\\"")}\"`,
            queryType: "simple",
            searchMode: "all",
            searchFields: "subject,body_text",
            select: "message_id,evidence_ref,subject,body_text,mailbox_owner",
            top: 20,
          }),
          signal: AbortSignal.timeout(12_000),
        },
      );
      if (!response.ok) throw new Error(`Restricted relationship search failed with status ${response.status}.`);
      const payload = await response.json() as { value?: SearchDocument[] };
      for (const document of payload.value ?? []) {
        const mailboxOwner = owner(document);
        if (!mailboxOwner || !exactPartyMatch(party, document)) continue;
        const evidenceRef = normalizeText(document.evidence_ref)
          || `[E:${mailboxOwner}:${normalizeText(document.message_id) || "message"}]`;
        const email = normalizeText(party.email).toLowerCase();
        entities.push({
          name: party.name,
          email: email || undefined,
          domains: email.includes("@") ? [email.split("@")[1]] : [],
          evidence_refs: [evidenceRef],
        });
      }
    }
  }));
  return {
    enabled: true,
    lookup: buildRelationshipLookup(entities),
    queriedParties: targetParties.length,
    matchedEntities: entities.length,
  };
}
