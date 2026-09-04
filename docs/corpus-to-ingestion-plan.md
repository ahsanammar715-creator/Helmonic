# Helmonic controlled-corpus ingestion plan

Status: decision-ready local plan; no Azure ingestion authorized

Snapshot basis: completed all-page corpus audit generated 2 September 2026

Deadline basis: 1 October 2026 production target

## Executive Summary

- **Every approved original is now a capture-and-catalogue target.** The audited
  collection contains 29,703 files/286.9 GB. All are represented in the private intake
  manifest and will be preserved in Blob and catalogued before format-specific
  processing. This does not mean feeding opaque measurement, audio, model, drawing, or
  database bytes directly to the language model.
- **The first answer-ready lane remains much smaller.** The PDF/Word scope is 2,633
  documents totaling 6.79 GB (2.37% of all bytes). Raw and specialist formats remain
  captured and discoverable, then gain dedicated interpreters only when their output can
  be validated and cited.
- **A large useful corpus can proceed without OCR.** After integrity checks, exact
  deduplication, and holding back unresolved IA-21/Cadna classifications, 2,064 unique
  documents (1,779 readable PDFs and 285 renderable Word files, approximately 5.53 GB)
  are technically eligible. Human owners still need to choose the highest-value order.
- **Do not equate capture with answer readiness.** The limiting factor is not storage;
  it is reliable conversion, version selection, permissions, and scaled acoustic
  evaluation. Capture/catalogue can cover the approved collection while Search exposure
  advances only through tested batches.
- **Build one permanent asynchronous ingestion path.** Approved manifests should flow
  through Service Bus to a least-privilege worker, quarantine/validation, page-preserving
  extraction or Word-to-PDF rendering, chunking, embeddings, a versioned Search index,
  and proportional evaluation before promotion.

## The audit is reliable enough to plan from

The inventory row count, byte total, PDF/Word counts, and folder aggregates all reconcile
to the summary. Relative paths are unique, file sizes are non-negative, every non-broken
PDF has a page count, all PDF pages were requested, and no filesystem scan errors were
reported. The audit recorded that its source-write guard remained clean.

This is a 2 September snapshot, not a permanent freeze. The incremental audit must be
rerun immediately before any approved batch is materialized so new, deleted, or changed
files cannot bypass review.

| Planning population | Documents | Meaning |
| --- | ---: | --- |
| Audited files of every format | 29,703 | Capture-and-catalogue target; specialist formats are not embedded blindly |
| PDF and Word files | 2,633 | Only formats in the October RAG scope |
| Technically ready before exact dedupe | 2,361 | 2,055 readable PDFs plus 306 modern Word files awaiting render |
| Technically ready after exact dedupe | 2,217 | One logical copy per known byte-identical group |
| Eligible after all IA-21/Cadna holds | 2,064 | 1,779 PDFs plus 285 Word files; still needs human priority/version approval |
| Strong OCR candidates | 197 | Hold for spot check and a separate OCR decision |
| Partial OCR candidates | 50 | Hold for page-level review; do not OCR whole files blindly |
| Broken/unreadable | 21 | Quarantine and report; never force through |
| Extraction warnings | 2 | Review failed pages before selection |
| Legacy Word files | 2 | Manual conversion/review; skip if fidelity is uncertain |

Exact duplicates comprise 134 groups and 147 surplus copies. The filename-normalization
check produced 332 variant groups; 74 are already explained entirely by exact duplicates,
leaving 258 groups that may represent revisions or genuinely different documents. They
must not be silently collapsed or simultaneously promoted without a version rule.
Three duplicate identities cross an otherwise eligible folder and an unresolved IA-21/
Cadna category; the conservative count above holds all three until classification is
settled rather than allowing the duplicate location to bypass the hold.

IA-02.2 contains 86.6% of PDF/Word documents. That concentration makes a folder-by-folder
load a poor proxy for business value and reinforces the need for a consultant-approved
priority manifest.

## The full-corpus manifest accounts for everything approved

`scripts/corpus_audit/build_full_ingestion_manifest.py` converts the authoritative audit
into a private JSONL intake manifest without reopening or modifying the company share.
It reconciles exactly to 29,703 files and 286,924,478,651 bytes. Every row is marked for
original capture, receives an opaque source/blob identifier, and is assigned to one of
the following processing families:

- directly readable PDF or renderable Word candidates;
- PDF/Word OCR, conversion, review, or repair;
- text/table classification, including large measurement exports that must not be
  mistaken for ordinary prose;
- acoustic measurement, media, image, design/model, archive, email-future, and other
  specialist catalogues.

All 3,512 approved WAV originals are included in capture. They remain linked to their
project/report/measurement context and may be surfaced as supporting evidence through
timestamped `[AU#]` citations and controlled playback. They are not blindly transcribed,
and an ordinary WAV cannot establish authoritative acoustic levels without its calibrated
measurement record.

The manifest records 147 duplicate copies but preserves their originals and links them
to a canonical identity. Three duplicate families crossing an ordinary folder and an
unresolved IA-21/Cadna classification are held in full. The resulting first searchable
canonical population is the same conservative 2,064-document set derived independently
by the planning analysis.

The manifest deliberately leaves every `permission_scope` unset. Before a row can enter
Search, the owner must assign its permission scope. This allows full original capture
without silently making every file visible to every Helmonic user.

## A staged route protects answer quality

### Stage 0 — approve the manifest and rules

Before any Azure write, obtain and record:

1. A ranked list of projects/document classes from the acoustic owners.
2. Canonical-copy and revision rules for exact duplicates and the 258 unresolved variant
   groups; preserve all originals but index only the approved version(s).
3. Classification of IA-21 and `iAcoustic_Cadna_OR`.
4. Security scope for every selected document.
5. Malware-scanning policy, controlled-source promotion authority, and retention rules.
6. The consultant evaluation set already requested from Jim, Eoghan, and Glenn.

The reconciled full-corpus manifest—not a recursive scan of the share—is the intake
input. An owner-approved, permission-scoped subset of that manifest is the searchable
ingestion input.
Every entry needs source identity, expected hash, approved title, business area/project,
permission scope, version status, and selected/held reason.

### Stage 1 — build the permanent worker and prove 100 PDFs

Implement the already-designed asynchronous path using existing DEV services:

```text
approved manifest -> Blob quarantine -> Service Bus -> ingestion worker
  -> validate/malware gate -> page/table extraction -> chunk -> embed
  -> versioned Search candidate -> evaluation -> controlled-source promotion
```

The worker must use a standing, explicitly approved user-assigned identity with only:

- Service Bus Data Receiver on the ingestion queue;
- Blob read/write on the ingestion/control containers;
- Azure AI model-user permission on the embedding account;
- Search Index Data Contributor on the selected index; and
- minimum PostgreSQL runtime rights for job/document/version/audit state.

Index creation and schema administration remain a separate deployment identity/operation.
The worker must be idempotent by source hash/version, record retries, isolate poison jobs,
and avoid deleting or replacing the live `consult-demo-v2` index.

Start with 100 consultant-selected, directly readable PDFs containing a deliberate mix of
narrative, numeric tables, standards, and project reports. Validate extraction, citations,
permissions, retry/dead-letter behavior, and rollback before increasing batch size.

### Stage 2 — scale readable PDFs in controlled batches

After the 100-document pilot passes, ingest the remaining approved readable PDFs in
250–400 document batches. Each batch creates or updates a candidate index/version and
stays invisible to live retrieval until its manifest and evaluation pass. Do not wait
until the final batch to report failures or relevance drift.

### Stage 3 — add Word through PDF rendering

The 285 unique eligible Word documents are a separate lane. Render each `.docx` to PDF in
the worker, then use the same page/table extraction path as native PDFs. Validate that the
render opens, has non-empty pages, preserves key tables/headings, and produces stable page
locators. Flag and skip a document if fidelity cannot be demonstrated. The two legacy
`.doc` files require explicit manual review/conversion.

### Stage 4 — defer broad OCR; use it only for priority gaps

The 197 strong plus 50 partial candidates are 9.4% of the PDF/Word set. This is material
but not a majority, and the audit warns that drawings or blank pages can be false
positives. Do not put Azure OCR on the critical path yet. Spot-check the candidates, then
cost a targeted OCR batch only if high-priority evidence is otherwise unavailable.

### Stage 5 — production promotion remains a separate gate

DEV must pass the same zero-traffic and staged-cutover discipline already proven for
hybrid v2. Production requires the D-017 hardening decisions: ACR private-path proof,
Service Bus networking choice, PostgreSQL HA, Search replicas/partitions, malware policy,
retention, promotion authority, load testing, rollback, and monitoring. No production
resource work is authorized by this plan.

## Every batch needs evidence, not merely an item count

For each candidate batch, retain exact source/hash/chunk/vector parity and run a scaled
evaluation containing:

- acoustic-expert known-answer questions with document/page expectations;
- paraphrases that do not repeat document wording;
- numeric and table lookups with expected values/units;
- deliberately out-of-scope questions that must return no evidence;
- unauthorized-scope checks that must return zero sources;
- duplicate/revision conflict checks; and
- generated-answer checks proving all document claims resolve to server-authoritative
  page citations.

The 16-document/eight-case suite remains a regression baseline, not sufficient coverage
for thousands of documents. The first 100-document pilot should use the consultants'
15–20 questions plus explicit permission and no-evidence cases. Later batches must add
questions for newly introduced document families and failure modes.

Promotion stops on any missing vector, manifest mismatch, wrong-project retrieval,
incorrect number/unit, uncited document claim, permission leak, or false positive above
the relevance threshold.

## October 1 delivery path and scheduling risk

| Window | Target outcome | Stop condition |
| --- | --- | --- |
| 4–9 September | Human priority/rules; permanent worker in DEV; 100-PDF pilot | No manifest/permission owner or worker safety failure |
| 10–16 September | Scale approved PDFs; begin Word rendering; expand evaluation | Relevance/citation drift or render-fidelity failures |
| 17–23 September | Complete prioritized majority; targeted OCR decision; load profile | Quality backlog exceeds available review capacity |
| 24–27 September | Production hardening decisions and implementation; full regression | Any unresolved security/capacity gate |
| 28–30 September | Change freeze; zero-traffic production validation; staged cutover | Any failed health/readiness/security/evaluation check |
| 1 October | Launch observation and rollback readiness | Error, latency, citation, or permission regression |

With one engineer, a well-tested prioritized majority is realistic; guaranteed full-corpus
coverage plus OCR, Word fidelity remediation, production hardening, and report generation
is not safe to promise simultaneously. Report generation remains unimplemented until the
owner selects its minimal scope, as required by the production-deadline brief.

## Decisions needed next

1. Jim, Eoghan, and Glenn: confirm the first 100-PDF validation wave and the 15–20
   evaluation answers/citations. The final target remains the complete approved corpus.
2. Owner: approve the permanent worker identity/roles and choose the malware approach
   after receiving the cost estimate.
3. Acoustic owner: classify IA-21 and the Cadna folder, and choose the canonical revision
   rule.
4. Owner: decide whether OCR remains a post-launch backlog or is authorized for a small
   high-value candidate batch.
5. Owner: choose the Service Bus, PostgreSQL HA, and Search capacity posture after the
   separate capacity/cost assessment.

## Caveats and source record

This plan is based on `local-artifacts/corpus-audit/summary.json`, `inventory.csv`,
`folder-summary.csv`, `exact-duplicates.csv`, `possible-variants.csv`, and
`scan-errors.csv`, produced by the committed D-023 audit. Derived calculations are
reproducible with `scripts/corpus_audit/build_ingestion_plan_analysis.py` and are written
only to ignored local artifacts. No confidential filename list is reproduced here.

The more specific owner file `helmoniccorpustoingestionplanprompt.md` is not currently
available inside the local repository and cannot be read from `S:\Downloads` by the
isolated agent. This plan therefore implements the accessible October production brief,
D-023, and the completed audit evidence. Reconcile any additional requirement from that
prompt before paid Azure execution begins.
