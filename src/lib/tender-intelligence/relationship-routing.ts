import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { normalizeText } from "./policy.ts";
import { hasConfirmedCurrentAcousticEvidence } from "./acoustic-evidence-guard.ts";
import { freshnessPriority, isSalesRouteable } from "./lead-qualification.ts";
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
  historical_emails?: string[];
  historical_phones?: string[];
  email_subject?: string;
  email_sent_at?: string;
  email_context?: string;
  previous_projects?: string[];
  email_source_uri?: string;
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

export function loadRelationshipLookup(directory = process.env.HELMONIC_RELATIONSHIP_INDEX_DIR
  || join(process.env.HELMONIC_TENDER_ARTIFACT_ROOT || join(process.cwd(), "local-artifacts", "tender-intelligence"), "..", "pst-index", "relationships")) {
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
    const key = [
      entity.email ?? "",
      entity.name ?? "",
      (entity.domains ?? []).join(","),
      (entity.evidence_refs ?? []).join(","),
      (entity.historical_emails ?? []).join(","),
      (entity.historical_phones ?? []).join(","),
      entity.email_subject ?? "",
      entity.email_sent_at ?? "",
      entity.email_context ?? "",
      (entity.previous_projects ?? []).join(","),
      entity.email_source_uri ?? "",
    ].join("|");
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

function relationshipMatches(record: TenderOpportunity, lookup: RelationshipLookup) {
  const routingEvidence: RelationshipRoutingEvidence[] = [];
  const owners = new Set<Exclude<LeadOwner, "unassigned">>();
  for (const party of recordParties(record)) {
    const matches: Array<{ matchType: RelationshipRoutingEvidence["matchType"]; entities: RelationshipEntity[] }> = [];
    const email = normalizedEmail(party.email ?? "");
    if (email.includes("@")) matches.push({ matchType: "exact-email", entities: lookup.emails.get(email) ?? [] });
    const name = normalizedName(party.name);
    if (name.split(" ").filter(Boolean).length >= 2) matches.push({ matchType: "exact-name", entities: lookup.names.get(name) ?? [] });

    for (const match of matches) {
      for (const entity of uniqueEntities(match.entities)) {
        const refs = [...new Set(entity.evidence_refs ?? [])];
        if (refs.length === 0) continue;
        const evidenceOwners = [...ownersFromEvidence(refs)];
        evidenceOwners.forEach((owner) => owners.add(owner));
        routingEvidence.push({
          party: party.name,
          matchedEntity: entity.name || entity.email || entity.domains?.[0] || party.name,
          ...(entity.email ? { matchedEmail: normalizedEmail(entity.email) } : {}),
          ...(entity.historical_emails?.length
            ? { historicalEmails: [...new Set(entity.historical_emails.map(normalizedEmail).filter((value) => value.includes("@")))] }
            : {}),
          ...(entity.historical_phones?.length
            ? { historicalPhones: [...new Set(entity.historical_phones.map(normalizeText).filter(Boolean))] }
            : {}),
          ...(entity.email_subject ? { emailSubject: normalizeText(entity.email_subject) } : {}),
          ...(entity.email_sent_at ? { emailSentAt: normalizeText(entity.email_sent_at) } : {}),
          ...(entity.email_context ? { emailContext: normalizeText(entity.email_context) } : {}),
          ...(entity.previous_projects?.length
            ? { previousProjects: [...new Set(entity.previous_projects.map(normalizeText).filter(Boolean))] }
            : {}),
          ...(entity.email_source_uri ? { emailSourceUri: normalizeText(entity.email_source_uri) } : {}),
          matchType: match.matchType,
          evidenceOwners,
          evidenceRefs: refs.slice(0, 20),
        });
      }
    }
  }
  return { routingEvidence, owners };
}

function isQualified(record: TenderOpportunity) {
  if (!isSalesRouteable(record)) return false;
  return hasConfirmedCurrentAcousticEvidence(record);
}

export function routeOpportunityByRelationships(
  record: TenderOpportunity,
  lookup: RelationshipLookup | undefined,
): TenderOpportunity {
  if (!lookup) {
    return {
      ...record,
      routedTo: "unassigned",
      routingStatus: isQualified(record) ? "relationship-index-unavailable" : "not-qualified",
      routingEvidence: [],
      routingReason: isQualified(record)
        ? "local-restricted-relationship-index-not-found"
        : record.evidenceStatus === "official-text"
          ? "official-document-did-not-confirm-an-approved-opportunity-category"
          : "authoritative-document-evidence-not-confirmed",
      emailRelationshipStatus: "index-unavailable",
      emailRelationshipOwner: undefined,
    };
  }

  const { routingEvidence, owners } = relationshipMatches(record, lookup);
  const emailRelationshipStatus = owners.size === 1
    ? "verified-single-owner"
    : owners.size > 1 ? "verified-multiple-owners" : "no-confirmed-match";
  const emailRelationshipOwner = owners.size === 1 ? [...owners][0] : undefined;

  if (!isQualified(record)) {
    return {
      ...record,
      routedTo: "unassigned",
      routingStatus: "not-qualified",
      routingEvidence,
      routingReason: record.evidenceStatus === "official-text"
        ? "official-document-did-not-confirm-an-approved-opportunity-category"
        : "authoritative-document-evidence-not-confirmed",
      emailRelationshipStatus,
      emailRelationshipOwner,
    };
  }

  if (owners.size === 1) {
    const [owner] = [...owners];
    return {
      ...record,
      routedTo: owner,
      routingStatus: "routed" as const,
      routingEvidence,
      routingReason: `exact-party-match-supported-by-${owner.toLowerCase()}-email-evidence`,
      emailRelationshipStatus,
      emailRelationshipOwner,
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
    emailRelationshipStatus,
    emailRelationshipOwner,
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
    return preserveExistingRoute ? {
      ...recalculated,
      routedTo: record.routedTo,
      routingStatus: record.routingStatus,
      routingEvidence: record.routingEvidence ?? recalculated.routingEvidence,
      routingReason: record.routingReason,
      emailRelationshipStatus: record.emailRelationshipStatus ?? recalculated.emailRelationshipStatus,
      emailRelationshipOwner: record.emailRelationshipOwner ?? recalculated.emailRelationshipOwner,
    } : recalculated;
  });
  const ownerCounts = {
    Glen: routed.filter((record) => record.routedTo === "Glen").length,
    Owen: routed.filter((record) => record.routedTo === "Owen").length,
  };
  const priority = (record: TenderOpportunity) => {
    const category = record.classification === "noise-related-rfi" ? 100
      : record.type === "formal-public-tender" ? 90
        : record.classification === "granted-with-noise-conditions" ? 80
          : record.classification === "refused-on-noise-grounds" ? 75 : 60;
    const quality = record.leadQuality === "excellent" ? 30
      : record.leadQuality === "good" ? 20
        : record.leadQuality === "medium" ? 10 : 0;
    return category + quality + freshnessPriority(record);
  };
  const allocations = new Map<string, Exclude<LeadOwner, "unassigned">>();
  routed
    .filter((record) => record.routedTo === "unassigned"
      && isQualified(record))
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
