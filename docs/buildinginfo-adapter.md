# BuildingInfo adapter status and safeguards

- The connector is implemented but disabled by default.
- No credentials from the vendor's sample document are embedded in source control or generated artifacts.
- Credentials must be supplied through `BUILDINGINFO_API_KEY` and `BUILDINGINFO_USER_KEY` in the deployment environment.
- The adapter uses BuildingInfo's incremental `api_date` window and paginates in bounded batches of no more than 1,000 records.
- `planning_public_updated` is retained separately as the major project-stage update date.
- Project value, unit count, stage, planning reference, council, address, companies, named contacts, roles and contact details are mapped into the local enrichment model.
- BuildingInfo remains discovery and enrichment evidence. It cannot independently confirm a noise RFI, acoustic condition or refusal ground; the linked authoritative council document must still pass the evidence gate.
- Exact council and planning-reference matches share the same deduplicated CRM identity as national-register, DCC or PlanningLeads records. BuildingInfo enrichment never creates a second Odoo opportunity for the same proven application.
- Agriculture is excluded from the target feed. Self-build houses and residential extensions are retained as low-priority background rather than promoted.
- A live connection must not be enabled until BuildingInfo confirms API entitlement, allowed storage and contact usage, rate limits, error/retry expectations and whether a customised saved-search endpoint will be supplied.
- The API keys printed in the supplied example should be treated as sample credentials. If they are real, BuildingInfo should rotate them and issue environment-specific credentials before live use.
