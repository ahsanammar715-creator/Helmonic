import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { normalizeText } from "./policy.ts";
import { isSalesRouteable } from "./lead-qualification.ts";
import type {
  LeadOwner,
  RelationshipRoutingEvidence,
  TenderOpportunity,
} from "./types.ts";

type RelationshipEntity = {
  name?: string;
  email?: string;
  domains?: string[];
  evidence_refs?: string[];
};

export type RelationshipLookup = {
  names: Map<string, RelationshipEntity[]>;
  emails: Map<string, RelationshipEntity[]>;
  domains: Map<string, RelationshipEntity[]>;
};

function normalizedName(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/\b(?:mr|mrs|ms|dr|prof)\.?\s+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:limited|ltd|plc|company|co)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedEmail(value: string) {
  return normalizeText(value).toLowerCase().replace(/^mailto:/, "");
}

function addLookup(map: Map<string, RelationshipEntity[]>, key: string, entity: RelationshipEntity) {
  if (!key) return;
  map.set(key, [...(map.get(key) ?? []), entity]);
}

export function buildRelationshipLookup(entities: RelationshipEntity[]): RelationshipLookup {
  const lookup: RelationshipLookup = { names: new Map(), emails: new Map(), domains: new Map() };
  for (const entity of entities) {
    const name = normalizedName(entity.name ?? "");
    if (name.split(" ").filter(Boolean).length >= 2) addLookup(lookup.names, name, entity);
    const email = normalizedEmail(entity.email ?? "");
    if (email.includes("@")) {
      addLookup(lookup.emails, email, entity);
      addLookup(lookup.domains, email.split("@")[1], entity);
    }
    for (const domain of entity.domains ?? []) addLookup(lookup.domains, normalizedEmail(domain).replace(/^@/, ""), entity);
  }
  return lookup;
}

function parseJsonLinesGzip(path: string) {
  const text = gunzipSync(readFileSync(path)).toString("utf8");
  return text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const parsed = JSON.parse(line);
      return parsed && typeof parsed === "object" ? [parsed as RelationshipEntity] : [];
    } catch {
      return [];
    }
  });
}

export function loadRelationshipLookup(directory = join(process.cwd(), "local-artifacts", "pst-index", "relationships")) {
  const files = ["people.jsonl.gz", "firms.jsonl.gz"]
    .map((name) => join(directory, name))
    .filter(existsSync);
  if (files.length !== 2) return undefined;
  return buildRelationshipLookup(files.flatMap(parseJsonLinesGzip));
}

function ownersFromEvidence(refs: string[]) {
  const owners = new Set<Exclude<LeadOwner, "unassigned">>();
  for (const ref of refs) {
    if (/\[E:glen:/i.test(ref)) owners.add("Glen");
    if (/\[E:owen:/i.test(ref)) owners.add("Owen");
  }
  return owners;
}

function uniqueEntities(entities: RelationshipEntity[]) {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    const key = `${entity.email ?? ""}|${entity.name ?? ""}|${(entity.domains ?? []).join(",")}|${(entity.evidence_refs ?? []).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recordParties(record: TenderOpportunity) {
  const parties = [...(record.parties ?? [])];
  if (record.applicant && !parties.some((party) => normalizedName(party.name) === normalizedName(record.applicant ?? ""))) {
    parties.push({ name: record.applicant, role: "applicant" as const });
  }
  return parties;
}

function isQualified(record: TenderOpportunity) {
  if (!isSalesRouteable(record)) return false;
  if (record.evidenceStatus !== "official-text") return false;
  if (record.classification === "no-relevant-opportunity" || record.classification === "needs-council-evidence") return false;
  return record.type === "formal-public-tender" || Boolean(record.classification);
}

export function routeOpportunityByRelationships(
  record: TenderOpportunity,
  lookup: RelationshipLookup | undefined,
): TenderOpportunity {
  if (!isQualified(record)) {
    return {
      ...record,
      routedTo: "unassigned",
      routingStatus: "not-qualified",
      routingEvidence: [],
      routingReason: record.evidenceStatus === "official-text"
        ? "official-document-did-not-confirm-an-approved-opportunity-category"
        : "authoritative-document-evidence-not-confirmed",
    };
  }
  if (!lookup) {
    return {
      ...record,
      routedTo: "unassigned",
      routingStatus: "relationship-index-unavailable",
      routingEvidence: [],
      routingReason: "local-restricted-relationship-index-not-found",
    };
  }

  const routingEvidence: RelationshipRoutingEvidence[] = [];
  const owners = new Set<Exclude<LeadOwner, "unassigned">>();
  for (const party of recordParties(record)) {
    const matches: Array<{ matchType: RelationshipRoutingEvidence["matchType"]; entities: RelationshipEntity[] }> = [];
    const email = normalizedEmail(party.email ?? "");
    if (email.includes("@")) matches.push({ matchType: "exact-email", entities: lookup.emails.get(email) ?? [] });
    const domain = email.includes("@") ? email.split("@")[1] : "";
    if (domain) matches.push({ matchType: "exact-domain", entities: lookup.domains.get(domain) ?? [] });
    const name = normalizedName(party.name);
    if (name.split(" ").filter(Boolean).length >= 2) matches.push({ matchType: "exact-name", entities: lookup.names.get(name) ?? [] });

    for (const match of matches) {
      for (const entity of uniqueEntities(match.entities)) {
        const refs = [...new Set(entity.evidence_refs ?? [])];
        if (refs.length === 0) continue;
        ownersFromEvidence(refs).forEach((owner) => owners.add(owner));
        routingEvidence.push({
          party: party.name,
          matchedEntity: entity.name || entity.email || entity.domains?.[0] || party.name,
          matchType: match.matchType,
          evidenceRefs: refs.slice(0, 20),
        });
      }
    }
  }

  if (owners.size === 1) {
    const [owner] = [...owners];
    return {
      ...record,
      routedTo: owner,
      routingStatus: "routed" as const,
      routingEvidence,
      routingReason: `exact-party-match-supported-by-${owner.toLowerCase()}-email-evidence`,
    };
  }
  return {
    ...record,
    routedTo: "unassigned",
    routingStatus: "needs-triage",
    routingEvidence,
    routingReason: owners.size > 1
      ? "verified-party-history-exists-for-both-glen-and-owen"
      : "no-exact-party-level-email-evidence-match",
  };
}

export function routeOpportunitiesByRelationships(
  records: TenderOpportunity[],
  lookup: RelationshipLookup | undefined = loadRelationshipLookup(),
  options: { preserveExistingRoutes?: boolean } = {},
): TenderOpportunity[] {
  const routed = records.map((record) => {
    const recalculated = routeOpportunityByRelationships(record, lookup);
    const preserveExistingRoute = options.preserveExistingRoutes
      && isQualified(record)
      && record.routingStatus === "routed"
      && (record.routedTo === "Glen" || record.routedTo === "Owen")
      && Boolean(record.routingReason)
      && !/^exact-party-match-supported-by-(?:glen|owen)-email-evidence$/i.test(recalculated.routingReason ?? "");
    return preserveExistingRoute ? record : recalculated;
  });
  const ownerCounts = {
    Glen: routed.filter((record) => record.routedTo === "Glen").length,
    Owen: routed.filter((record) => record.routedTo === "Owen").length,
  };
  const priority = (record: TenderOpportunity) => {
    if (record.leadQuality === "excellent") return 10;
    if (record.leadQuality === "good") return 8;
    if (record.leadQuality === "medium") return 6;
    if (record.classification === "noise-related-rfi") return 5;
    if (record.type === "formal-public-tender") return 4;
    if (record.classification === "granted-with-noise-conditions") return 3;
    if (record.classification === "refused-on-noise-grounds") return 2;
    return 1;
  };
  const allocations = new Map<string, Exclude<LeadOwner, "unassigned">>();
  routed
    .filter((record) => isQualified(record) && record.routedTo === "unassigned")
    .sort((left, right) => priority(right) - priority(left)
      || right.fitScore - left.fitScore
      || left.id.localeCompare(right.id))
    .forEach((record, index) => {
      const owner = ownerCounts.Glen === ownerCounts.Owen
        ? (index % 2 === 0 ? "Glen" : "Owen")
        : ownerCounts.Glen < ownerCounts.Owen ? "Glen" : "Owen";
      ownerCounts[owner] += 1;
      allocations.set(record.id, owner);
    });

  return routed.map((record): TenderOpportunity => {
    const owner = allocations.get(record.id);
    if (!owner) return record;
    const hadBothOwners = record.routingReason === "verified-party-history-exists-for-both-glen-and-owen";
    return {
      ...record,
      routedTo: owner,
      routingStatus: "routed",
      routingReason: hadBothOwners
        ? `balanced-assignment-to-${owner.toLowerCase()}-because-both-relationship-histories-exist`
        : `balanced-assignment-to-${owner.toLowerCase()}-without-confirmed-warm-connection`,
    };
  });
}
