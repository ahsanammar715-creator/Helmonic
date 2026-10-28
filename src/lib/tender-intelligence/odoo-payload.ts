import type { LeadParty, TenderOpportunity } from "./types.ts";
import {
  acousticEvidenceGateLabel,
  hasConfirmedCurrentAcousticEvidence,
} from "./acoustic-evidence-guard.ts";
import { genericPlanningPortalUrl, nationalPlanningProjectUrl } from "./project-links.ts";

export type OdooLeadDryRun = {
  operation: "upsert";
  matchField: "x_helmonic_external_id";
  matchValue: string;
  attribution: {
    campaignName: string;
    mediumName: string;
    sourceName: string;
  };
  emailMatchTagName?: string;
  sourceTagNames: string[];
  statusTagNames: string[];
  values: {
    /** Odoo's native archive flag for automation-managed lead lifecycles. */
    active?: boolean;
    name: string;
    description: string;
    partner_name: string;
    contact_name: string;
    email_from: string;
    phone: string;
    function: string;
    street: string;
    date_deadline: string | false;
    x_helmonic_external_id: string;
    x_pipeline_bucket: string;
    x_pipeline_priority_rank: number;
    x_pipeline_priority_reason: string;
    x_lead_panel: string;
    x_lead_quality: string;
    x_evidence_status: string;
    x_classification: string;
    x_source_systems: string;
    x_source_record_ids: string;
    x_source_ledger: string;
    x_project_link: string;
    x_source_urls: string;
    x_evidence_excerpt: string;
    x_source_published_at: string | false;
    x_source_updated_at: string | false;
    x_source_major_updated_at: string | false;
    x_source_age_days: number | false;
    x_freshness_band: string;
    x_deadline: string | false;
    x_rfi_published_at: string | false;
    x_rfi_received_at: string | false;
    x_rfi_response_due_at: string | false;
    x_rfi_response_received_at: string | false;
    x_rfi_date_source: string;
    x_rfi_date_confidence: string;
    x_planning_received_at: string | false;
    x_planning_validated_at: string | false;
    x_decision_due_at: string | false;
    x_action_days_remaining: number | false;
    x_deadline_urgency: string;
    x_rfi_trigger: string;
    x_assigned_person: string;
    x_warm_connection_verified: boolean;
    x_routing_reason: string;
    x_relationship_summary: string;
    x_relationship_evidence: string;
    x_project_history_summary: string;
    x_project_history_evidence: string;
    x_deduplication_status: string;
    x_possible_duplicate_ids: string;
    x_project_value: number | false;
    x_project_units: number | false;
    x_project_stage: string;
    x_opportunity_type: string;
    x_location: string;
    x_county: string;
    x_planning_authority: string;
    x_project_reference: string;
    x_applicant: string;
    x_party_details: string;
    x_cpv_codes: string;
    x_matched_terms: string;
    x_evidence_document_urls: string;
    x_residential_scale: string;
    x_first_seen_at: string | false;
    x_last_seen_at: string | false;
    x_last_confirmed_at: string | false;
    x_cycle_status: string;
    x_scope_status: string;
    x_acoustic_appointment_status: string;
    x_appointed_acoustician: string;
    x_appointment_evidence: string;
    x_appointment_evidence_source_url: string;
    x_competitive_quote_opportunity: boolean;
    x_outreach_eligibility: string;
    x_outreach_suppression_reason: string;
    x_outreach_key: string;
    x_buildinginfo_search_profile: string;
    x_source_reference: string;
    x_studio_project_sector: string;
  };
};

function actionableDeadline(record: TenderOpportunity) {
  if (!hasConfirmedCurrentAcousticEvidence(record)) return "";
  if (record.classification === "noise-related-rfi") {
    return record.rfiResponseReceivedAt ? "" : record.responseDeadline ?? "";
  }
  if (record.type === "formal-public-tender") return record.deadline ?? "";
  return "";
}

function rfiReceivedOrDetectedAt(record: TenderOpportunity) {
  if (record.classification !== "noise-related-rfi") return "";
  if (record.rfiReceivedAt) return record.rfiReceivedAt;
  const documentReceivedAt = (record.evidenceDocuments ?? [])
    .map((document) => document.receivedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0];
  return documentReceivedAt ?? record.sourceMajorUpdatedAt ?? "";
}

function rfiPublishedAt(record: TenderOpportunity) {
  if (record.classification !== "noise-related-rfi") return "";
  return record.rfiPublishedAt ?? "";
}

function rfiDateSource(record: TenderOpportunity) {
  if (record.classification !== "noise-related-rfi") return "";
  if (record.rfiDateSource) return record.rfiDateSource;
  const document = (record.evidenceDocuments ?? [])
    .filter((candidate) => candidate.receivedAt && candidate.sourceUrl)
    .sort((left, right) => String(right.receivedAt).localeCompare(String(left.receivedAt)))[0];
  if (document?.sourceUrl) return `Evidence document: ${document.sourceUrl}`;
  if (rfiReceivedOrDetectedAt(record)) return `Derived from ${record.sourceSystem} source update: ${record.sourceUrl}`;
  return "Date unavailable from supplied source evidence";
}

function rfiDateConfidence(record: TenderOpportunity) {
  if (record.classification !== "noise-related-rfi") return "not-applicable";
  if (record.rfiDateConfidence) return record.rfiDateConfidence;
  if (record.rfiPublishedAt || record.rfiReceivedAt) return "exact";
  if (rfiReceivedOrDetectedAt(record)) return "derived";
  return "unavailable";
}

function planningDecisionDueAt(record: TenderOpportunity) {
  return record.type === "planning-pipeline-lead" ? record.deadline ?? "" : "";
}

function planningReceivedAt(record: TenderOpportunity) {
  if (record.type !== "planning-pipeline-lead") return "";
  return record.planningReceivedAt ?? record.publishedAt ?? "";
}

function planningValidatedAt(record: TenderOpportunity) {
  return record.type === "planning-pipeline-lead" ? record.planningValidatedAt ?? "" : "";
}

function calendarDaysRemaining(value: string, now: Date) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const deadlineDay = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((deadlineDay - currentDay) / 86_400_000);
}

function actionDeadlineUrgency(record: TenderOpportunity, daysRemaining: number | false) {
  if (daysRemaining === false) return "No actionable due date supplied";
  if (daysRemaining < 0) {
    const days = Math.abs(daysRemaining);
    return `${record.classification === "noise-related-rfi" ? "RFI response" : "Tender response"} overdue by ${days} day${days === 1 ? "" : "s"} — acoustic consultant review required`;
  }
  if (daysRemaining === 0) return "Due today — immediate acoustic consultant review";
  if (daysRemaining <= 7) return `Immediate — due in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`;
  if (daysRemaining <= 28) return record.classification === "noise-related-rfi"
    ? `Due in ${daysRemaining} days — within the 28-day RFI response window`
    : `Due in ${daysRemaining} days — active tender response window`;
  if (daysRemaining <= 180) return `Due in ${daysRemaining} days — within the six-month opportunity window`;
  return `Longer-term — due in ${daysRemaining} days`;
}

function planningDecisionUrgency(record: TenderOpportunity, now: Date) {
  const decisionDue = planningDecisionDueAt(record);
  const daysRemaining = calendarDaysRemaining(decisionDue, now);
  if (daysRemaining === false) return "No actionable due date supplied";
  if (daysRemaining < 0) {
    const days = Math.abs(daysRemaining);
    return `Planning decision date passed ${days} day${days === 1 ? "" : "s"} ago — not an RFI response deadline`;
  }
  if (daysRemaining === 0) return "Planning decision due today — not an RFI response deadline";
  return `Planning decision due in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} — not an RFI response deadline`;
}

function recordUrgency(record: TenderOpportunity, now: Date) {
  if (record.classification === "noise-related-rfi" && record.rfiResponseReceivedAt) {
    return `Further-information response received ${record.rfiResponseReceivedAt}; no longer an open RFI response deadline`;
  }
  const actionDeadline = actionableDeadline(record);
  if (actionDeadline) return actionDeadlineUrgency(record, calendarDaysRemaining(actionDeadline, now));
  if (record.type === "planning-pipeline-lead") return planningDecisionUrgency(record, now);
  return "No actionable due date supplied";
}

function odooDatetime(value?: string) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function odooDate(value?: string) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10);
}

function ownerDisplayName(record: TenderOpportunity) {
  // Relationship evidence proves that iAcoustics knows a project party; it
  // does not prove that the current project needs acoustic work. Keep the
  // relationship visible, but never turn it into an Odoo assignment unless
  // the current-project acoustic evidence has passed the shared guard.
  if (!hasConfirmedCurrentAcousticEvidence(record)) return "";
  if (record.routedTo === "Glen") return "Glen Plunkett";
  if (record.routedTo === "Owen") return "Eoghan Tyrrell";
  return "";
}

function odooRoutingReason(record: TenderOpportunity) {
  const reason = record.routingReason ?? "";
  if (hasConfirmedCurrentAcousticEvidence(record) || !verifiedWarmConnection(record)) return reason;
  return [
    "Verified historical email relationship retained for context; not assigned because current-project acoustic evidence is unconfirmed",
    reason ? `Match context: ${reason}` : "",
  ].filter(Boolean).join(". ");
}

function normalizedEmail(value: string | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizedName(value: string | undefined) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function verifiedRelationshipEmails(record: TenderOpportunity) {
  if (!verifiedWarmConnection(record)) return new Set<string>();
  return new Set((record.routingEvidence ?? [])
    .filter((match) => match.matchType !== "exact-domain"
      && (match.evidenceOwners?.length ?? 0) > 0
      && match.evidenceRefs.some((reference) => /^\[E:(?:glen|owen):/i.test(reference)))
    .flatMap((match) => [
      match.matchedEmail,
      match.matchType === "exact-email" && match.matchedEntity.includes("@") ? match.matchedEntity : undefined,
      ...(match.historicalEmails ?? []),
    ])
    .map(normalizedEmail)
    .filter((email) => email.includes("@")));
}

function enrichedParties(record: TenderOpportunity) {
  const parties = (record.parties ?? []).map((party) => ({ ...party }));
  const seenEmails = new Set(parties.map((party) => normalizedEmail(party.email)).filter(Boolean));
  if (!verifiedWarmConnection(record)) return parties;

  for (const match of record.routingEvidence ?? []) {
    const evidenceBacked = match.matchType !== "exact-domain"
      && (match.evidenceOwners?.length ?? 0) > 0
      && match.evidenceRefs.some((reference) => /^\[E:(?:glen|owen):/i.test(reference));
    if (!evidenceBacked) continue;
    const matchedParty = parties.find((party) => normalizedName(party.name) === normalizedName(match.party));
    const historicalPhone = match.historicalPhones?.find(Boolean);
    if (matchedParty && !matchedParty.phone && historicalPhone) matchedParty.phone = historicalPhone;
    const emails = [
      match.matchedEmail,
      match.matchType === "exact-email" && match.matchedEntity.includes("@") ? match.matchedEntity : undefined,
      ...(match.historicalEmails ?? []),
    ]
      .map(normalizedEmail)
      .filter((email) => email.includes("@") && !seenEmails.has(email));
    for (const email of emails) {
      const matchedEntityIsParty = normalizedName(match.matchedEntity) === normalizedName(match.party);
      if (matchedParty && !matchedParty.email && matchedEntityIsParty) {
        matchedParty.email = email;
      } else {
        parties.push({
          name: match.matchedEntity && !match.matchedEntity.includes("@") ? match.matchedEntity : match.party,
          role: matchedParty?.role ?? "other",
          email,
          ...(matchedParty?.phone || historicalPhone ? { phone: matchedParty?.phone || historicalPhone } : {}),
          ...(matchedParty?.organisation
            ? { organisation: matchedParty.organisation }
            : match.party && normalizedName(match.party) !== normalizedName(match.matchedEntity)
              ? { organisation: match.party }
              : {}),
        });
      }
      seenEmails.add(email);
    }
  }
  return parties;
}

function partyDetails(record: TenderOpportunity) {
  const verifiedEmails = verifiedRelationshipEmails(record);
  return enrichedParties(record).map((party) => [
    party.role,
    party.name,
    party.organisation,
    party.email || "email not supplied by source",
    party.phone || "phone not supplied by source",
    party.email && verifiedEmails.has(normalizedEmail(party.email))
      ? "verified iAcoustics email-history contact"
      : "source-supplied contact",
  ].filter(Boolean).join(" | ")).join("\n");
}

function compact(value: string | undefined, limit: number) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function conciseConversationContext(value: string | undefined) {
  const withoutQuotedHeaders = String(value ?? "")
    .replace(/\b(?:From|Sent|To|Cc|Subject):\s*/gi, " ")
    .replace(/\b(?:This (?:email|message)|The information in this email|Confidentiality notice|DISCLAIMER)\b[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return compact(withoutQuotedHeaders, 240);
}

function summarizedList(values: string[], maximum = 5) {
  const unique = [...new Set(values.map((value) => compact(value, 160)).filter(Boolean))];
  const visible = unique.slice(0, maximum);
  return {
    text: visible.join(", "),
    total: unique.length,
    omitted: Math.max(0, unique.length - visible.length),
  };
}

function relationshipDetails(record: TenderOpportunity) {
  const matches = record.routingEvidence ?? [];
  if (record.emailRelationshipStatus === "index-unavailable") {
    return "Relationship index unavailable; no email-history claim was made.";
  }
  if (matches.length === 0) {
    return "No exact project-party match was found in the restricted email evidence.";
  }
  return [...matches].sort((left, right) => String(right.emailSentAt ?? "").localeCompare(String(left.emailSentAt ?? "")))
    .map((match) => {
      const owners = match.evidenceOwners?.length
        ? match.evidenceOwners.map((owner) => owner === "Owen" ? "Eoghan" : owner).join(" + ")
        : "owner not resolved";
      const matchedContact = match.matchedEmail
        ? `${match.matchedEntity} <${match.matchedEmail}>`
        : match.matchedEntity;
      return [
        `Matched project party: ${match.party}`,
        `Matched email contact: ${matchedContact}`,
        match.historicalEmails?.length ? `Other verified email address(es): ${match.historicalEmails.join(", ")}` : "",
        match.historicalPhones?.length ? `Phone number(s) found in the matched email: ${match.historicalPhones.join(", ")}` : "",
        `Verified consultant history: ${owners}`,
        `Match method: ${match.matchType}`,
        match.previousProjects?.length
          ? `Earlier job(s): ${match.previousProjects.join(", ")}`
          : "",
        match.emailSentAt ? `Matched email date: ${match.emailSentAt}` : "Matched email date: Not available in the evidence index",
        match.emailSubject ? `Matched email subject: ${compact(match.emailSubject, 120)}` : "Matched email subject: Not available in the evidence index",
        match.emailContext ? `Email conversation context (bounded excerpt): ${compact(match.emailContext, 420)}` : "",
        "Evidence source: Restricted iAcoustics consultant email evidence index",
        match.emailSourceUri ? `Source message URI: ${match.emailSourceUri}` : "",
        match.evidenceRefs.length ? `Evidence reference(s): ${match.evidenceRefs.join(", ")}` : "",
      ].filter(Boolean).join(" | ");
    }).join("\n");
}

function consultantNames(match: NonNullable<TenderOpportunity["routingEvidence"]>[number]) {
  const names = (match.evidenceOwners ?? []).map((owner) => owner === "Owen" ? "Eoghan Tyrrell" : "Glen Plunkett");
  return [...new Set(names)];
}

function relationshipSummary(record: TenderOpportunity) {
  const matches = [...(record.routingEvidence ?? [])]
    .filter((match) => match.matchType !== "exact-domain" && (match.evidenceOwners?.length ?? 0) > 0)
    .sort((left, right) => String(right.emailSentAt ?? "").localeCompare(String(left.emailSentAt ?? "")));
  if (record.emailRelationshipStatus === "index-unavailable") {
    return "The restricted email relationship index was unavailable, so no historical relationship is claimed.";
  }
  if (matches.length === 0) {
    return "No exact project-party relationship was verified in the restricted iAcoustics email history.";
  }
  const consultants = summarizedList(matches.flatMap(consultantNames), 2);
  const contacts = summarizedList(matches.map((match) => match.matchedEntity || match.party).filter(Boolean), 5);
  const emails = summarizedList(matches.flatMap((match) => [match.matchedEmail, ...(match.historicalEmails ?? [])])
    .map(normalizedEmail).filter((email) => email.includes("@")), 5);
  const phones = summarizedList(matches.flatMap((match) => match.historicalPhones ?? []).filter(Boolean), 5);
  const projects = summarizedList(matches.flatMap((match) => match.previousProjects ?? []).filter(Boolean), 5);
  const organisations = summarizedList(matches.map((match) => match.party).filter(Boolean), 5);
  const dates = matches.map((match) => match.emailSentAt).filter((value): value is string => Boolean(value));
  const latestDate = dates[0];
  const conversationCount = new Set(matches.flatMap((match) => match.evidenceRefs)).size;
  const latest = matches[0];
  const summary = [
    `${consultants.text} previously corresponded with ${contacts.text} (${conversationCount} verified email conversation${conversationCount === 1 ? "" : "s"}${latestDate ? `; latest ${latestDate}` : ""}).`,
    organisations.total ? `Relationship organisation${organisations.total === 1 ? "" : "s"}/project part${organisations.total === 1 ? "y" : "ies"}: ${organisations.text}${organisations.omitted ? `, plus ${organisations.omitted} more` : ""}.` : "",
    emails.total ? `Known email contact${emails.total === 1 ? "" : "s"}: ${emails.text}${emails.omitted ? `, plus ${emails.omitted} more` : ""}.` : "",
    phones.total ? `Phone number${phones.total === 1 ? "" : "s"} found in the matched email history: ${phones.text}${phones.omitted ? `, plus ${phones.omitted} more` : ""}.` : "",
    latest?.emailSubject ? `Most recent matched conversation: ${latestDate ? `${latestDate} — ` : ""}${compact(latest.emailSubject, 140)}.` : "",
    latest?.emailContext ? `Useful conversation context: ${conciseConversationContext(latest.emailContext)}.` : "",
    projects.total ? `iAcoustics email history references ${projects.total} earlier or similar project${projects.total === 1 ? "" : "s"}: ${projects.text}${projects.omitted ? `, plus ${projects.omitted} more` : ""}.` : "",
    "This is historical relationship context; the current project's acoustic requirement is assessed separately.",
  ].filter(Boolean).join(" ");
  return compact(summary, 1_600);
}

function projectHistorySummary(record: TenderOpportunity) {
  const matches = record.historicalProjectMatches ?? [];
  if (record.projectHistoryStatus === "index-unavailable") {
    return "The controlled Azure project-history index was unavailable; no previous-project claim was made.";
  }
  if (record.projectHistoryStatus === "disabled") {
    return "Historical-project matching was not enabled for this run.";
  }
  if (matches.length === 0) {
    return "No sufficiently strong match was found in the controlled iAcoustics project-history index.";
  }
  const sameProject = matches.filter((match) => match.relationship === "same-project");
  const sameContact = matches.filter((match) => match.relationship === "same-contact");
  const sameOrganisation = matches.filter((match) => match.relationship === "same-organisation");
  const similar = matches.filter((match) => match.relationship === "similar-project");
  const describe = (label: string, values: typeof matches) => values.length
    ? `${label}: ${values.map((match) => match.title).join(", ")}.`
    : "";
  return [
    describe("Possible same historical project", sameProject),
    describe("Previous project involving the same contact", sameContact),
    describe("Previous project involving the same organisation", sameOrganisation),
    describe("Similar previous acoustic project", similar),
    "These are review prompts from controlled RAG evidence; they do not by themselves prove that iAcoustics holds the current appointment.",
  ].filter(Boolean).join(" ");
}

function projectHistoryEvidence(record: TenderOpportunity) {
  return (record.historicalProjectMatches ?? []).map((match) => [
    `Relationship: ${match.relationship}`,
    `Historical project: ${match.title}`,
    `Matched on: ${match.matchedOn.join("; ")}`,
    `Source ID: ${match.sourceId}`,
    match.sourceUri ? `Source URI: ${match.sourceUri}` : "",
    typeof match.score === "number" ? `Search score: ${match.score}` : "",
    `Evidence excerpt: ${match.excerpt}`,
  ].filter(Boolean).join(" | ")).join("\n");
}

function assignmentDetails(record: TenderOpportunity) {
  const owner = record.routedTo === "Glen" ? "Glen Plunkett"
    : record.routedTo === "Owen" ? "Eoghan Tyrrell" : "Unassigned";
  if (record.emailRelationshipStatus === "verified-single-owner") {
    const relationshipOwner = record.emailRelationshipOwner === "Glen" ? "Glen Plunkett"
      : record.emailRelationshipOwner === "Owen" ? "Eoghan Tyrrell" : "not resolved";
    if (record.routedTo === "unassigned") {
      return `Unassigned — lead is not yet consultant-routeable; exact historical relationship belongs to ${relationshipOwner}.`;
    }
    return `${owner} — assigned from an exact single-owner email-evidence match.`;
  }
  if (record.emailRelationshipStatus === "verified-multiple-owners") {
    return record.routedTo === "unassigned"
      ? "Unassigned — exact history exists for both Glen and Eoghan; lead is not yet consultant-routeable."
      : `${owner} — workload assignment; exact history exists for both Glen and Eoghan.`;
  }
  return record.routedTo === "unassigned"
    ? "Unassigned — no consultant-routeable owner yet."
    : `${owner} — balanced workload assignment; no confirmed warm relationship.`;
}

const SOURCE_CODES: Record<TenderOpportunity["sourceSystem"], string> = {
  BuildingInfo: "BI",
  PlanningLeads: "PL",
  "National Planning Register": "NPR",
  DCC: "DCC",
  eTenders: "TD",
  TED: "EU",
};

const SOURCE_CODE_ORDER = ["BI", "PL", "NPR", "DCC", "TD", "EU"];

function sourceProjectUrl(
  record: TenderOpportunity,
  source: { sourceSystem: TenderOpportunity["sourceSystem"]; sourceRecordId?: string; sourceUrl?: string },
) {
  const supplied = String(source.sourceUrl ?? "").trim().replace(/^http:/i, "https:");
  if (supplied && !genericPlanningPortalUrl(supplied)) return supplied;
  if (source.sourceSystem !== "National Planning Register") return "";
  const reference = record.projectReference
    || String(source.sourceRecordId ?? record.sourceRecordId).split(":").at(-1)
    || "";
  if (!reference) return "";
  return nationalPlanningProjectUrl(record.planningAuthority ?? "", reference, supplied);
}

function withoutSourcePrefix(value: string | undefined) {
  return String(value ?? "").trim()
    .replace(/^\[(?:BI|PL|NPR|DCC|TD|EU)(?:\+(?:BI|PL|NPR|DCC|TD|EU))*\]\s*/i, "");
}

function isLegacyJobNumberOnly(value: string | undefined) {
  return /^J[-\s]?\d+$/i.test(withoutSourcePrefix(value));
}

function projectTitle(record: TenderOpportunity) {
  const current = withoutSourcePrefix(record.title);
  if (current && !isLegacyJobNumberOnly(current)) return current;
  const location = String(record.location ?? "").trim();
  if (location) return location;
  const applicant = String(record.applicant ?? record.buyer ?? "").trim();
  const reference = String(record.projectReference ?? record.sourceRecordId ?? "").trim();
  if (applicant && reference) return `${applicant} — ${reference}`;
  if (applicant) return applicant;
  return reference ? `Planning project ${reference}` : "Planning project — title recovery required";
}

function classificationLabel(record: TenderOpportunity) {
  return (record.classification ?? record.type).replaceAll("-", " ");
}

const partyPriority: LeadParty["role"][] = [
  "applicant",
  "developer",
  "architect",
  "agent",
  "contractor",
  "consultant",
  "other",
];

const partyRoleScore: Record<LeadParty["role"], number> = {
  applicant: 70,
  developer: 65,
  agent: 60,
  architect: 55,
  contractor: 45,
  consultant: 35,
  other: 0,
};

function partyContactScore(party: LeadParty) {
  const individualContact = Boolean(party.name && party.organisation && party.name !== party.organisation);
  return partyRoleScore[party.role]
    + (party.email ? 35 : 0)
    + (party.phone ? 20 : 0)
    + (individualContact ? 10 : 0);
}

function primaryParty(record: TenderOpportunity) {
  const parties = enrichedParties(record).sort((left, right) => {
    const score = partyContactScore(right) - partyContactScore(left);
    if (score !== 0) return score;
    return partyPriority.indexOf(left.role) - partyPriority.indexOf(right.role);
  });
  return parties[0];
}

function organisationRole(party?: LeadParty) {
  if (!party) return "";
  return party.role.replace(/(^|-)([a-z])/g, (_match, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function canonicalProjectSector(record: TenderOpportunity) {
  const sector = `${record.projectSector ?? ""} ${record.description ?? ""}`.toLowerCase();
  if (/residential|housing|apartment|dwelling/.test(sector)) return "Residential";
  if (/education|school|college|university/.test(sector)) return "Education";
  if (/hospitality|hotel|hostel|restaurant/.test(sector)) return "Hospitality & Restaurants";
  if (/health|hospital|medical|clinic/.test(sector)) return "Healthcare";
  if (/live event|festival/.test(sector)) return "Live Events";
  if (/entertainment|cinema|theatre|concert venue/.test(sector)) return "Entertainment Venues";
  if (/visitor attraction|museum|gallery/.test(sector)) return "Visitor Attractions";
  if (/leisure|sport|gym|padel/.test(sector)) return "Leisure & Sports";
  if (/industrial|warehouse|factory|manufactur/.test(sector)) return "Industrial";
  if (/mixed.?use/.test(sector)) return "Mixed Use";
  if (/media|studio|broadcast|production/.test(sector)) return "Media Production";
  if (/planning|environment/.test(sector)) return "Planning & Environmental";
  if (/commercial|retail|office/.test(sector)) return "Commercial";
  return record.projectSector ? "Other" : "";
}

function evidenceDocumentUrls(record: TenderOpportunity) {
  return [...new Set((record.evidenceDocuments ?? [])
    .map((document) => document.sourceUrl)
    .filter(Boolean))].join("\n");
}

function verifiedWarmConnection(record: TenderOpportunity) {
  return record.emailRelationshipStatus === "verified-single-owner"
    || record.emailRelationshipStatus === "verified-multiple-owners"
    || /^exact-party-match-supported-by-(?:glen|owen)-email-evidence$/i.test(record.routingReason ?? "");
}

function displayedLeadQuality(record: TenderOpportunity) {
  const quality = record.leadQuality ?? "medium";
  const terminal = ["poor", "closed-background", "existing-project"].includes(quality)
    || ["background", "already-won"].includes(record.leadDisposition ?? "");
  return !terminal && !hasConfirmedCurrentAcousticEvidence(record) ? "potential" : quality;
}

function isPartECommercialLead(record: TenderOpportunity) {
  return ["attached-4-plus", "lrd-100-plus"].includes(record.residentialScale ?? "")
    && !["poor", "closed-background", "existing-project"].includes(record.leadQuality ?? "")
    && !["background", "already-won"].includes(record.leadDisposition ?? "");
}

function isPotentialAcousticFit(record: TenderOpportunity) {
  return !hasConfirmedCurrentAcousticEvidence(record)
    && !["poor", "closed-background", "existing-project"].includes(record.leadQuality ?? "")
    && !["background", "already-won"].includes(record.leadDisposition ?? "");
}

function leadReviewPanel(record: TenderOpportunity, now: Date) {
  if (record.acousticAppointmentStatus === "iacoustics-appointed"
    || record.leadQuality === "existing-project"
    || record.leadDisposition === "already-won") {
    return "Existing Relationship / Do Not Cold Contact";
  }
  if (record.classification === "noise-related-rfi" && hasConfirmedCurrentAcousticEvidence(record)) {
    if (record.rfiResponseReceivedAt) return "Competitive / Re-engagement";
    const daysRemaining = calendarDaysRemaining(record.responseDeadline ?? "", now);
    if (daysRemaining !== false && daysRemaining < 0) return "Competitive / Re-engagement";
    return "Urgent Acoustic RFI";
  }
  if (record.classification === "granted-with-noise-conditions"
    && hasConfirmedCurrentAcousticEvidence(record)) {
    if (expiredGrantedCondition(record, now)) return "Competitive / Re-engagement";
    return "Granted with Acoustic Conditions";
  }
  if (isPostDecisionStage(record)) return "Competitive / Re-engagement";
  if (record.acousticAppointmentStatus === "competitor-appointed") return "Competitive / Re-engagement";
  if (hasConfirmedCurrentAcousticEvidence(record)) return "Confirmed Acoustic Opportunity";
  if (isPotentialAcousticFit(record)) return "Potential Acoustic Fit";
  return "General Potential / Background";
}

function emailMatchTagName(record: TenderOpportunity) {
  if (record.emailRelationshipStatus === "verified-multiple-owners") {
    if (record.routedTo === "Glen") return "Email Match: Glen";
    if (record.routedTo === "Owen") return "Email Match: Eoghan";
    return "Email Match: Verified";
  }
  if (!verifiedWarmConnection(record)) return undefined;
  const owner = record.emailRelationshipOwner ?? record.routedTo;
  if (owner === "Glen") return "Email Match: Glen";
  if (owner === "Owen") return "Email Match: Eoghan";
  return "Email Match: Verified";
}

function sourceValues(record: TenderOpportunity) {
  const sources = record.duplicateSources?.length ? record.duplicateSources : [{
    id: record.id,
    sourceSystem: record.sourceSystem,
    sourceRecordId: record.sourceRecordId,
    sourceUrl: record.sourceUrl,
    evidenceStatus: record.evidenceStatus,
  }];
  return {
    codes: [...new Set(sources.map((source) => SOURCE_CODES[source.sourceSystem]))]
      .sort((left, right) => SOURCE_CODE_ORDER.indexOf(left) - SOURCE_CODE_ORDER.indexOf(right))
      .join("+"),
    systems: [...new Set(sources.map((source) => source.sourceSystem))].join("; "),
    recordIds: sources.map((source) => `${source.sourceSystem}:${source.sourceRecordId}`).join("; "),
    urls: [...new Set(sources.map((source) => sourceProjectUrl(record, source)).filter(Boolean))].join("\n"),
  };
}

function sourceLedger(record: TenderOpportunity) {
  const sources = record.duplicateSources?.length ? record.duplicateSources : [{
    id: record.id,
    sourceSystem: record.sourceSystem,
    sourceRecordId: record.sourceRecordId,
    sourceUrl: record.sourceUrl,
    evidenceStatus: record.evidenceStatus,
  }];
  const sourceRows = sources.map((source, index) => {
    const contacts = (source.parties ?? []).map((party) => [
      party.role,
      party.name,
      party.organisation,
      party.email,
      party.phone,
    ].filter(Boolean).join(" / ")).join("; ");
    return [
      `Observation ${index + 1}: ${source.sourceSystem}`,
      `Source-native ID: ${source.sourceRecordId}`,
      `Internal record: ${source.id}`,
      `Imported from: ${(source.observationFiles ?? []).join("; ") || "Current source collection"}`,
      `First seen: ${source.firstSeenAt || "Unavailable"}`,
      `Last seen: ${source.lastSeenAt || "Unavailable"}`,
      `Observed/imported: ${source.observedAt || "Unavailable"}`,
      `Project URL: ${sourceProjectUrl(record, source) || "Not supplied"}`,
      `Document name(s): ${(source.documentNames ?? []).join("; ") || "Not supplied"}`,
      `Document URL(s): ${(source.documentUrls ?? []).join("; ") || "Not supplied"}`,
      `Evidence status: ${source.evidenceStatus}`,
      `Evidence excerpt: ${compact(source.evidenceExcerpt ?? "", 600) || "Not supplied"}`,
      `Extracted contacts: ${contacts || "Not supplied"}`,
      `RFI published: ${source.rfiPublishedAt || "Unavailable"}`,
      `RFI received/detected: ${source.rfiReceivedAt || "Unavailable"}`,
      `RFI response due: ${source.rfiResponseDueAt || "Unavailable"}`,
      `Further-information response received: ${source.rfiResponseReceivedAt || "Unavailable"}`,
      `Planning received: ${source.planningReceivedAt || "Unavailable"}`,
      `Planning validated: ${source.planningValidatedAt || "Unavailable"}`,
      `Planning decision due: ${source.planningDecisionDueAt || "Unavailable"}`,
      `Acoustic trigger result: ${(source.matchedTerms ?? []).join("; ") || "No confirmed term"}`,
      `Classification result: ${source.classification || "Unclassified"}`,
    ].join("\n");
  });
  const conflicts = [
    ["RFI published", sources.map((source) => source.rfiPublishedAt)],
    ["RFI received/detected", sources.map((source) => source.rfiReceivedAt)],
    ["RFI response due", sources.map((source) => source.rfiResponseDueAt)],
    ["Further-information response received", sources.map((source) => source.rfiResponseReceivedAt)],
    ["Planning received", sources.map((source) => source.planningReceivedAt)],
    ["Planning validated", sources.map((source) => source.planningValidatedAt)],
    ["Planning decision due", sources.map((source) => source.planningDecisionDueAt)],
  ].flatMap(([label, values]) => {
    const distinct = [...new Set((values as Array<string | undefined>).filter(Boolean))];
    return distinct.length > 1 ? [`Date conflict — ${label}: ${distinct.join(" versus ")}`] : [];
  });
  const relationshipRows = (record.routingEvidence ?? []).map((evidence) => [
    `Matched party: ${evidence.party}`,
    `Matched entity: ${evidence.matchedEntity}`,
    evidence.matchedEmail ? `Email: ${evidence.matchedEmail}` : "",
    evidence.emailSubject ? `Subject: ${evidence.emailSubject}` : "",
    evidence.emailSentAt ? `Email date: ${evidence.emailSentAt}` : "",
    evidence.emailContext ? `Conversation: ${compact(evidence.emailContext, 500)}` : "",
    `Evidence reference(s): ${evidence.evidenceRefs.join("; ")}`,
  ].filter(Boolean).join(" | "));
  return [
    `Canonical opportunity: ${record.canonicalOpportunityId ?? record.id}`,
    `Deduplication status: ${record.deduplicationStatus ?? "unique"}`,
    record.deduplicationGroupId ? `Deduplication group: ${record.deduplicationGroupId}` : "",
    record.deduplicationReason ? `Deduplication reason: ${record.deduplicationReason}` : "",
    `Relationship result: ${record.emailRelationshipStatus ?? "no-confirmed-match"}`,
    `Assignment result: ${ownerDisplayName(record) || "No operational assignment"}`,
    record.routingReason ? `Routing reason: ${record.routingReason}` : "",
    ...sourceRows,
    ...relationshipRows,
    ...conflicts,
    `Odoo synchronization: idempotent upsert using ${record.crmExternalId ?? "pending stable external identifier"}; field-level API outcome is retained in the run audit`,
  ].filter(Boolean).join("\n\n");
}

function projectLink(record: TenderOpportunity) {
  const sources = record.duplicateSources?.length ? record.duplicateSources : [{
    sourceSystem: record.sourceSystem,
    sourceUrl: record.sourceUrl,
  }];
  const buildingInfo = sources.find((source) => source.sourceSystem === "BuildingInfo"
    && sourceProjectUrl(record, source));
  if (buildingInfo) return sourceProjectUrl(record, buildingInfo);
  for (const source of sources) {
    const url = sourceProjectUrl(record, source);
    if (url) return url;
  }
  return sourceProjectUrl(record, {
    sourceSystem: record.sourceSystem,
    sourceRecordId: record.sourceRecordId,
    sourceUrl: record.sourceUrl,
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlText(value: unknown, fallback = "Not supplied") {
  const text = String(value ?? "").trim();
  return escapeHtml(text || fallback).replaceAll("\n", "<br>");
}

function htmlRows(rows: Array<[string, unknown]>) {
  return `<table style="width:100%;border-collapse:collapse">${rows.map(([label, value]) =>
    `<tr><td style="width:220px;padding:3px 12px 3px 0;vertical-align:top"><strong>${escapeHtml(label)}</strong></td><td style="padding:3px 0;vertical-align:top">${htmlText(value)}</td></tr>`,
  ).join("")}</table>`;
}

function htmlNamedLinks(title: string, links: Array<{ label: string; url: string }>) {
  const unique = new Map<string, string>();
  for (const link of links) {
    const url = String(link.url ?? "").trim();
    if (url && !unique.has(url)) unique.set(url, String(link.label ?? "").trim() || url);
  }
  if (unique.size === 0) return `<h3>${escapeHtml(title)}</h3><p>Not supplied</p>`;
  return `<h3>${escapeHtml(title)}</h3><ul>${[...unique].map(([url, label]) =>
    `<li><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></li>`,
  ).join("")}</ul>`;
}

function projectSourceLinks(record: TenderOpportunity) {
  const sources = record.duplicateSources?.length ? record.duplicateSources : [{
    sourceSystem: record.sourceSystem,
    sourceRecordId: record.sourceRecordId,
    sourceUrl: record.sourceUrl,
  }];
  return sources.map((source) => ({
    label: `${source.sourceSystem} project · ${source.sourceRecordId}`,
    url: sourceProjectUrl(record, source),
  })).filter((source) => Boolean(source.url));
}

function evidenceDocumentLinks(record: TenderOpportunity) {
  return (record.evidenceDocuments ?? []).map((document) => ({
    label: `${document.documentType}${document.description && document.description !== document.documentType ? ` · ${document.description}` : ""}`,
    url: document.sourceUrl,
  }));
}

function allPartyRows(record: TenderOpportunity) {
  const parties = enrichedParties(record);
  const verifiedEmails = verifiedRelationshipEmails(record);
  if (parties.length === 0) return "<p>No project parties were supplied by the source.</p>";
  return `<table style="width:100%;border-collapse:collapse"><tr><th style="text-align:left">Role</th><th style="text-align:left">Name</th><th style="text-align:left">Organisation</th><th style="text-align:left">Email</th><th style="text-align:left">Phone</th><th style="text-align:left">Contact provenance</th></tr>${parties.map((party) =>
    `<tr><td>${htmlText(organisationRole(party))}</td><td>${htmlText(party.name)}</td><td>${htmlText(party.organisation)}</td><td>${htmlText(party.email)}</td><td>${htmlText(party.phone)}</td><td>${htmlText(party.email && verifiedEmails.has(normalizedEmail(party.email)) ? "Verified iAcoustics email-history match" : "Source supplied")}</td></tr>`,
  ).join("")}</table>`;
}

function appointmentTagNames(record: TenderOpportunity) {
  const tags: string[] = [];
  if (isPartECommercialLead(record)) tags.push("Part E Commercial");
  if (record.acousticAppointmentStatus === "iacoustics-appointed") tags.push("Already Won: iAcoustics");
  if (record.acousticAppointmentStatus === "competitor-appointed") tags.push("Competitor Appointed");
  if (record.acousticAppointmentStatus === "needs-verification") tags.push("Appointment: Verify");
  return tags;
}

function appointmentDetails(record: TenderOpportunity) {
  return [
    `Status: ${record.acousticAppointmentStatus ?? "not-identified"}`,
    `Appointed acoustician: ${record.appointedAcoustician ?? "Not identified"}`,
    `Competitive quote opportunity: ${record.competitiveQuoteOpportunity ? "Yes — consultant review required" : "No"}`,
    `Outreach eligibility: ${record.outreachEligibility ?? "eligible"}`,
    record.outreachSuppressionReason ? `Safeguard: ${record.outreachSuppressionReason}` : "Safeguard: No appointment-based suppression applied.",
    record.appointmentEvidenceExcerpt ? `Appointment evidence: ${compact(record.appointmentEvidenceExcerpt, 420)}` : "Appointment evidence: Not supplied",
    record.appointmentEvidenceSourceUrl ? `Appointment evidence source: ${record.appointmentEvidenceSourceUrl}` : "",
    record.outreachKey ? `Outreach deduplication key: ${record.outreachKey}` : "",
  ].filter(Boolean).join("\n");
}

function recommendedReviewAction(record: TenderOpportunity, now: Date) {
  if (record.acousticAppointmentStatus === "iacoustics-appointed") {
    return "Link this intelligence to the existing iAcoustics project or relationship. Do not cold-contact the project as a new-business lead.";
  }
  if (record.acousticAppointmentStatus === "competitor-appointed") {
    return "Acoustic consultant review required: decide whether a competitive offer is commercially appropriate. Do not send a quotation automatically.";
  }
  if (record.classification === "noise-related-rfi" && hasConfirmedCurrentAcousticEvidence(record)) {
    const urgency = recordUrgency(record, now);
    return `${urgency}. Review the exact RFI evidence, confirm the most relevant project contact and decide the response before the RFI due date.`;
  }
  if (record.classification === "granted-with-noise-conditions"
    && hasConfirmedCurrentAcousticEvidence(record)) {
    return "Permission has been granted with an explicit acoustic or noise condition. Review the exact condition, project stage and verified contacts, then decide the consultant-led approach.";
  }
  if (hasConfirmedCurrentAcousticEvidence(record) && verifiedWarmConnection(record)) {
    return "Review the verified historical relationship and current acoustic evidence together, then decide the appropriate consultant-led contact.";
  }
  if (hasConfirmedCurrentAcousticEvidence(record)) {
    return "Review the current acoustic evidence and source-supplied contacts, then decide whether the Lead should be qualified into the active Pipeline.";
  }
  return "Retain as a potential acoustic lead, monitor for authoritative acoustic evidence and do not present it as an explicit acoustic requirement.";
}

function isPostDecisionStage(record: TenderOpportunity) {
  const stage = `${record.projectStage ?? ""} ${record.sourceStatus ?? ""}`;
  if (/request(?:ed)?\s+(?:for\s+)?additional information|additional information requested|further information requested/i.test(stage)) {
    return false;
  }
  return /grant(?:ed)?|conditional|refus(?:e|ed|al)|withdrawn|invalid(?:ated)?|commencement|construction|on site|completed/i.test(stage);
}

function recentRfiWithoutDueDate(record: TenderOpportunity, now: Date) {
  return [rfiReceivedOrDetectedAt(record), rfiPublishedAt(record)]
    .map((value) => calendarDaysRemaining(value, now))
    .some((age) => age !== false && age <= 0 && age >= -42);
}

const GRANTED_CONDITION_ACTIVE_DAYS = 30;

function expiredGrantedCondition(record: TenderOpportunity, now: Date) {
  if (record.classification !== "granted-with-noise-conditions") return false;
  const decisionDaysRemaining = calendarDaysRemaining(planningDecisionDueAt(record), now);
  return decisionDaysRemaining !== false
    && decisionDaysRemaining < -GRANTED_CONDITION_ACTIVE_DAYS;
}

function isClosedLeadStage(record: TenderOpportunity) {
  const stage = `${record.projectStage ?? ""} ${record.sourceStatus ?? ""}`;
  return /refus(?:e|ed|al)|withdrawn|invalid(?:ated)?|cancelled|completed|awarded/i.test(stage);
}

function activeLeadQueueStatus(record: TenderOpportunity, now: Date): boolean | undefined {
  // Every legitimate project remains in the working Leads queue unless an
  // explicit date or outcome proves that it is no longer actionable. Missing
  // links, evidence or freshness metadata lower review confidence; they must
  // never make a valid project disappear from Odoo.
  if (record.acousticAppointmentStatus === "iacoustics-appointed"
    || record.leadQuality === "existing-project"
    || record.leadDisposition === "already-won") return false;

  // Permission granted with a confirmed acoustic/noise condition is the
  // second primary target after live acoustic RFIs, but only during the
  // agreed recent-action window after the decision date.
  if (record.classification === "granted-with-noise-conditions"
    && hasConfirmedCurrentAcousticEvidence(record)) {
    return !expiredGrantedCondition(record, now);
  }

  if (record.classification === "noise-related-rfi") {
    if (record.rfiResponseReceivedAt) return false;
    const daysRemaining = calendarDaysRemaining(record.responseDeadline ?? "", now);
    if (daysRemaining !== false) return daysRemaining >= 0;

    // An official Further Information Request with no supplied response due
    // date remains actionable only while its received/published evidence is
    // recent. Older undated RFIs stay in the source ledger but do not overload
    // the active Tender Desk queue.
    return recentRfiWithoutDueDate(record, now);
  }

  if (isClosedLeadStage(record)) return false;

  if (record.type === "formal-public-tender") {
    const daysRemaining = calendarDaysRemaining(record.deadline ?? "", now);
    return daysRemaining === false || daysRemaining >= 0;
  }

  if (record.type === "planning-pipeline-lead") {
    const daysRemaining = calendarDaysRemaining(planningDecisionDueAt(record), now);
    return daysRemaining === false || daysRemaining >= 0;
  }

  return true;
}

function commercialRfiTieBreaker(buildingInfo: boolean, verifiedEmailMatch: boolean) {
  return buildingInfo && verifiedEmailMatch ? 30
    : verifiedEmailMatch ? 20
      : buildingInfo ? 10 : 0;
}

function rfiActivityFreshness(record: TenderOpportunity, now: Date) {
  return [rfiReceivedOrDetectedAt(record), rfiPublishedAt(record)]
    .map((value) => calendarDaysRemaining(value, now))
    .filter((days): days is number => days !== false && days <= 0)
    .map((days) => 900 - Math.min(Math.abs(days), 900))
    .reduce((freshest, score) => Math.max(freshest, score), 0);
}

function grantedConditionsActivityAge(record: TenderOpportunity, now: Date) {
  const documentDates = (record.evidenceDocuments ?? [])
    .filter((document) => document.classification === "granted-with-noise-conditions")
    .map((document) => document.receivedAt);
  const ages = [
    ...documentDates,
    record.sourceMajorUpdatedAt,
    record.sourceUpdatedAt,
    record.lastConfirmedAt,
    record.lastSeenAt,
    record.publishedAt,
    record.planningReceivedAt,
    record.firstSeenAt,
  ]
    .map((value) => calendarDaysRemaining(value ?? "", now))
    .filter((days): days is number => days !== false && days <= 0)
    .map((days) => Math.abs(days));
  return ages.length ? Math.min(...ages) : false;
}

function liveRfiPriority(
  daysRemaining: number,
  activityFreshness: number,
  buildingInfo: boolean,
  verifiedEmailMatch: boolean,
) {
  // The response date is absolute across every source. BuildingInfo and
  // verified relationships break ties only after the deadline has matched.
  const dueDateRank = 2_100_000_000 - Math.min(daysRemaining, 5_000) * 100_000;
  return dueDateRank
    + commercialRfiTieBreaker(buildingInfo, verifiedEmailMatch) * 2_500
    + activityFreshness * 20;
}

function recentUndatedRfiPriority(
  activityFreshness: number,
  buildingInfo: boolean,
  verifiedEmailMatch: boolean,
) {
  return 1_500_000_000
    + activityFreshness * 100
    + commercialRfiTieBreaker(buildingInfo, verifiedEmailMatch);
}

function expiredRfiPriority(daysPastDue: number, buildingInfo: boolean, verifiedEmailMatch: boolean) {
  // Expired RFIs remain searchable for competitive follow-up but can never
  // outrank a live RFI or an active planning decision.
  return -100_000_000 - Math.min(daysPastDue, 9_000) * 100
    + commercialRfiTieBreaker(buildingInfo, verifiedEmailMatch);
}

function grantedAcousticConditionsPriority(
  daysSinceActivity: number,
  buildingInfo: boolean,
  verifiedEmailMatch: boolean,
) {
  return 1_200_000_000
    + commercialRfiTieBreaker(buildingInfo, verifiedEmailMatch) * 2_500
    + (120 - Math.min(daysSinceActivity, 120)) * 1_000;
}

function secondaryPlanningDecisionPriority(
  daysRemaining: number,
  buildingInfo: boolean,
  retainedRelationship: boolean,
) {
  return 20_000
    + (5_000 - Math.min(daysRemaining, 5_000)) * 10
    + commercialRfiTieBreaker(buildingInfo, retainedRelationship);
}

function liveRfiPriorityReason(
  daysRemaining: number,
  hasActivityDate: boolean,
  buildingInfo: boolean,
  verifiedEmailMatch: boolean,
) {
  const due = daysRemaining === 0 ? "due today" : `due in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`;
  const chronology = hasActivityDate
    ? "; RFI received/published date is the secondary ordering key"
    : "; RFI received/published date unavailable";
  const source = buildingInfo ? "; human-reviewed BuildingInfo source" : "";
  const relationship = verifiedEmailMatch ? "; verified acoustic consultant email relationship" : "";
  const ordering = "; response deadline has absolute precedence across all sources";
  return `Active acoustic RFI ${due}${ordering}${chronology}${source}${relationship}`;
}

function pipelinePriority(record: TenderOpportunity, now: Date) {
  const routeable = !["poor", "closed-background", "existing-project"].includes(record.leadQuality ?? "")
    && !["background", "already-won"].includes(record.leadDisposition ?? "");
  const confirmedAcoustic = hasConfirmedCurrentAcousticEvidence(record);
  const retainedRelationship = verifiedWarmConnection(record);
  const verifiedEmailMatch = retainedRelationship && routeable && confirmedAcoustic;
  const rfi = record.classification === "noise-related-rfi" && routeable && confirmedAcoustic;
  const grantedAcousticConditions = record.classification === "granted-with-noise-conditions"
    && routeable
    && confirmedAcoustic;
  const buildingInfo = sourceValues(record).codes.split("+").includes("BI");
  const rfiDaysRemaining = calendarDaysRemaining(record.responseDeadline ?? "", now);
  const activityFreshness = rfiActivityFreshness(record, now);
  const grantedConditionsAge = grantedConditionsActivityAge(record, now);
  const liveDatedRfi = rfi && rfiDaysRemaining !== false && rfiDaysRemaining >= 0;
  const recentUndatedRfi = rfi && rfiDaysRemaining === false && recentRfiWithoutDueDate(record, now);
  const expiredRfi = rfi && rfiDaysRemaining !== false && rfiDaysRemaining < 0;
  const fulfilledRfi = rfi && Boolean(record.rfiResponseReceivedAt);
  const decisionDaysRemaining = calendarDaysRemaining(planningDecisionDueAt(record), now);
  const postDecisionStage = isPostDecisionStage(record);
  const livePlanningDecision = record.type === "planning-pipeline-lead"
    && !rfi
    && routeable
    && decisionDaysRemaining !== false
    && decisionDaysRemaining >= 0
    && !postDecisionStage;
  const stalePendingPlanningDecision = record.type === "planning-pipeline-lead"
    && !rfi
    && decisionDaysRemaining !== false
    && decisionDaysRemaining < 0
    && !postDecisionStage;
  const expiredGrant = grantedAcousticConditions && expiredGrantedCondition(record, now);

  if (liveDatedRfi && !fulfilledRfi) {
    return {
      rank: liveRfiPriority(rfiDaysRemaining, activityFreshness, buildingInfo, verifiedEmailMatch),
      reason: liveRfiPriorityReason(rfiDaysRemaining, activityFreshness > 0, buildingInfo, verifiedEmailMatch),
    };
  }
  if (recentUndatedRfi && !fulfilledRfi) return {
    rank: recentUndatedRfiPriority(activityFreshness, buildingInfo, verifiedEmailMatch),
    reason: `Recent confirmed acoustic RFI ordered by received/published date; response due date not supplied${buildingInfo ? "; human-reviewed BuildingInfo source" : ""}${verifiedEmailMatch ? "; verified acoustic consultant email relationship" : ""}`,
  };
  if (fulfilledRfi) {
    return {
      rank: -200_000_000 + commercialRfiTieBreaker(buildingInfo, verifiedEmailMatch),
      reason: `Further-information response was received ${record.rfiResponseReceivedAt}; archived from active Leads and retained for audit, relationship history and competitive follow-up, never treated as an open RFI${buildingInfo ? "; human-reviewed BuildingInfo provenance retained" : ""}`,
    };
  }
  if (expiredRfi) {
    const daysPastDue = Math.abs(rfiDaysRemaining);
    return {
      rank: expiredRfiPriority(daysPastDue, buildingInfo, verifiedEmailMatch),
      reason: `RFI response date passed ${daysPastDue} day${daysPastDue === 1 ? "" : "s"} ago; archived from active Leads and retained for audit, deduplication and consultant-reviewed competitive follow-up${verifiedEmailMatch ? "; verified relationship retained for context" : ""}`,
    };
  }
  if (expiredGrant) {
    return {
      rank: 90 + commercialRfiTieBreaker(buildingInfo, retainedRelationship),
      reason: `Acoustic-condition grant is more than ${GRANTED_CONDITION_ACTIVE_DAYS} days past its decision date; archived from active Leads and retained for audit and later competitive review`,
    };
  }
  if (grantedAcousticConditions) {
    return {
      rank: grantedAcousticConditionsPriority(grantedConditionsAge === false ? 120 : grantedConditionsAge, buildingInfo, retainedRelationship),
      reason: `Permission granted with confirmed acoustic/noise conditions; second primary category after current Further Information Requests; newest grant evidence first${buildingInfo ? "; human-reviewed BuildingInfo source" : ""}${retainedRelationship ? "; verified historical relationship" : ""}`,
    };
  }
  if (postDecisionStage) {
    return {
      rank: 100 + commercialRfiTieBreaker(buildingInfo, retainedRelationship),
      reason: "Planning outcome is already conditional, granted, refused or otherwise decided; retained for later competitive follow-up and demoted below live work",
    };
  }
  if (stalePendingPlanningDecision) {
    return retainedRelationship
      ? { rank: 180, reason: "Planning decision due date has passed with no confirmed outcome; refresh required before action. Historical relationship retained for context" }
      : { rank: 120, reason: "Planning decision due date has passed with no confirmed outcome; retained below live work until refreshed" };
  }
  if (livePlanningDecision) {
    return {
      rank: secondaryPlanningDecisionPriority(decisionDaysRemaining, buildingInfo, retainedRelationship),
      reason: `Secondary planning monitor: decision due in ${decisionDaysRemaining} day${decisionDaysRemaining === 1 ? "" : "s"}; current-project acoustic evidence is not one of the two primary targets${buildingInfo ? "; human-reviewed BuildingInfo source retained" : ""}${retainedRelationship ? "; verified historical relationship retained" : ""}`,
    };
  }
  if (buildingInfo && routeable) {
    const commercialRank = !confirmedAcoustic
      ? isPartECommercialLead(record) ? 500 : retainedRelationship ? 320 : 220
      : verifiedEmailMatch ? 900
        : record.acousticAppointmentStatus === "competitor-appointed" ? 700
          : record.leadQuality === "excellent" ? 800
            : record.leadQuality === "good" ? 600
              : record.leadQuality === "medium" ? 400 : 200;
    return {
      rank: 10_000 + commercialRank,
      reason: `Secondary BuildingInfo review; ${confirmedAcoustic ? "current acoustic evidence confirmed but it is not a live RFI or granted acoustic condition" : "retained as a potential acoustic fit pending authoritative confirmation"}`,
    };
  }
  if (rfi && verifiedEmailMatch) {
    return { rank: 1000, reason: "Acoustic RFI with verified consultant email history; RFI dates unavailable" };
  }
  if (rfi) return { rank: 950, reason: "Acoustic RFI retained for review; RFI dates unavailable" };
  if (!confirmedAcoustic && isPartECommercialLead(record)) {
    return {
      rank: 500,
      reason: "Part E commercial review: attached residential scheme of at least four units; potential acoustic work expected, ordered by project value within the Potential Acoustic Fit panel",
    };
  }
  if (!confirmedAcoustic) {
    return retainedRelationship
      ? { rank: 320, reason: "Potential acoustic fit only; current-project acoustic evidence is unconfirmed. Verified historical relationship retained for context, not opportunity proof" }
      : { rank: 220, reason: "Potential acoustic fit only; current-project acoustic evidence is unconfirmed" };
  }
  if (verifiedEmailMatch) return { rank: 900, reason: "Qualified opportunity with a verified consultant email relationship" };
  if (record.leadQuality === "excellent") return { rank: 800, reason: "Excellent opportunity without a verified email relationship" };
  if (record.acousticAppointmentStatus === "competitor-appointed") return { rank: 700, reason: "Competitive quotation opportunity requiring consultant review" };
  if (record.leadQuality === "good") return { rank: 600, reason: "Good opportunity" };
  if (record.leadQuality === "medium") return { rank: 400, reason: "Medium opportunity for monitoring" };
  if (record.leadQuality === "poor") return { rank: 200, reason: "Low-priority opportunity retained for background" };
  if (record.leadQuality === "existing-project") return { rank: 100, reason: "Already won by iAcoustics; excluded from outreach ordering" };
  return { rank: 0, reason: "Closed or background record" };
}

function description(record: TenderOpportunity, now: Date) {
  const sources = sourceValues(record);
  const primary = primaryParty(record);
  const primaryOrganisation = primary?.organisation ?? record.applicant ?? record.buyer ?? "Not supplied";
  const primaryName = primary?.name && primary.name !== primaryOrganisation ? primary.name : "Not supplied";
  const actionDeadline = actionableDeadline(record);
  const daysRemaining = calendarDaysRemaining(actionDeadline, now);
  return [
    "<h2>Project Summary</h2>",
    `<p>${htmlText(record.description, "No additional project description supplied.")}</p>`,
    htmlRows([
      ["Source", `${sources.systems} (${sources.codes})`],
      ["Source record(s)", sources.recordIds],
      ["Project reference", record.projectReference],
      ["Location", record.location],
      ["County", record.county],
      ["Planning authority", record.planningAuthority],
      ["Sector", record.projectSector],
      ["Stage", record.projectStage ?? record.sourceStatus],
      ["Classification", classificationLabel(record)],
      ["Acoustic evidence gate", acousticEvidenceGateLabel(record)],
      ["RFI / acoustic trigger", record.triggerType ?? record.classification],
      ["Lead quality", displayedLeadQuality(record)],
      ["Lead review panel", leadReviewPanel(record, now)],
      ["Pipeline disposition", record.leadDisposition ?? "monitor"],
      ["Project value", Number.isFinite(record.projectValue) ? record.projectValue : "Not supplied"],
      ["Project units", Number.isFinite(record.projectUnits) ? record.projectUnits : record.residentialUnitCount],
      ["Published", record.publishedAt],
      ["Source updated", record.sourceUpdatedAt],
      ["RFI published date", rfiPublishedAt(record)],
      ["RFI received / detected date", rfiReceivedOrDetectedAt(record)],
      ["RFI response due date", record.classification === "noise-related-rfi" ? record.responseDeadline : ""],
      ["Further-information response received", record.classification === "noise-related-rfi" ? record.rfiResponseReceivedAt : ""],
      ["RFI date source", rfiDateSource(record)],
      ["RFI date confidence", rfiDateConfidence(record)],
      ["Planning application received", planningReceivedAt(record)],
      ["Planning application validated", planningValidatedAt(record)],
      ["Planning decision due", planningDecisionDueAt(record)],
      ["Action deadline", actionDeadline],
      ["Days remaining", daysRemaining === false ? "Not supplied" : daysRemaining],
      ["Urgency", recordUrgency(record, now)],
      ["First seen", record.firstSeenAt],
      ["Last confirmed", record.lastConfirmedAt],
    ]),
    "<h2>Primary Project Contact</h2>",
    htmlRows([
      ["Name", primaryName],
      ["Organisation", primaryOrganisation],
      ["Role", organisationRole(primary)],
      ["Email", primary?.email],
      ["Phone", primary?.phone],
    ]),
    "<h2>All Project Parties and Contacts</h2>",
    allPartyRows(record),
    "<h2>Email Relationship and Consultant Assignment</h2>",
    "<p><strong>Relationship evidence only:</strong> a historical email match does not prove that this current project requires acoustic work.</p>",
    `<p><strong>Relationship summary:</strong> ${htmlText(relationshipSummary(record))}</p>`,
    htmlRows([["Assigned acoustic consultant", assignmentDetails(record)], ["Routing reason", record.routingReason]]),
    "<h2>Previous iAcoustics Project History</h2>",
    `<p>${htmlText(projectHistorySummary(record))}</p>`,
    "<h2>Appointment and Outreach Safeguard</h2>",
    `<p>${htmlText(appointmentDetails(record))}</p>`,
    "<h2>Acoustic Evidence and Qualification</h2>",
    `<p>${htmlText(record.evidenceExcerpt, "No exact excerpt retained; check the evidence-status field before outreach.")}</p>`,
    htmlRows([
      ["Evidence status", record.evidenceStatus],
      ["Matched acoustic terms", record.matchedTerms.join("; ")],
      ["CPV codes", record.cpvCodes.join("; ")],
      ["Qualification", record.qualificationReason ?? "Not yet commercially graded."],
      ["Freshness", record.freshnessReason ?? "Source publication date unavailable."],
      ["Deduplication status", record.deduplicationStatus ?? "unique"],
      ["Possible duplicates", (record.possibleDuplicateIds ?? []).join("; ")],
    ]),
    htmlNamedLinks("Project and Source Links", projectSourceLinks(record)),
    htmlNamedLinks("Evidence Document Links", evidenceDocumentLinks(record)),
    "<h2>Recommended Next Review Action</h2>",
    `<p>${htmlText(recommendedReviewAction(record, now))}</p>`,
  ].join("");
}

export function buildOdooDryRun(records: TenderOpportunity[], now = new Date()) {
  const payloads: OdooLeadDryRun[] = [];
  for (const record of records) {
    if (record.deduplicationStatus === "duplicate") continue;
    const externalId = record.crmExternalId;
    if (!externalId) throw new Error(`Record ${record.id} has no stable CRM external ID.`);
    const sources = sourceValues(record);
    const priority = pipelinePriority(record, now);
    const primary = primaryParty(record);
    const organisation = primary?.organisation ?? record.applicant ?? record.buyer ?? "";
    const contact = primary?.name ?? "";
    const deadline = actionableDeadline(record);
    payloads.push({
      operation: "upsert",
      matchField: "x_helmonic_external_id",
      matchValue: externalId,
      attribution: {
        campaignName: record.type === "planning-pipeline-lead"
          ? "Planning Outreach - Acoustics"
          : "Tender Outreach - Acoustics",
        mediumName: record.type === "planning-pipeline-lead"
          ? "Planning Intelligence"
          : "Tender Intelligence",
        sourceName: sources.systems.includes(";") ? "Helmonic Tender Intelligence" : sources.systems,
      },
      emailMatchTagName: emailMatchTagName(record),
      sourceTagNames: sources.codes.split("+").filter(Boolean),
      statusTagNames: appointmentTagNames(record),
      values: {
        ...(activeLeadQueueStatus(record, now) === undefined
          ? {}
          : { active: activeLeadQueueStatus(record, now) }),
        name: projectTitle(record),
        description: description(record, now),
        partner_name: organisation,
        contact_name: contact,
        email_from: primary?.email ?? "",
        phone: primary?.phone ?? "",
        function: organisationRole(primary),
        street: record.location ?? "",
        date_deadline: odooDate(deadline),
        x_helmonic_external_id: externalId,
        x_pipeline_bucket: record.leadDisposition ?? "monitor",
        x_pipeline_priority_rank: priority.rank,
        x_pipeline_priority_reason: priority.reason,
        x_lead_panel: leadReviewPanel(record, now),
        x_lead_quality: displayedLeadQuality(record),
        x_evidence_status: record.evidenceStatus,
        x_classification: record.classification ?? record.type,
        x_source_systems: sources.systems,
        x_source_record_ids: sources.recordIds,
        x_source_ledger: sourceLedger(record),
        x_project_link: projectLink(record),
        x_source_urls: sources.urls,
        x_evidence_excerpt: record.evidenceExcerpt ?? "",
        x_source_published_at: odooDatetime(record.publishedAt),
        x_source_updated_at: odooDatetime(record.sourceUpdatedAt),
        x_source_major_updated_at: odooDatetime(record.sourceMajorUpdatedAt),
        x_source_age_days: Number.isFinite(record.sourceAgeDays) ? record.sourceAgeDays! : false,
        x_freshness_band: record.leadFreshness ?? "date-unknown",
        x_deadline: odooDatetime(deadline),
        x_rfi_published_at: odooDatetime(rfiPublishedAt(record)),
        x_rfi_received_at: odooDatetime(rfiReceivedOrDetectedAt(record)),
        x_rfi_response_due_at: odooDatetime(record.classification === "noise-related-rfi" ? record.responseDeadline : ""),
        x_rfi_response_received_at: odooDatetime(record.classification === "noise-related-rfi" ? record.rfiResponseReceivedAt : ""),
        x_rfi_date_source: rfiDateSource(record),
        x_rfi_date_confidence: rfiDateConfidence(record),
        x_planning_received_at: odooDatetime(planningReceivedAt(record)),
        x_planning_validated_at: odooDatetime(planningValidatedAt(record)),
        x_decision_due_at: odooDatetime(planningDecisionDueAt(record)),
        x_action_days_remaining: calendarDaysRemaining(deadline, now),
        x_deadline_urgency: recordUrgency(record, now),
        x_rfi_trigger: record.triggerType ?? record.classification ?? "",
        x_assigned_person: ownerDisplayName(record),
        x_warm_connection_verified: verifiedWarmConnection(record),
        x_routing_reason: odooRoutingReason(record),
        x_relationship_summary: relationshipSummary(record),
        x_relationship_evidence: relationshipDetails(record),
        x_project_history_summary: projectHistorySummary(record),
        x_project_history_evidence: projectHistoryEvidence(record),
        x_deduplication_status: record.deduplicationStatus ?? "unique",
        x_possible_duplicate_ids: (record.possibleDuplicateIds ?? []).join(";"),
        x_project_value: Number.isFinite(record.projectValue) ? record.projectValue! : false,
        x_project_units: Number.isFinite(record.projectUnits)
          ? record.projectUnits!
          : Number.isFinite(record.residentialUnitCount) ? record.residentialUnitCount! : false,
        x_project_stage: record.projectStage ?? record.sourceStatus ?? "",
        x_opportunity_type: record.type,
        x_location: record.location ?? "",
        x_county: record.county ?? "",
        x_planning_authority: record.planningAuthority ?? "",
        x_project_reference: record.projectReference ?? "",
        x_applicant: record.applicant ?? "",
        x_party_details: partyDetails(record),
        x_cpv_codes: record.cpvCodes.join("; "),
        x_matched_terms: record.matchedTerms.join("; "),
        x_evidence_document_urls: evidenceDocumentUrls(record),
        x_residential_scale: record.residentialScale ?? "",
        x_first_seen_at: odooDatetime(record.firstSeenAt),
        x_last_seen_at: odooDatetime(record.lastSeenAt),
        x_last_confirmed_at: odooDatetime(record.lastConfirmedAt),
        x_cycle_status: record.cycleStatus ?? "",
        x_scope_status: record.scopeStatus ?? "unknown",
        x_acoustic_appointment_status: record.acousticAppointmentStatus ?? "not-identified",
        x_appointed_acoustician: record.appointedAcoustician ?? "",
        x_appointment_evidence: record.appointmentEvidenceExcerpt ?? "",
        x_appointment_evidence_source_url: record.appointmentEvidenceSourceUrl ?? "",
        x_competitive_quote_opportunity: record.competitiveQuoteOpportunity === true,
        x_outreach_eligibility: record.outreachEligibility ?? "eligible",
        x_outreach_suppression_reason: record.outreachSuppressionReason ?? "",
        x_outreach_key: record.outreachKey ?? "",
        x_buildinginfo_search_profile: record.buildingInfoSearchProfile ?? "",
        // Source/vendor references belong here. Odoo owns x_studio_reference
        // as the sequential A-number and the integration must never write it.
        x_source_reference: `${sources.codes}-${record.projectReference ?? record.sourceRecordId}`,
        x_studio_project_sector: canonicalProjectSector(record),
      },
    });
  }

  const externalIds = payloads.map((payload) => payload.matchValue);
  if (new Set(externalIds).size !== externalIds.length) {
    throw new Error("Odoo dry-run contains duplicate x_helmonic_external_id values.");
  }
  return payloads.sort((left, right) => left.matchValue.localeCompare(right.matchValue));
}

export function summarizeOdooDryRun(payloads: OdooLeadDryRun[]) {
  const count = (field: keyof OdooLeadDryRun["values"], value: unknown) =>
    payloads.filter((payload) => payload.values[field] === value).length;
  return {
    upserts: payloads.length,
    uniqueExternalIds: new Set(payloads.map((payload) => payload.matchValue)).size,
    active: count("x_pipeline_bucket", "active"),
    nurture: count("x_pipeline_bucket", "nurture"),
    monitor: count("x_pipeline_bucket", "monitor"),
    background: count("x_pipeline_bucket", "background"),
    alreadyWon: count("x_pipeline_bucket", "already-won"),
    excellent: count("x_lead_quality", "excellent"),
    good: count("x_lead_quality", "good"),
    medium: count("x_lead_quality", "medium"),
    poor: count("x_lead_quality", "poor"),
    closedBackground: count("x_lead_quality", "closed-background"),
    existingProjects: count("x_lead_quality", "existing-project"),
    competitorAppointed: count("x_acoustic_appointment_status", "competitor-appointed"),
    outreachSuppressedAlreadyWon: count("x_outreach_eligibility", "suppressed-already-won"),
    verifiedWarmConnections: count("x_warm_connection_verified", true),
    withActionableDeadline: payloads.filter((payload) => Boolean(payload.values.x_deadline)).length,
    evidenceUnavailable: count("x_evidence_status", "evidence-unavailable"),
    discoveryOnly: count("x_evidence_status", "discovery-only"),
    officialText: count("x_evidence_status", "official-text"),
  };
}
