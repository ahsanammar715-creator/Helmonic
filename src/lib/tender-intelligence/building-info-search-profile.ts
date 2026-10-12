export const BUILDINGINFO_NATIVE_SEARCH_PROFILE = {
  name: "iAcoustics acoustic opportunity watch",
  operatingBoundary: "Saved searches, alerts and user-authorised CSV/XLSX exports only; no automated website scraping.",
  geography: {
    includedCounties: [
      "Carlow", "Dublin", "Kildare", "Kilkenny", "Laois", "Longford", "Louth",
      "Meath", "Offaly", "Westmeath", "Wexford", "Wicklow",
    ],
    excludedRegion: "Northern Ireland",
  },
  stages: [
    "Pre-planning",
    "Plans Applied",
    "Further Information Request",
    "Plans Granted",
    "Pre-commencement",
    "Commencement",
  ],
  acousticTriggers: [
    "acoustic consultant", "acoustician", "acoustic report", "acoustic design statement",
    "noise impact assessment", "noise assessment", "noise report", "noise survey",
    "environmental noise", "building acoustics", "sound insulation", "Part E",
    "noise monitoring", "vibration assessment", "room acoustics", "plant noise",
    "construction noise", "operational noise", "noise-sensitive receptor",
  ],
  appointmentSignals: [
    "appointed acoustic consultant", "appointed acoustician", "acoustic consultant:",
    "iAcoustics", "Integrated Acoustic Solutions",
  ],
  prioritySectors: [
    "Residential (attached 4+ units)", "Large Residential Development (100+ units)",
    "Hotel and hospitality", "Healthcare", "Education", "Industrial", "Commercial",
    "Entertainment and live events", "Transport and infrastructure",
  ],
  requiredExportFields: [
    "building_info_project_id", "project_title", "county", "project_url", "trigger_type",
    "evidence_document", "evidence_excerpt",
  ],
  preferredExportFields: [
    "planning_reference", "planning_authority", "project_stage", "project_value", "unit_count",
    "site_address", "application_date", "last_updated", "rfi_date", "rfi_deadline",
    "applicant", "applicant_contact", "applicant_email", "applicant_phone",
    "architect", "architect_contact", "architect_email", "architect_phone",
    "developer", "developer_contact", "developer_email", "developer_phone",
    "planning_consultant", "planning_consultant_contact", "planning_consultant_email",
    "planning_consultant_phone", "contractor", "contractor_contact", "contractor_email",
    "contractor_phone", "appointed_acoustician", "appointment_evidence",
    "appointment_evidence_url", "appointment_evidence_date", "source_search_name",
  ],
} as const;
