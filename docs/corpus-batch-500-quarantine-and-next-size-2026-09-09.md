# 500-PDF quarantine register and next-batch size gate

Date: 2026-09-09

## Exact quarantine register

No quarantined source was re-attempted. None was password-protected, and the
recorded failures do not establish that any file is permanently unusable.

Fifteen documents crossed the standing 2 GiB per-document memory ceiling while
extracting complex page/table structures. These files may be valid, but the same
bytes are not eligible for another attempt under the unchanged limit. A genuinely
new optimized/flattened PDF export is worth requesting for each one.

Two small one-page PDFs opened but produced no extractable primary text. A fresh
text-searchable export is worth requesting. The existing image-only/no-text copy
must not be retried; OCR remains a separate, unapproved lane.

| Source ID | Document | Pages | Recorded failure | Replacement assessment |
| --- | --- | ---: | --- | --- |
| `src-01b30da6342a7b098cae5fa1` | P22-206-CAM-RAU-combined- GA plans.pdf | 8 | Memory limit; 2,048.4 MiB peak | Request optimized/flattened export |
| `src-1446c3bf8e720ff34f3e27ea` | GSA-XX-XX-XXX-RP-IAC-SD-1201.pdf (Archived) | 39 | Memory limit; 2,053.1 MiB peak | Request optimized/flattened export |
| `src-154506f87e7e8e4c6f188830` | Ushers Island Event Space Wall Buildup.pdf | 1 | No extractable content | Request text-searchable export; OCR only if separately approved |
| `src-31282d547f08be246fefbfcd` | 24-04-SK-DEVELOPED-EXEMPLAR-SCHEME-MAR-2025.pdf | 5 | Memory limit; 2,048.2 MiB peak | Request optimized/flattened export |
| `src-41d825751c72980c1ae150bf` | 20260507 PP-MPBP 26 -EMP-REV001 (1).pdf | 131 | Memory limit; 2,048.8 MiB peak | Request optimized/flattened export |
| `src-4fe8590421b6ca1ec0202a26` | A0.403-ELY-PLACE-SECTIONS-Rev.C02.pdf | 1 | Memory limit; 2,049.6 MiB peak | Request optimized/flattened export |
| `src-50e7b5aed4c2235de4bee1be` | GSA-XX-XX-XXX-RP-IAC-SD-1201.pdf (Shared) | 41 | Memory limit; 2,053.9 MiB peak | Request optimized/flattened export |
| `src-53d047cc5f0b2ecb945140bf` | J2712_An Post ASHP Noise Assessment.pdf | 15 | Memory limit; 2,049.2 MiB peak | Request optimized/flattened export |
| `src-70548be6124db13fa0c4b54e` | 25C02-OC+C-Tuam Town Hall Architectural Tender Drawings 251111 (1).pdf | 81 | Memory limit; 2,050.0 MiB peak | Request optimized/flattened export |
| `src-95b8544abcebfa533e9eab9d` | Ushers Island Event Space Roof V2.pdf | 1 | No extractable content | Request text-searchable export; OCR only if separately approved |
| `src-a61062b5274051d32a43f68e` | SSG-D143--Sheet-05-RFI-183-&-184-70s-Building-Wall-Finishes-&-Skirting-Rev.C01.pdf | 1 | Memory limit; 2,056.8 MiB peak | Request optimized/flattened export |
| `src-a8ec79217eccaf53911def57` | BMB_1310 Proposed GA Layout R00.pdf | 1 | Memory limit; 2,065.1 MiB peak | Request optimized/flattened export |
| `src-b8f73c2ca9c6e981275c24c9` | A0.506-ELY-PLACE-WATERPROOFING-PAVING-&-PLANTER-DETAILS-SHEET-02-Rev.C01.pdf | 1 | Memory limit; 2,048.9 MiB peak | Request optimized/flattened export |
| `src-bdd7822335c871ca011524a1` | z.24237-01-010_Environmental Brief.pdf | 73 | Memory limit; 2,055.3 MiB peak | Request optimized/flattened export |
| `src-cf97bb842682dd3e0f95b215` | A1.115-THIRD-FLOOR-PLAN---PROPOSED-Rev.C10.pdf | 1 | Memory limit; 2,048.3 MiB peak | Request optimized/flattened export |
| `src-e74f9fab41cd6027ff0a340b` | A1.116-FOURTH-FLOOR-&-ROOF-PLAN---PROPOSED-Rev.C11.pdf | 1 | Memory limit; 2,082.3 MiB peak | Request optimized/flattened export |
| `src-e8e6dd895d6f285a00e36edf` | A1.056-FOURTH-FLOOR-&-ROOF-PLAN---DEMOLITION-Rev.C02.pdf | 1 | Memory limit; 2,050.7 MiB peak | Request optimized/flattened export |

## Next-batch size proposal — approval gate 1

The nominal untouched pool is approximately 1,464 documents, but it includes
the 285 Word files that remain ineligible until conversion fidelity passes.
The presently runnable untouched pool is therefore 1,179 PDFs: 1,779 eligible
PDFs minus the 100-PDF pilot and the 500 PDFs already attempted.

The two completed batches provide 600 real attempts and 583 accepted PDFs:

| Combined evidence | Total | Per accepted PDF |
| --- | ---: | ---: |
| Accepted source bytes | 1,348,120,388 | 2.312 MB |
| Pages | 4,855 | 8.328 |
| Search chunks | 7,098 | 12.175 |
| Actual embedding input tokens | 4,184,494 | 7,177.5 |
| Attempt result | 583 accepted / 17 quarantined | 97.17% accepted |

Proposed size: **900 PDFs**.

This covers 76.3% of the currently runnable untouched PDF pool while leaving a
bounded 279-PDF tail. At observed averages it represents about 2.08 GB, 7,495
pages, 10,957 Search chunks, and 6.46 million embedding-input tokens. At the
observed acceptance rate, approximately 874 may pass, but this is planning only:
the run must report the real result and must not backfill quarantines.

The 900-PDF size is large enough to make the next run the main corpus push, but
retains a final PDF batch if the larger and more varied sample exposes a new
failure mode. Word documents remain outside both counts until their separate
conversion-fidelity gate passes.

No time or cost gate is stated here. It will be calculated and presented only
after the owner separately approves this 900-PDF size.
