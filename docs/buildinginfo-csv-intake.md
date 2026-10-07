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

## Safety and deduplication

- Every file is UTF-8 CSV with one header row and one project/evidence match per row.
- Missing required columns, malformed row widths, invalid links, blank required values or oversized files fail the whole BuildingInfo intake. No partial import is written.
- Repeated rows from successive weekly emails collapse by `building_info_project_id`.
- Distinct evidence documents for the same project are retained under that one opportunity.
- The project later participates in the existing strict planning-reference/council deduplication across all sources before Odoo payload generation.
- A BuildingInfo row is treated as confirmed official text only when its retained excerpt contains an approved acoustic/noise term. Other rows remain discovery-only rather than being overstated.

## Automated handoff

1. Power Automate accepts mail only from the agreed BuildingInfo sender and expected subject pattern.
2. The flow accepts `.csv` only, applies the 5 MiB limit and writes to the private Azure Blob prefix `input/buildinginfo/`.
3. The Azure worker's managed identity downloads the inbox at the start of its daily run.
4. The worker validates and imports the CSV, then runs the existing qualification, carry-forward, deduplication and owner-routing logic.
5. Odoo remains a separate feature flag and must stay disabled until the normalized dry run passes against the test database.

The live Power Automate connections and recurring enablement are not created by this code change.
