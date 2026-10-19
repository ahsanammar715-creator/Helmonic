export type OdooTenderFieldType =
  | "boolean"
  | "char"
  | "datetime"
  | "float"
  | "integer"
  | "selection"
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
  { name: "x_pipeline_priority_rank", label: "Pipeline Priority Rank", type: "integer", indexed: true },
  { name: "x_pipeline_priority_reason", label: "Pipeline Priority Reason", type: "char" },
  { name: "x_lead_panel", label: "Lead Review Panel", type: "char" },
  { name: "x_lead_quality", label: "Lead Quality", type: "char" },
  { name: "x_evidence_status", label: "Evidence Status", type: "char" },
  { name: "x_classification", label: "Opportunity Classification", type: "char" },
  { name: "x_source_systems", label: "Source Systems", type: "text" },
  { name: "x_source_record_ids", label: "Source Record IDs", type: "text" },
  { name: "x_source_ledger", label: "Source and Deduplication Ledger", type: "text" },
  { name: "x_project_link", label: "Project Link", type: "char" },
  { name: "x_source_urls", label: "Source URLs", type: "text" },
  { name: "x_evidence_excerpt", label: "Evidence Excerpt", type: "text" },
  { name: "x_source_published_at", label: "Source Published At", type: "datetime" },
  { name: "x_source_updated_at", label: "Source Updated At", type: "datetime" },
  { name: "x_source_major_updated_at", label: "Source Major Update At", type: "datetime" },
  { name: "x_source_age_days", label: "Source Age Days", type: "integer" },
  { name: "x_freshness_band", label: "Freshness Band", type: "char" },
  { name: "x_deadline", label: "Action Deadline", type: "datetime" },
  { name: "x_rfi_published_at", label: "RFI Published Date", type: "datetime" },
  { name: "x_rfi_received_at", label: "RFI Received / Detected Date", type: "datetime" },
  { name: "x_rfi_response_due_at", label: "RFI Response Due Date", type: "datetime" },
  { name: "x_rfi_response_received_at", label: "Further Information Response Received", type: "datetime" },
  { name: "x_rfi_date_source", label: "RFI Date Source", type: "text" },
  { name: "x_rfi_date_confidence", label: "RFI Date Confidence", type: "char" },
  { name: "x_planning_received_at", label: "Planning Application Received", type: "datetime" },
  { name: "x_planning_validated_at", label: "Planning Application Validated", type: "datetime" },
  { name: "x_decision_due_at", label: "Planning Decision Due At", type: "datetime" },
  { name: "x_action_days_remaining", label: "Action Days Remaining", type: "integer" },
  { name: "x_deadline_urgency", label: "Deadline Urgency", type: "char" },
  { name: "x_rfi_trigger", label: "RFI / Acoustic Trigger", type: "char" },
  { name: "x_assigned_person", label: "Assigned Acoustic Consultant", type: "char" },
  { name: "x_warm_connection_verified", label: "Warm Connection Verified", type: "boolean" },
  { name: "x_routing_reason", label: "Routing Reason", type: "text" },
  { name: "x_relationship_summary", label: "Relationship Summary", type: "text" },
  { name: "x_relationship_evidence", label: "Relationship Evidence (Restricted)", type: "text" },
  { name: "x_project_history_summary", label: "Previous iAcoustics Project Summary", type: "text" },
  { name: "x_project_history_evidence", label: "Previous Project Evidence (Restricted)", type: "text" },
  { name: "x_deduplication_status", label: "Deduplication Status", type: "char" },
  { name: "x_possible_duplicate_ids", label: "Possible Duplicate IDs", type: "text" },
  { name: "x_project_value", label: "Project Value", type: "float" },
  { name: "x_project_units", label: "Project Units", type: "integer" },
  { name: "x_project_stage", label: "Project Stage", type: "char" },
  { name: "x_opportunity_type", label: "Opportunity Type", type: "char" },
  { name: "x_location", label: "Project Location", type: "char" },
  { name: "x_county", label: "County", type: "char" },
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
  { name: "x_acoustic_appointment_status", label: "Acoustic Appointment Status", type: "char" },
  { name: "x_appointed_acoustician", label: "Appointed Acoustician", type: "char" },
  { name: "x_appointment_evidence", label: "Appointment Evidence", type: "text" },
  { name: "x_appointment_evidence_source_url", label: "Appointment Evidence Source", type: "text" },
  { name: "x_competitive_quote_opportunity", label: "Competitive Quote Opportunity", type: "boolean" },
  { name: "x_outreach_eligibility", label: "Outreach Eligibility", type: "char" },
  { name: "x_outreach_suppression_reason", label: "Outreach Safeguard Reason", type: "text" },
  { name: "x_outreach_key", label: "Outreach Deduplication Key", type: "char", indexed: true },
  { name: "x_buildinginfo_search_profile", label: "BuildingInfo Search Profile", type: "char" },
  { name: "x_source_reference", label: "Source Reference", type: "char" },
  { name: "x_studio_project_sector", label: "Project Sector", type: "selection" },
];

export const ODOO_TENDER_FIELD_TYPES = Object.fromEntries(
  ODOO_TENDER_FIELD_CONTRACT.map((field) => [field.name, field.type]),
) as Record<string, OdooTenderFieldType>;
