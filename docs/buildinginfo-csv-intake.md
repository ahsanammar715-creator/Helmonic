# BuildingInfo emailed-CSV intake contract

The intake is designed for BuildingInfo's scheduled RFI/acoustic export. BuildingInfo performs the document search; this worker validates, qualifies, deduplicates and routes the supplied results.

## Required columns

- `building_info_project_id`: permanent BuildingInfo project identity; never a row number.
- `project_title`
- `county`
- `project_url`
- `trigger_type`: for example `Further Information Request` or `Granted acoustic condition`.
- `evidence_document`: source planning-document name.
- `evidence_excerpt`: the full matched passage, not a shortened display snippet.

The tracked template at `docs/buildinginfo-intake-template.csv` also includes the preferred planning, deadline, architect, developer, planning-consultant and contractor fields.

The preferred export now also carries `appointed_acoustician`, `appointment_evidence`, `appointment_evidence_url`, `appointment_evidence_date` and `source_search_name`. These support the explicit `iAcoustics Appointed / Already Won`, `Competitor Appointed / Competitive Opportunity` and `Appointment Needs Verification` safeguards. A name alone never proves a current appointment.

## Safety and deduplication

- Every file is UTF-8 CSV with one header row and one project/evidence match per row.
- Missing required columns, malformed row widths, invalid links, blank required values or oversized files fail the whole BuildingInfo intake. No partial import is written.
- Repeated rows from successive weekly emails collapse by `building_info_project_id`.
- Distinct evidence documents for the same project are retained under that one opportunity.
- The project later participates in the existing strict planning-reference/council deduplication across all sources before Odoo payload generation.
- The same canonical project receives one stable outreach-deduplication key across BuildingInfo, council, PlanningLeads and tender-source refreshes. The worker still sends no email; the downstream outreach process must honour that key.
- A BuildingInfo row is treated as confirmed official text only when its retained excerpt contains an approved acoustic/noise term. Other rows remain discovery-only rather than being overstated.

## Native BuildingInfo search boundary

The approved native-search profile is defined in `src/lib/tender-intelligence/building-info-search-profile.ts`. It is intended for BuildingInfo saved searches, alerts and user-authorised CSV/XLSX exports. It does not scrape the BuildingInfo website and does not bypass the subscription. Weekly BuildingInfo email/export intake and native saved-search exports can both enter the same validation and deduplication flow.

## Automated handoff

1. Power Automate accepts mail only from the agreed BuildingInfo sender and expected subject pattern.
2. The flow accepts `.csv` only, applies the 5 MiB limit and writes to the private Azure Blob prefix `input/buildinginfo/`.
3. The Azure worker's managed identity downloads the inbox at the start of its daily run.
4. The worker validates and imports the CSV, then runs the existing qualification, carry-forward, deduplication and owner-routing logic.
5. Odoo remains a separate feature flag and must stay disabled until the normalized dry run passes against the test database.

The live Power Automate connections and recurring enablement are not created by this code change.
