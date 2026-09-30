# Tender Intelligence unattended worker

- The daily worker runs source discovery, authoritative-document evidence retrieval, qualification, deduplication, owner routing, exports and the Odoo synchronization stage in sequence.
- The worker is packaged separately from the public application. It does not receive application traffic and does not change the production web revision.
- `HELMONIC_TENDER_ARTIFACT_ROOT` must point to private durable storage. The durable ledger, checkpoints and audit history must survive container restarts.
- Only one worker may run at a time. A lock prevents overlapping schedules; a lock older than 18 hours is treated as a crashed run and is safely replaced.
- BuildingInfo and Odoo are disabled by default. Missing credentials never silently enable either connector.
- Odoo uses the current JSON-2 API and requires Odoo 19 or newer. The connector checks the server version and verifies every required field before the first write.
- Odoo upserts on `x_helmonic_external_id`. The Odoo team must make this field unique so concurrent or retried jobs cannot create duplicate opportunities.
- A repeated source record updates the existing Odoo opportunity. Exact cross-source duplicates share the same external ID and therefore cannot create a second opportunity.
- Similar-address applications with different planning references remain related-but-separate because they may represent phases, amendments or separate permissions.
- The relationship index location is supplied separately with `HELMONIC_RELATIONSHIP_INDEX_DIR`; it must remain restricted to the approved leadership access boundary.
- Failure of any source or output step makes the worker exit unsuccessfully and preserves its summary under `automation-runs/<run-id>/summary.json`.
- The production job should be scheduled daily with retry disabled until the source calls are proven idempotent, one replica, parallelism one and replica retry/timeout values set explicitly.
- No prospect email is sent by this worker. Outreach remains a separate approved action.

## Remaining deployment gates

- Odoo test URL, database name, dedicated integration-user API key and confirmed custom technical field names.
- Confirmation that the Odoo database is version 19 or newer, or an agreed legacy connector for an older version.
- BuildingInfo production API credentials, entitlement, rate limits and allowed storage/contact use.
- A private durable volume for the ledger/checkpoints and a restricted location for the email relationship index.
- Build the dedicated image, create the scheduled job disabled or manually triggered, run a test-database validation, then request separate approval to enable the daily schedule and Odoo writes.
