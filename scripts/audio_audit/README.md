# Helmonic WAV header audit

This is a local, read-only classification step for the 3,512 WAV files found by the
completed corpus audit. It reads container headers and existing audit metadata only. It
does not decode, play, copy, transcribe, upload, or modify audio and makes no Azure call.

Run it from a normal signed-in Windows PowerShell session because the isolated Codex
process cannot authenticate to the mapped company share:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  "C:\Users\Alessandro.Saccarola\Documents\Codex\2026-08-21\referenced-chatgpt-conversation-this-is-an\work\Helmonic-phase1a\scripts\audio_audit\run-audio-header-audit.ps1"
```

Ignored reports are written to `local-artifacts/audio-audit/`:

- `summary.json`: aggregate duration, formats, channels, sample rates, speech-name hints,
  and measurement/PDF/text companion counts;
- `audio-headers.csv`: one row per audited WAV, including any parse error; and
- `review-sample.csv`: a deterministic, stratified list for later human listening or a
  separately approved local/content classifier.

Headers and filenames cannot prove speech content. The review list exists specifically
to prevent environmental monitoring audio from being sent blindly to speech-to-text.

## Bounded ingestion pilot

Jim subsequently confirmed that the approved WAV originals should be retained as
reference evidence. Before any bulk capture, build a deterministic twelve-file pilot
that covers both source groups, short/medium/long durations, the three observed format
tags, multichannel audio, the two compound-name voice-note candidates, and available
measurement/PDF/text companions. It is capped at 512 MiB and does not decode or upload
audio:

```powershell
python scripts/audio_audit/build_audio_pilot_manifest.py `
  --audio-inventory local-artifacts/audio-audit/audio-headers.csv `
  --full-manifest local-artifacts/corpus-ingestion-manifest/full-ingestion-manifest.jsonl `
  --output-dir local-artifacts/audio-ingestion-pilot `
  --permission-scope iAcoustics
```

The ignored output remains `pilot_only`. An approved Azure pilot must verify the source
hash, private Blob copy, metadata/project linkage, authorized byte-range playback, and
timestamped `AU` citation before any larger batch. Format tag 17 is marked as requiring
a controlled playback derivative because browser-native support must not be assumed.
The pilot performs no transcription or model processing and cannot promote itself.
