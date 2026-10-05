export type OdooTenderFieldType =
  | "boolean"
  | "char"
  | "datetime"
  | "float"
  | "integer"
  | "text";

export type OdooTenderFieldContract = {
  name: string;
  label: string;
  type: OdooTenderFieldType;
  indexed?: boolean;
};

export const ODOO_TENDER_FIELD_CONTRACT: OdooTenderFieldContract[] = [
  { name: "x_helmonic_external_id", label: "Helmonic External ID", type: "char", indexed: true },
  { name: "x_pipeline_bucket", label: "Pipeline Bucket", type: "char" },
  { name: "x_lead_quality", label: "Lead Quality", type: "char" },
  { name: "x_evidence_status", label: "Evidence Status", type: "char" },
  { name: "x_classification", label: "Opportunity Classification", type: "char" },
  { name: "x_source_systems", label: "Source Systems", type: "text" },
  { name: "x_source_record_ids", label: "Source Record IDs", type: "text" },
  { name: "x_source_urls", label: "Source URLs", type: "text" },
  { name: "x_evidence_excerpt", label: "Evidence Excerpt", type: "text" },
  { name: "x_source_published_at", label: "Source Published At", type: "datetime" },
  { name: "x_source_updated_at", label: "Source Updated At", type: "datetime" },
  { name: "x_source_major_updated_at", label: "Source Major Update At", type: "datetime" },
  { name: "x_source_age_days", label: "Source Age Days", type: "integer" },
  { name: "x_freshness_band", label: "Freshness Band", type: "char" },
  { name: "x_deadline", label: "Action Deadline", type: "datetime" },
  { name: "x_assigned_person", label: "Tender Intelligence Owner", type: "char" },
  { name: "x_warm_connection_verified", label: "Warm Connection Verified", type: "boolean" },
  { name: "x_routing_reason", label: "Routing Reason", type: "text" },
  { name: "x_deduplication_status", label: "Deduplication Status", type: "char" },
  { name: "x_possible_duplicate_ids", label: "Possible Duplicate IDs", type: "text" },
  { name: "x_project_value", label: "Project Value", type: "float" },
  { name: "x_project_units", label: "Project Units", type: "integer" },
  { name: "x_project_stage", label: "Project Stage", type: "char" },
  { name: "x_opportunity_type", label: "Opportunity Type", type: "char" },
  { name: "x_location", label: "Project Location", type: "char" },
  { name: "x_planning_authority", label: "Planning Authority", type: "char" },
  { name: "x_project_reference", label: "Project Reference", type: "char" },
  { name: "x_applicant", label: "Applicant", type: "char" },
  { name: "x_party_details", label: "Project Parties", type: "text" },
  { name: "x_cpv_codes", label: "CPV Codes", type: "char" },
  { name: "x_matched_terms", label: "Matched Acoustic Terms", type: "text" },
  { name: "x_evidence_document_urls", label: "Evidence Document URLs", type: "text" },
  { name: "x_residential_scale", label: "Residential Scale", type: "char" },
  { name: "x_first_seen_at", label: "First Seen At", type: "datetime" },
  { name: "x_last_seen_at", label: "Last Seen At", type: "datetime" },
  { name: "x_last_confirmed_at", label: "Last Confirmed At", type: "datetime" },
  { name: "x_cycle_status", label: "Cycle Status", type: "char" },
  { name: "x_scope_status", label: "Scope Status", type: "char" },
];

export const ODOO_TENDER_FIELD_TYPES = Object.fromEntries(
  ODOO_TENDER_FIELD_CONTRACT.map((field) => [field.name, field.type]),
) as Record<string, OdooTenderFieldType>;
