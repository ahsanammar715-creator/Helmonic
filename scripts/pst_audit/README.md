# PST metadata inventory

This is a local, read-only discovery tool for the approved Glen, Owen, and (when
present) Jim PST archives. It is separate from the PDF/Word corpus audit and from
the future Outlook ingestion pipeline.

## Safety boundary

- PST files are opened with `FileMode.Open` and `FileAccess.Read` by the pinned
  XstReader implementation.
- The audit reads folder names/counts, message headers, sender/recipient metadata,
  dates, message class/declared size, and attachment name/type/declared size.
- The PST storage-encoding mode is reported. If the PST password marker is set,
  the archive is flagged and message enumeration stops instead of forcing through.
- The audit does **not** call XstReader's message-body, attachment-property, export,
  or attachment-save APIs.
- Runtime guards fail if body bytes/text or attachment content are ever loaded.
- A build-time source guard rejects known payload APIs in repo-owned audit code.
- Reports are written under ignored `local-artifacts/pst-audit`; never commit them.
- No Outlook profile is opened or modified. No Azure service is called.

The reports contain personal metadata and must remain access-controlled. Third-party
consent for message content remains unresolved. This audit does not authorize later
body or attachment-content extraction.

## Pinned local dependency

The build expects XstReader commit
`3b7856c8b3d01bdf8aa13744e476d1ef7761b832` under the ignored
`local-tools/xstreader-3b7856c` directory and Roslyn 4.14.0 under the ignored
`local-tools/roslyn-4.14.0` directory. XstReader is Microsoft Public License (Ms-PL).
Third-party source and compiler binaries are deliberately not committed.

## Run

From a normal Windows PowerShell session, in the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\pst_audit\run-pst-metadata-audit.ps1 -Build
```

The launcher looks only for `backup_glen*.pst`, `backup_owen*.pst`, and an optional
`*jim*.pst` at the root of `S:\z_Helmonic_iAcoustics`. Jim's absence is reported as
pending and does not block Glen or Owen. If filenames differ, pass exact paths with
`-PstPath`.

Outputs include per-mailbox message, folder, issue, manifest, and Markdown reports,
plus a combined CSV/Markdown summary. Folder size is necessarily a rough estimate:
the report uses PST-declared message and attachment sizes, while the physical PST
file size includes internal indexes, unused space, and other Outlook objects.

This first version checkpoints at mailbox-report granularity. Leave the PowerShell
window open until each large PST completes. An interrupted mailbox can be rerun; the
tool overwrites only its local ignored reports and never modifies the PST.
