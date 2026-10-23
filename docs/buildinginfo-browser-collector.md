# BuildingInfo authenticated collector

## Purpose

This collector is an optional input to the existing 7:00 a.m. Tender Intelligence job. It does not replace the established qualification, evidence, deduplication, email-relationship, RAG-history or Odoo synchronization stages.

The collector signs in to an approved BuildingInfo subscription, runs bounded acoustic searches, reads only a limited number of project pages and writes the results into the existing BuildingInfo CSV intake contract.

## Activation boundary

Keep `HELMONIC_BUILDINGINFO_BROWSER_ENABLED=false` until Building Information Ireland has confirmed in writing that authenticated automation and CRM ingestion are permitted for this subscription. Record the approval, contract or support-ticket reference in `BUILDINGINFO_BROWSER_CONSENT_REFERENCE`.

The worker fails closed when the approval reference or credentials are absent. It also stops on CAPTCHA, human-verification, access-denied, rate-limit or unexpectedly broad result pages. It does not bypass access controls.

Prefer an approved BuildingInfo API or scheduled CSV delivery when available. If browser collection is approved, prefer a dedicated integration account rather than a named person's account.

## Secure configuration

Store these values as Azure Container Apps secrets backed by Key Vault; never place them in source control, logs or chat:

- `BUILDINGINFO_BROWSER_USERNAME`
- `BUILDINGINFO_BROWSER_PASSWORD`

Set these non-secret controls on the Azure development job first:

- `HELMONIC_BUILDINGINFO_BROWSER_ENABLED=true`
- `BUILDINGINFO_BROWSER_CONSENT_REFERENCE=<approval or contract reference>`
- `BUILDINGINFO_BROWSER_BASE_URL=https://app.buildinginfo.com/`
- `BUILDINGINFO_BROWSER_SEARCH_URL=https://app.buildinginfo.com/page.u.newsearch`
- `BUILDINGINFO_BROWSER_KEYWORDS=noise,acoustic,vibration,sound insulation,noise impact assessment`
- `BUILDINGINFO_BROWSER_STAGES=Plans Applied,Plans Granted,Pre-commencement,Commencement`
- `BUILDINGINFO_BROWSER_MAX_PROJECTS=150`
- `BUILDINGINFO_BROWSER_MAX_RESULTS_PER_SEARCH=2000`
- `BUILDINGINFO_BROWSER_MAX_LOAD_MORE_CLICKS=4`
- `BUILDINGINFO_BROWSER_REQUEST_DELAY_MS=1400`
- `BUILDINGINFO_BROWSER_INCLUDE_POTENTIAL=true`

## Daily flow

1. Azure starts the existing scheduled job at 7:00 a.m. Dublin time.
2. The collector starts a clean Chromium session and signs in.
3. It runs the configured acoustic searches across the BuildingInfo project stages. BuildingInfo is not treated as the source of RFI status or RFI dates unless those details are explicitly present in its project evidence.
4. It refuses overly broad result sets and reads projects sequentially with a delay.
5. It keeps evidence-backed BuildingInfo acoustic projects and classifies them as acoustic grants or potential acoustic fits. RFI status and dates normally come from DCC, council or national planning evidence; cross-source deduplication joins those official RFI facts to the matching BuildingInfo project. Fulfilled and past-due RFIs are rejected from the active queue.
6. It captures the exact BuildingInfo project URL, evidence-document URL where available, RFI dates, planning dates, project value and project-team contact details.
7. It atomically writes `buildinginfo-browser-latest.csv` into the BuildingInfo intake directory.
8. The established pipeline validates evidence, merges duplicates across all sources, enriches email/RAG relationships, and synchronizes the reviewed lead structure into the Odoo test database. A deduplicated BuildingInfo project that also has an official confirmed acoustic RFI is top priority; all live RFIs are then ordered by response due date. BuildingInfo acoustic grants are the next primary category and other potential fits remain secondary.

The collector creates a credential-free audit at `buildinginfo-browser-audit/latest.json` with search counts, accepted/rejected counts and access failures.

## Release check

Run the first approved execution only against the Azure development job and Odoo test database. Confirm the BuildingInfo account remains accessible, the audit is bounded, exact project links work, current RFIs have received/due dates, acoustic grants are classified correctly, duplicates merge, and no production outreach is enabled before considering production activation.
