export type OpportunityType = "formal-public-tender" | "planning-pipeline-lead";

export type PlanningClassification =
  | "noise-related-rfi"
  | "granted-with-noise-conditions"
  | "refused-on-noise-grounds"
  | "design-construction-potential"
  | "needs-council-evidence"
  | "no-relevant-opportunity";

export type EvidenceStatus = "official-text" | "discovery-only" | "evidence-unavailable";

export type OpportunityCycleStatus =
  | "confirmed-this-cycle"
  | "seen-this-cycle"
  | "unconfirmed-this-cycle"
  | "resolved";

export type LeadOwner = "Glen" | "Owen" | "unassigned";

export type LeadQuality = "excellent" | "good" | "medium" | "poor" | "closed-background";

export type LeadDisposition = "active" | "nurture" | "monitor" | "background";

export type LeadFreshness =
  | "published-today"
  | "published-1-3-days"
  | "published-4-7-days"
  | "published-8-30-days"
  | "published-over-30-days"
  | "newly-detected-date-unknown"
  | "date-unknown";

export type ResidentialScale =
  | "lrd-100-plus"
  | "attached-4-plus"
  | "multi-unit-unconfirmed-attachment"
  | "small-residential"
  | "not-residential";

export type LeadParty = {
  name: string;
  role: "applicant" | "agent" | "architect" | "developer" | "contractor" | "consultant" | "other";
  email?: string;
  organisation?: string;
};

export type RelationshipRoutingEvidence = {
  party: string;
  matchedEntity: string;
  matchType: "exact-name" | "exact-email" | "exact-domain";
  evidenceRefs: string[];
};

export type PlanningDocumentEvidence = {
  id: string;
  documentType: string;
  description?: string;
  receivedAt?: string;
  sourceUrl: string;
  fetchStatus: "fetched" | "unavailable" | "unsupported";
  matchedTerms: string[];
  excerpt?: string;
  classification?: PlanningClassification;
  error?: string;
};

export type TenderOpportunity = {
  id: string;
  type: OpportunityType;
  sourceSystem: "TED" | "eTenders" | "National Planning Register" | "DCC" | "PlanningLeads";
  sourceRecordId: string;
  title: string;
  description: string;
  sourceUrl: string;
  evidenceStatus: EvidenceStatus;
  evidenceExcerpt?: string;
  evidenceDocuments?: PlanningDocumentEvidence[];
  evidenceUnavailableReason?: string;
  classification?: PlanningClassification;
  buyer?: string;
  planningAuthority?: string;
  projectReference?: string;
  applicant?: string;
  parties?: LeadParty[];
  location?: string;
  publishedAt?: string;
  deadline?: string;
  responseDeadline?: string;
  cpvCodes: string[];
  matchedTerms: string[];
  fitScore: number;
  leadQuality?: LeadQuality;
  leadDisposition?: LeadDisposition;
  qualificationReason?: string;
  leadFreshness?: LeadFreshness;
  sourceAgeDays?: number;
  freshnessReason?: string;
  residentialUnitCount?: number;
  residentialScale?: ResidentialScale;
  sourceStatus?: string;
  scopeStatus?: "eligible" | "excluded" | "unknown";
  scopeExclusionReason?: string;
  cycleStatus?: OpportunityCycleStatus;
  firstSeenAt?: string;
  lastSeenAt?: string;
  lastConfirmedAt?: string;
  missingSince?: string;
  carryForwardReason?: string;
  resolvedAt?: string;
  resolutionReason?: string;
  routedTo?: LeadOwner;
  routingStatus?: "routed" | "needs-triage" | "not-qualified" | "relationship-index-unavailable";
  routingEvidence?: RelationshipRoutingEvidence[];
  routingReason?: string;
};

export type OfficialSourceSnapshot = {
  generatedAt: string;
  sources: Array<{
    name: TenderOpportunity["sourceSystem"];
    status: "ok" | "failed" | "not-configured";
    records: number;
    scannedRecords?: number;
    pagesFetched?: number;
    sourceDocumentsFetched?: number;
    officialEvidenceRecords?: number;
    evidenceUnavailableRecords?: number;
    discoveryOnlyRecords?: number;
    routedToGlen?: number;
    routedToOwen?: number;
    needsTriage?: number;
    error?: string;
  }>;
  opportunities: TenderOpportunity[];
};
