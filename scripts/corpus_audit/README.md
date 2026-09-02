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
