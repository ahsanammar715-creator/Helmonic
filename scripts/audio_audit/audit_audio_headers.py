from __future__ import annotations

import argparse
import csv
import json
import os
import re
import struct
from collections import Counter, defaultdict
from pathlib import Path, PureWindowsPath
from typing import Any, BinaryIO


ANALYZER_VERSION = "2026-09-04.1"
MEASUREMENT_EXTENSIONS = {
    ".cna", ".cni", ".cnp", ".iris", ".ixl", ".slog", ".svl", ".svu",
    ".xl2", ".xl2r", ".xl3", ".xl3ms", ".xl3si", ".xlba", ".xldb",
}
SPEECH_HINT = re.compile(
    r"voice[\W_]*note|voicenote|(?:^|[^a-z])(voice|memo|meeting|dictat|interview|speech|conversation|spoken)(?:[^a-z]|$)",
    re.IGNORECASE,
)


def read_inventory(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def read_exact(handle: BinaryIO, count: int) -> bytes:
    value = handle.read(count)
    if len(value) != count:
        raise ValueError("unexpected end of file")
    return value


def parse_wave_header(path: Path) -> dict[str, Any]:
    before = path.stat()
    with path.open("rb") as handle:
        container = read_exact(handle, 4)
        riff_size = struct.unpack("<I", read_exact(handle, 4))[0]
        if read_exact(handle, 4) != b"WAVE":
            raise ValueError("not a WAVE container")
        if container not in {b"RIFF", b"RF64", b"BW64"}:
            raise ValueError(f"unsupported WAVE container {container!r}")

        fmt: dict[str, int] | None = None
        data_bytes: int | None = None
        ds64_data_bytes: int | None = None
        chunks_seen = 0
        while handle.tell() + 8 <= before.st_size and chunks_seen < 256:
            chunk_id = read_exact(handle, 4)
            chunk_size = struct.unpack("<I", read_exact(handle, 4))[0]
            chunks_seen += 1
            if chunk_id == b"ds64" and chunk_size >= 16:
                payload = read_exact(handle, min(chunk_size, 28))
                if len(payload) >= 16:
                    ds64_data_bytes = struct.unpack("<Q", payload[8:16])[0]
                handle.seek(chunk_size - len(payload), os.SEEK_CUR)
            elif chunk_id == b"fmt " and chunk_size >= 16:
                payload = read_exact(handle, min(chunk_size, 40))
                format_tag, channels, sample_rate, byte_rate, block_align, bits = struct.unpack(
                    "<HHIIHH", payload[:16]
                )
                if format_tag == 0xFFFE and len(payload) >= 26:
                    format_tag = struct.unpack("<H", payload[24:26])[0]
                fmt = {
                    "format_tag": format_tag,
                    "channels": channels,
                    "sample_rate_hz": sample_rate,
                    "byte_rate": byte_rate,
                    "block_align": block_align,
                    "bits_per_sample": bits,
                }
                handle.seek(chunk_size - len(payload), os.SEEK_CUR)
            elif chunk_id == b"data":
                data_bytes = ds64_data_bytes if chunk_size == 0xFFFFFFFF else chunk_size
                break
            else:
                handle.seek(chunk_size, os.SEEK_CUR)
            if chunk_size % 2:
                handle.seek(1, os.SEEK_CUR)

    after = path.stat()
    if before.st_size != after.st_size or before.st_mtime_ns != after.st_mtime_ns:
        raise RuntimeError("source changed while its header was inspected")
    if fmt is None:
        raise ValueError("WAVE fmt chunk not found")
    duration = None
    if data_bytes is not None and fmt["byte_rate"] > 0:
        duration = data_bytes / fmt["byte_rate"]
    return {
        "container": container.decode("ascii"),
        "declared_riff_bytes": riff_size,
        **fmt,
        "data_bytes": data_bytes,
        "duration_seconds": duration,
        "source_was_not_modified": True,
    }


def directory_companions(inventory: list[dict[str, str]]) -> dict[str, set[str]]:
    companions: dict[str, set[str]] = defaultdict(set)
    for row in inventory:
        directory = str(PureWindowsPath(row["relative_path"]).parent).casefold()
        companions[directory].add(row["extension"].casefold())
    return companions


def inspect(
    source_root: Path, inventory_path: Path
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    inventory = read_inventory(inventory_path)
    wav_rows = [row for row in inventory if row["extension"].casefold() == ".wav"]
    companions = directory_companions(inventory)
    results: list[dict[str, Any]] = []

    for row in sorted(wav_rows, key=lambda item: item["relative_path"].casefold()):
        relative = PureWindowsPath(row["relative_path"])
        directory_key = str(relative.parent).casefold()
        extensions = companions[directory_key]
        base = {
            "relative_path": row["relative_path"],
            "top_level": row["top_level"],
            "size_bytes": int(row["size_bytes"]),
            "speech_filename_hint": bool(SPEECH_HINT.search(relative.stem)),
            "measurement_companion": bool(extensions & MEASUREMENT_EXTENSIONS),
            "pdf_companion": ".pdf" in extensions,
            "text_companion": ".txt" in extensions,
            "analyzer_version": ANALYZER_VERSION,
        }
        source_path = source_root.joinpath(*relative.parts)
        try:
            parsed = parse_wave_header(source_path)
            results.append({**base, "status": "ok", "error": "", **parsed})
        except Exception as error:  # retain every failure for operator review
            results.append(
                {
                    **base,
                    "status": "error",
                    "error": f"{type(error).__name__}: {error}",
                    "container": "",
                    "declared_riff_bytes": None,
                    "format_tag": None,
                    "channels": None,
                    "sample_rate_hz": None,
                    "byte_rate": None,
                    "block_align": None,
                    "bits_per_sample": None,
                    "data_bytes": None,
                    "duration_seconds": None,
                    "source_was_not_modified": None,
                }
            )

    ok = [row for row in results if row["status"] == "ok"]
    durations = sorted(float(row["duration_seconds"]) for row in ok if row["duration_seconds"] is not None)

    def percentile(fraction: float) -> float | None:
        if not durations:
            return None
        return durations[round((len(durations) - 1) * fraction)]

    summary = {
        "analyzer_version": ANALYZER_VERSION,
        "privacy_mode": "header-and-filename-metadata-only",
        "audio_content_decoded": False,
        "audio_content_copied": False,
        "azure_calls": 0,
        "wav_files_expected": len(wav_rows),
        "wav_files_inspected": len(results),
        "header_ok": len(ok),
        "header_errors": len(results) - len(ok),
        "total_bytes": sum(row["size_bytes"] for row in results),
        "total_duration_seconds": sum(durations),
        "duration_p50_seconds": percentile(0.50),
        "duration_p90_seconds": percentile(0.90),
        "duration_p99_seconds": percentile(0.99),
        "speech_filename_hints": sum(1 for row in results if row["speech_filename_hint"]),
        "with_measurement_companions": sum(1 for row in results if row["measurement_companion"]),
        "with_pdf_companions": sum(1 for row in results if row["pdf_companion"]),
        "with_text_companions": sum(1 for row in results if row["text_companion"]),
        "containers": dict(sorted(Counter(row["container"] for row in ok).items())),
        "format_tags": dict(sorted(Counter(str(row["format_tag"]) for row in ok).items())),
        "sample_rates_hz": dict(sorted(Counter(str(row["sample_rate_hz"]) for row in ok).items())),
        "channels": dict(sorted(Counter(str(row["channels"]) for row in ok).items())),
        "bits_per_sample": dict(sorted(Counter(str(row["bits_per_sample"]) for row in ok).items())),
        "source_was_not_modified": all(row["source_was_not_modified"] is True for row in ok),
        "interpretation_limit": "Headers cannot prove whether a recording contains speech.",
    }
    return results, summary


def review_sample(rows: list[dict[str, Any]], per_group: int) -> list[dict[str, Any]]:
    groups: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row["status"] != "ok":
            continue
        duration = row["duration_seconds"] or 0
        duration_band = "short" if duration < 60 else "medium" if duration < 900 else "long"
        key = (
            row["top_level"],
            row["speech_filename_hint"],
            row["measurement_companion"],
            row["sample_rate_hz"],
            row["channels"],
            duration_band,
        )
        groups[key].append(row)
    selected: list[dict[str, Any]] = []
    for key in sorted(groups, key=lambda item: tuple(str(value) for value in item)):
        candidates = sorted(groups[key], key=lambda row: row["relative_path"].casefold())
        selected.extend(candidates[:per_group])
    return selected


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Read-only WAV header and companion audit")
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--sample-per-group", type=int, default=2)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    rows, summary = inspect(args.source_root, args.inventory)
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    write_csv(output / "audio-headers.csv", rows)
    write_csv(output / "review-sample.csv", review_sample(rows, args.sample_per_group))
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0 if summary["header_errors"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
