# Candidate ranking and content-completeness diagnostic

Date: 2026-09-09

## Outcome

The populated `consult-candidate-batch-500-v1` index contains the expected
ground-floor drawing. The failed `source-probe-246` check is a probe-wording
problem, not an ingestion gap or a general weakness for floor-plan documents.
The candidate remains isolated and no promotion was performed.

An independent local PDFium pass also found no meaningful content shortfall in
any of the 483 accepted documents.

## Retrieval-ranking evidence

The bounded diagnostic executed once as `job-ranking-diag-001-7fv34d3`. Its
code was pinned to `consult-candidate-batch-500-v1`, used only Search query
requests, and had no embedding or indexing path.

Direct source-ID lookup returned two indexed chunks for
`src-779696c36d01b083fc855b9c`, both titled
`GSA-06-ZZ-L00-DR-RAU-AR-1000 - L00 - Ground Floor Plan.pdf`: one primary-text
chunk and one table chunk, both on page 1.

| Query | Semantic rank | Lexical rank |
| --- | ---: | ---: |
| `legend shower provision location entrance rating` | 8 | 8 |
| Where is the accessible shower provision located on the ground floor plan? | 1 | 10 |
| Show the ground floor drawing with the shower tray and lift entrance. | 1 | 3 |
| What fire rating is shown for the lift entrance on the ground floor plan? | 1 | 6 |

The original hybrid-vector query vector was not persisted. Because this task
forbade new embeddings, the diagnostic did not recreate it; the table reports
semantic and lexical ranks separately. The original probe's top-five failure is
nevertheless reproduced by both modes at rank 8, while every natural phrasing
places the expected source first after semantic reranking.

Ten other floor-plan or general-arrangement drawings were selected from the
same index and queried with natural title-derived requests. All ten appeared in
the top five and all ten ranked first; median rank was 1. This cohort is useful
evidence against a systemic floor-plan retrieval weakness, while its
title-derived nature means it is not a substitute for future business-question
tests.

| Source | Drawing | Semantic rank |
| --- | --- | ---: |
| `src-57204649dcd5325b63aaafe3` | A1104 - OVERALL 4TH FLOOR PLAN | 1 |
| `src-148751054be4b42f1f10d118` | 25040-PL-05.1 Proposed Ground Floor Plan - UNIT 2 | 1 |
| `src-2f194c8a4f61d6e2b5cddf07` | 25040-PL-05.2 Proposed Ground Floor Plan - UNIT 2 - Office & ESB | 1 |
| `src-3248bbda3935be8cfcad9fd0` | 22-036-C-121 Proposed Second Floor Plan - REV A | 1 |
| `src-a1bffe561687ac5c3170c0dd` | 25040-PL-04.2 Proposed Ground Floor Plan - UNIT 1 - Office & ESB | 1 |
| `src-729c400d7f88fd856fa2982e` | 24015 MOLA Proposed Second Floor GA Plan | 1 |
| `src-43353b63a2ccd503882a5dba` | 24015 MOLA Proposed Ground Floor GA Plan | 1 |
| `src-89334d0609cae7e763096473` | 19021 AP1013 Proposed Third Floor Plan GA | 1 |
| `src-55084e0bdd7c3b364eceb44d` | 25040-PL-03.3 Proposed Ground Floor Plan - Detail 2 | 1 |
| `src-54e10f9ac7d4b645ee1285e6` | 201B Sixth Year Centre - Ground Floor Plan | 1 |

Recommendation: accept the 483-document candidate as correctly ingested and
replace the keyword-stuffed probe with one or more natural business questions.
This is a recommendation only; no promotion or candidate cleanup occurred.

## Independent content-completeness evidence

PDFium 5.13.0 independently reopened the exact 483 staged originals. The
comparison used the pipeline's primary plain-text stream only, reconstructed
chunk overlaps once, and deliberately excluded derived atomic table chunks so
table text could not inflate coverage.

| Measure | Independent source | Ingestion primary text |
| --- | ---: | ---: |
| Documents | 483 | 483 |
| Pages | 2,984 | 2,984 declared |
| Words | 937,050 | 1,027,725 |
| Normalized characters | 4,245,467 | 4,285,146 |

Results: 483 passed, 0 meaningful shortfalls, 0 page-count mismatches, 0 source
hash mismatches. The lowest qualifying per-document character coverage was
98.38%. Word counts vary more because PDFium and pdfminer split drawing labels,
codes, and hyphenation differently; the near-parity character counts provide
the stronger completeness signal. There are therefore no failed-document
source-versus-extracted numbers to list.

The full per-document evidence is retained locally in:

- `local-artifacts/corpus-content-completeness-final/completeness-report.csv`
- `local-artifacts/corpus-content-completeness-final/completeness-report.json`

The verifier is intentionally serial within one process. PDFium's process-global
state generated spurious load failures when called concurrently from Python
threads; serial reruns of the identical files were stable and complete.

## Isolation and temporary resources

The live app still points to `consult-demo-v2`, with 100% traffic on revision
`ca-helmonic-consult-dev-002--hyb570514c`. The disposable diagnostic job was
deleted and independently confirmed absent. Its ACR image repository remains
only because deleting it requires a new, repository-specific temporary role
assignment; no such permission was created without explicit approval.
