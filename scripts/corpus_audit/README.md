# Helmonic corpus audit

This is the read-only discovery gate before the approximately 300 GB company collection
is admitted to the asynchronous ingestion pipeline. It does not upload, rename, move,
convert, delete, or edit any source file and makes no Azure calls.

The audit:

- skips `backup_glen`, `backup_owen`, `Book Directory`,
  `downloads_helmonic_smart_studio`, and `Tender Desk`;
- treats the collection checklist itself as reference metadata rather than corpus input;
- maps `IA-02.1` and `IA-02.2` together to checklist item `IA-02`;
- records `IA-21` as unmapped instead of guessing its purpose;
- counts PDF, Word, and other formats by folder/checklist item;
- verifies PDF readability and DOCX/legacy Word structure;
- analyzes extractable text on every PDF page by default and flags full/partial OCR
  candidates;
- groups byte-identical PDF/Word files using SHA-256 and separately lists possible
  filename variants;
- stores no extracted document text in its reports;
- uses a local SQLite checkpoint so an interrupted multi-hour run can resume safely.

## Run from the normal Windows session

Codex's restricted shell cannot traverse the mapped company share even when the signed-in
Windows user can. Open PowerShell normally and run:

```powershell
& "C:\Users\Alessandro.Saccarola\Documents\Codex\2026-08-21\referenced-chatgpt-conversation-this-is-an\work\Helmonic-phase1a\scripts\corpus_audit\run-corpus-audit.ps1"
```

The authoritative mode reads every PDF page. To get a faster initial estimate, pass
`-PageMode sample`; rerun without that option before making the OCR decision. A normal
rerun resumes unchanged files. Use `-Restart` only when intentionally replacing the
local checkpoint.

Reports are written under the ignored local directory:

```text
local-artifacts/corpus-audit/
  summary.json
  inventory.csv
  folder-summary.csv
  exact-duplicates.csv
  possible-variants.csv
  scan-errors.csv
  audit.sqlite3
```

`ocr_candidate` means at least 90% of analyzed pages had fewer than 40 extractable
alphanumeric characters. `partial_ocr_candidate` means 20-90% did. Those are conservative
procurement/triage flags, not permission to ingest: plans, intentionally blank pages, and
drawings still need a human spot-check.

## Rebuild the ingestion-plan profile

After an authoritative audit completes, reproduce the decision counts without reading
the company share again:

```powershell
python .\scripts\corpus_audit\build_ingestion_plan_analysis.py `
  --audit-dir .\local-artifacts\corpus-audit `
  --output .\local-artifacts\corpus-ingestion-plan\analysis.json
```

The analysis reconciles source totals and derives exact-deduplicated populations. It
fails closed when audit totals disagree and holds any duplicate identity that appears
in both an approved and unresolved classification. The JSON output remains local and
ignored; the decision-ready interpretation is `docs/corpus-to-ingestion-plan.md`.

## Build the private capture-all manifest

Create the full intake manifest from the completed audit without reading or modifying
the company share:

```powershell
python .\scripts\corpus_audit\build_full_ingestion_manifest.py `
  --audit-dir .\local-artifacts\corpus-audit `
  --output-dir .\local-artifacts\corpus-ingestion-manifest
```

The ignored output contains confidential relative paths. It accounts for every audited
approved original, assigns an opaque Blob name and processing lane, preserves duplicate
relationships, and leaves permission scope unset so no file can become searchable by
accident. Capture/catalogue eligibility is not the same as permission to embed, index,
or expose a source to Consult.

## Stage the isolated 100-PDF pipeline pilot

The first real ingestion batch uses a deterministic, category-balanced sample of 100
canonical, readable PDFs from the completed private manifest. It excludes approved
books until the private `[B]` presentation path exists, plus all OCR, broken, duplicate,
Word-render, IA-21/Cadna-hold, and non-document rows. This is a pipeline-validation
sample, not a consultant-ranked or promotion-ready knowledge release.

The Codex sandbox cannot open company-share file bodies. Run the staging step once from
the normal signed-in Windows PowerShell session:

```powershell
& "C:\Users\Alessandro.Saccarola\Documents\Codex\2026-08-21\referenced-chatgpt-conversation-this-is-an\work\Helmonic-phase1a\scripts\corpus_audit\prepare-corpus-pilot-context.ps1" `
  -SourceRoot "S:\z_Helmonic_iAcoustics" `
  -OutputRoot "C:\Users\Alessandro.Saccarola\Documents\Codex\2026-08-21\referenced-chatgpt-conversation-this-is-an\work\Helmonic-phase1a\private-build\corpus-pilot-100-context"
```

The launcher verifies the audit size and timestamp, computes or confirms SHA-256 while
the source is stable, copies each selected PDF under an opaque ID, verifies the staged
copy, rechecks page count, extracts every readable page, preserves detected tables as
atomic Markdown, and writes only to ignored `private-build`. Each document runs in its
own child process with a default ten-minute/2 GiB ceiling. A timeout, memory breach,
reader disagreement, missing page, or unresolved second-reader failure quarantines that document
and prevents an incomplete candidate payload. Successful documents are recorded in an
atomic checkpoint and are hash-verified when resumed, so an interrupted batch does not
restart from zero. Every PDF is read independently by pdfminer/pdfplumber and pypdf;
recoverable stream warnings are accepted only when both reader passes open every audited
page. Legitimate blank/drawing pages stay recorded rather than receiving invented text.
The original is always authoritative;
the pipeline never invents replacement text and does no OCR in this lane.
The summary retains measured per-document elapsed time and peak worker memory so the
next batch is sized from observed evidence rather than a round-number guess.

The subsequent Azure job
must explicitly select the standing ingestion UAMI, target an index beginning with
`consult-candidate-`, and name the real live index separately so the contract can reject
it. The candidate stays non-promotable until consultants supply the ranked sources and
known-answer evaluation.
