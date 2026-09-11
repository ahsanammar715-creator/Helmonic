# Prompt for Codex — read-only metadata inventory of the three PST mailbox archives

This is a separate, parallel track from the PDF/Word corpus/ingestion work
already in motion. Do not let this block or compete with that work — if it
needs the same engineering attention, sequence it after, don't merge the
two efforts together.

## Context

Three personal Outlook mailbox archives exist in scope for eventual
ingestion: `backup_glen`, `backup_owen` (both previously excluded from the
main corpus audit, now brought back into scope), and a third PST archive
for Jim's mailbox, extracted separately by the user via his own method and
manually placed alongside the other two once ready — same PST format, just
user-provided rather than something to locate independently. Jim's Outlook
sync/backup export has just been kicked off and may take a while to
complete (mailbox exports of this kind commonly take hours) — if Jim's
file isn't present yet when this task starts, process Glen's and Owen's
first and pick up Jim's PST whenever it's dropped in; don't wait on it,
and don't treat its absence as an error or a blocker. All three mailbox
owners have confirmed they're aware their archives
are being considered for ingestion. One thing not yet resolved: every
email has a
second party (clients, other firms, colleagues) who has not consented to
their side of the correspondence being processed — this inventory step
does not need that question resolved first, since it extracts metadata
only, not email body content. Full body-content extraction later does
need that question answered before it happens — flag this explicitly in
the output, do not proceed past metadata into body extraction without a
separate, explicit go-ahead.

## Goal

Produce a read-only, metadata-only inventory of all three PST files.
Extract:

- Total email count per mailbox, by folder (Inbox, Sent, subfolders, etc.).
- Date range covered.
- Subject line, sender, recipient(s), and date per email — metadata only.
- Attachment count, filename, and file type per email (not attachment
  content).
- Rough size/volume per mailbox and per folder.
- Any PST-level issues (corrupted archive, password-protected/encrypted
  file, orphaned/incomplete data) — report, don't attempt to force through.

**Do not extract or store email body content or attachment content in
this pass.** This is a scoping/sizing exercise, not the actual ingestion
pipeline. The point is to see what exists before deciding how much of it
is worth extracting in full, and to give a real sense of volume/scope
before any bigger commitment.

## Implementation

- Identify and use an appropriate read-only PST-reading library/tool (this
  is a different format entirely from the PDF/Word pipeline already
  built — do not assume existing tooling handles it; check what's
  actually available and report the choice before using it).
- Treat the PST files as read-only source data at all times — never
  modify, move, or write back to the original archive.
- This step incurs no Azure cost — everything runs locally against the
  local/copied PST files.

## Reporting

Produce a report per mailbox (and a combined summary) covering the above
metadata fields, plus:
- An explicit, visible flag restating that this is metadata only, no
  body/attachment content was read or stored, and that the third-party
  consent question remains open and must be resolved before any further
  extraction step.
- A rough estimate of what full body/attachment extraction would involve
  (scale, likely effort) based on what this inventory finds — informational
  only, not a commitment to do it.

## What this task does NOT do

- Does not extract, read, or store any email body text or attachment
  content.
- Does not build the actual PST ingestion/extraction pipeline — that's a
  separate, later task once scope and the third-party question are both
  settled.
- Does not touch Azure, the existing document-ingestion work, or incur
  any cost.

## Documentation

Record this inventory's existence, findings, and the still-open
third-party consent question in `docs/phase1b-consult-design.md`, kept
clearly separate from the PDF/Word corpus documentation already there.
