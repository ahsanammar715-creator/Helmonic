# Tender Intelligence deduplication policy

- Every source record is retained. Deduplication groups records; it does not erase source evidence.
- The same source and source record ID is one source record. The richer official-evidence version wins during an exact within-source collision.
- Planning records from different sources are automatically grouped only when both the normalized planning authority and project/application reference match exactly.
- TED and eTenders notices are not merged merely because their titles look similar. They require their own exact source identity until an explicit cross-publication identifier is available.
- The best-supported member becomes the canonical record: official text first, then evidence-unavailable official-source records, then discovery-only records. Official DCC or national-register data outranks PlanningLeads discovery metadata.
- Every strict group receives one stable `crm_external_id`. Odoo must upsert on this value so a repeated scan updates one opportunity instead of creating another.
- Duplicate source members remain in the retained inventory with their URL, evidence status and canonical link. They are not routed as separate sales opportunities.
- Same address plus same authority but a different application reference is only a possible duplicate. Both records remain separate and are flagged for review; title or address similarity alone never triggers an automatic merge.
- Different authorities, different formal-tender systems, or fuzzy title/company similarities are never automatically merged.
- A canonical record can change when stronger official evidence arrives, but its group-level CRM external ID stays stable.
- Closed and older opportunities remain retained. Neither age nor duplicate status deletes historical evidence.
