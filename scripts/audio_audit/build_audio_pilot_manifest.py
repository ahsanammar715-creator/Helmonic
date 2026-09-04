from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any, Iterable

from audit_audio_headers import SPEECH_HINT


PILOT_VERSION = 1
REQUIRED_FEATURES = {
    "duration_long",
    "duration_medium",
    "duration_short",
    "format_1",
    "format_3",
    "format_17",
    "ia_02_2",
    "ia_06",
    "measurement_companion",
    "multichannel",
    "pdf_companion",
    "speech_filename_hint",
    "text_companion",
}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def as_bool(value: Any) -> bool:
    return str(value).strip().casefold() == "true"


def features(row: dict[str, Any]) -> set[str]:
    duration = float(row["duration_seconds"])
    result = {
        "duration_short" if duration < 60 else "duration_medium" if duration < 900 else "duration_long",
        f"format_{int(row['format_tag'])}",
        "ia_02_2" if str(row["top_level"]).casefold() == "ia-02.2" else "ia_06",
    }
    if int(row["channels"]) > 1:
        result.add("multichannel")
    for name in (
        "measurement_companion",
        "pdf_companion",
        "text_companion",
    ):
        if as_bool(row[name]):
            result.add(name)
    if as_bool(row["speech_filename_hint"]) or SPEECH_HINT.search(str(row["relative_path"])):
        result.add("speech_filename_hint")
    return result


def build_pilot(
    audio_rows: Iterable[dict[str, Any]],
    full_manifest: Iterable[dict[str, Any]],
    *,
    count: int,
    max_bytes: int,
    permission_scope: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if count < 1 or max_bytes < 1 or not permission_scope.strip():
        raise ValueError("count, max_bytes, and permission_scope must be set")

    manifest_by_path = {
        str(row["relative_path"]).casefold(): row
        for row in full_manifest
        if row.get("extension") == ".wav"
    }
    candidates: list[dict[str, Any]] = []
    for audio in audio_rows:
        if audio.get("status") != "ok" or not as_bool(audio.get("source_was_not_modified")):
            continue
        manifest = manifest_by_path.get(str(audio["relative_path"]).casefold())
        if not manifest or not manifest.get("capture_original") or not manifest.get("is_canonical"):
            continue
        if manifest.get("citation_namespace") != "AU":
            raise RuntimeError(f"WAV is missing AU namespace: {audio['relative_path']}")
        if int(audio["size_bytes"]) != int(manifest["size_bytes"]):
            raise RuntimeError(f"Audit/manifest size mismatch: {audio['relative_path']}")
        candidates.append({"audio": audio, "manifest": manifest, "features": features(audio)})

    selected: list[dict[str, Any]] = []
    remaining = list(candidates)
    uncovered = set(REQUIRED_FEATURES)
    selected_bytes = 0
    while remaining and len(selected) < count:
        eligible = [
            item for item in remaining
            if selected_bytes + int(item["manifest"]["size_bytes"]) <= max_bytes
        ]
        if not eligible:
            break
        chosen = min(
            eligible,
            key=lambda item: (
                -len(item["features"] & uncovered),
                int(item["manifest"]["size_bytes"]),
                str(item["manifest"]["relative_path"]).casefold(),
            ),
        )
        selected.append(chosen)
        selected_bytes += int(chosen["manifest"]["size_bytes"])
        uncovered -= chosen["features"]
        remaining.remove(chosen)

    if len(selected) != count:
        raise RuntimeError(f"Could select only {len(selected)} of {count} pilot WAVs within byte ceiling")
    if uncovered:
        raise RuntimeError(f"Pilot lacks required coverage: {', '.join(sorted(uncovered))}")

    rows: list[dict[str, Any]] = []
    for item in sorted(selected, key=lambda value: str(value["manifest"]["source_id"])):
        audio, manifest = item["audio"], item["manifest"]
        format_tag = int(audio["format_tag"])
        rows.append(
            {
                "pilot_version": PILOT_VERSION,
                "source_id": manifest["source_id"],
                "relative_path": manifest["relative_path"],
                "blob_name": manifest["blob_name"],
                "size_bytes": int(manifest["size_bytes"]),
                "sha256": manifest.get("sha256"),
                "hash_state": manifest["hash_state"],
                "permission_scope": permission_scope,
                "citation_namespace": "AU",
                "duration_seconds": float(audio["duration_seconds"]),
                "format_tag": format_tag,
                "channels": int(audio["channels"]),
                "sample_rate_hz": int(audio["sample_rate_hz"]),
                "measurement_companion": as_bool(audio["measurement_companion"]),
                "pdf_companion": as_bool(audio["pdf_companion"]),
                "text_companion": as_bool(audio["text_companion"]),
                "speech_filename_hint": bool(
                    as_bool(audio["speech_filename_hint"])
                    or SPEECH_HINT.search(str(audio["relative_path"]))
                ),
                "playback_strategy": (
                    "native_compatibility_test" if format_tag in {1, 3} else "derived_playback_required"
                ),
                "content_processing": "none",
                "promotion_state": "pilot_only",
            }
        )

    covered = sorted(set().union(*(item["features"] for item in selected)))
    summary = {
        "pilot_version": PILOT_VERSION,
        "source_was_not_modified": True,
        "azure_calls": 0,
        "selected_files": len(rows),
        "selected_bytes": selected_bytes,
        "maximum_bytes": max_bytes,
        "permission_scope": permission_scope,
        "required_features": sorted(REQUIRED_FEATURES),
        "covered_features": covered,
        "all_required_features_covered": REQUIRED_FEATURES.issubset(covered),
        "content_processing": "none",
        "promotion_requires_separate_approval": True,
    }
    return rows, summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a bounded WAV ingestion-pilot manifest")
    parser.add_argument("--audio-inventory", type=Path, required=True)
    parser.add_argument("--full-manifest", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--permission-scope", required=True)
    parser.add_argument("--count", type=int, default=12)
    parser.add_argument("--max-bytes", type=int, default=536_870_912)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    rows, summary = build_pilot(
        read_csv(args.audio_inventory),
        read_jsonl(args.full_manifest),
        count=args.count,
        max_bytes=args.max_bytes,
        permission_scope=args.permission_scope,
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    with (args.output_dir / "audio-pilot-manifest.jsonl").open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    (args.output_dir / "audio-pilot-summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
