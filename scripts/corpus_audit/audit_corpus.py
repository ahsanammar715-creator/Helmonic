#!/usr/bin/env python3
"""Read-only inventory and document-quality audit for the Helmonic source corpus.

The source tree is opened only for enumeration and binary reads. All state and reports
are written to a caller-supplied local output directory outside the source tree.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover - launcher checks this before a real run
    PdfReader = None  # type: ignore[assignment]


ANALYZER_VERSION = "2026-09-02.1"
PDF_EXTENSIONS = {".pdf"}
WORD_EXTENSIONS = {".doc", ".docx", ".docm", ".dot", ".dotx", ".dotm", ".rtf"}
DOCUMENT_EXTENSIONS = PDF_EXTENSIONS | WORD_EXTENSIONS
EXCLUDED_TOP_LEVEL_STEMS = {
    "backup_glen",
    "backup_owen",
    "book directory",
    "downloads_helmonic_smart_studio",
    "tender desk",
}
REFERENCE_ONLY_STEMS = {"acousticore_iacoustics_simplified_collection_checklist"}
COMPOUND_FILE_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")
CHECKLIST_GROUPS = {f"IA-{number:02d}" for number in range(1, 21)}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_stem(name: str) -> str:
    return Path(name).stem.casefold().strip()


def is_reparse_point(entry: os.DirEntry[str]) -> bool:
    try:
        attributes = entry.stat(follow_symlinks=False).st_file_attributes
    except (AttributeError, OSError):
        attributes = 0
    return entry.is_symlink() or bool(attributes & 0x400)


def ensure_output_is_local(source: Path, output: Path) -> None:
    source_resolved = source.resolve(strict=True)
    output_resolved = output.resolve(strict=False)
    try:
        common = os.path.commonpath((str(source_resolved), str(output_resolved)))
    except ValueError:  # Different Windows drives is the safest/common case.
        return
    if os.path.normcase(common) == os.path.normcase(str(source_resolved)):
        raise ValueError("Output directory must not be inside the source corpus.")


def checklist_group(top_level: str) -> tuple[str, str]:
    match = re.match(r"(?i)^IA-(\d{2})(?:\.\d+)?$", top_level)
    if match:
        canonical = f"IA-{match.group(1)}"
        if canonical == "IA-02":
            return canonical, "IA-02.1 and IA-02.2 jointly represent checklist item IA-02"
        if canonical in CHECKLIST_GROUPS:
            return canonical, ""
        return f"UNMAPPED:{top_level}", "Not present in the IA-01 to IA-20 checklist"

    folded = top_level.casefold()
    if folded == "iacoustic_cadna_or":
        return "IA-06/IA-07-candidate", "Classify against raw-data and calculation categories"
    if folded in {
        "books and guidelines for helmonic",
        "iacoustic_acousticessentialsforarchitects",
        "ioa bulletin",
    }:
        return "APPROVED-REFERENCE", "Reuse/licensing already validated by the owner"
    if folded == "third party acoustic reports":
        return "APPROVED-THIRD-PARTY", "Confidentiality/reuse already validated by the owner"
    return "UNMAPPED-SUPPLEMENTARY", "Top-level collection is not a numbered checklist folder"


def document_kind(suffix: str) -> str:
    if suffix in PDF_EXTENSIONS:
        return "pdf"
    if suffix in WORD_EXTENSIONS:
        return "word"
    return "other"


def iter_files(source: Path, issues: list[dict[str, str]]) -> Iterable[tuple[Path, str]]:
    """Yield files without following links/reparse points or excluded root entries."""

    try:
        root_entries = sorted(os.scandir(source), key=lambda entry: entry.name.casefold())
    except OSError as exc:
        raise RuntimeError(f"Cannot enumerate source root: {exc}") from exc

    stack: list[tuple[Path, str]] = []
    for entry in reversed(root_entries):
        folded_stem = normalize_stem(entry.name)
        if folded_stem in EXCLUDED_TOP_LEVEL_STEMS or folded_stem in REFERENCE_ONLY_STEMS:
            continue
        if is_reparse_point(entry):
            issues.append({"path": entry.name, "stage": "enumerate", "error": "reparse point skipped"})
            continue
        path = Path(entry.path)
        try:
            if entry.is_dir(follow_symlinks=False):
                stack.append((path, entry.name))
            elif entry.is_file(follow_symlinks=False):
                yield path, entry.name
        except OSError as exc:
            issues.append({"path": entry.name, "stage": "enumerate", "error": str(exc)})

    while stack:
        directory, top_level = stack.pop()
        try:
            entries = sorted(os.scandir(directory), key=lambda entry: entry.name.casefold(), reverse=True)
        except OSError as exc:
            relative = str(directory.relative_to(source))
            issues.append({"path": relative, "stage": "enumerate", "error": str(exc)})
            continue
        for entry in entries:
            relative = str(Path(entry.path).relative_to(source))
            if is_reparse_point(entry):
                issues.append({"path": relative, "stage": "enumerate", "error": "reparse point skipped"})
                continue
            try:
                if entry.is_dir(follow_symlinks=False):
                    stack.append((Path(entry.path), top_level))
                elif entry.is_file(follow_symlinks=False):
                    yield Path(entry.path), top_level
            except OSError as exc:
                issues.append({"path": relative, "stage": "enumerate", "error": str(exc)})


def pdf_image_count(page: Any) -> int:
    """Count image XObjects without decoding their potentially large image bodies."""

    try:
        resources = page.get("/Resources")
        if resources is None:
            return 0
        resources = resources.get_object()
        xobjects = resources.get("/XObject")
        if xobjects is None:
            return 0
        xobjects = xobjects.get_object()
        count = 0
        for value in xobjects.values():
            obj = value.get_object()
            if obj.get("/Subtype") == "/Image":
                count += 1
        return count
    except Exception:
        return 0


def pages_to_analyze(page_count: int, mode: str) -> list[int]:
    if mode == "all" or page_count <= 5:
        return list(range(page_count))
    return sorted({0, 1, page_count // 2, max(0, page_count - 2), page_count - 1})


def inspect_pdf(path: Path, page_mode: str, min_text_chars: int) -> dict[str, Any]:
    result: dict[str, Any] = {
        "integrity_status": "ok",
        "page_count": None,
        "pages_analyzed": 0,
        "low_text_pages": None,
        "image_pages": None,
        "ocr_status": "not_assessed",
        "notes": "",
    }
    if PdfReader is None:
        result.update(integrity_status="not_checked", notes="pypdf unavailable")
        return result
    try:
        with path.open("rb") as handle:
            reader = PdfReader(handle, strict=False)
            if reader.is_encrypted:
                try:
                    unlocked = reader.decrypt("")
                except Exception:
                    unlocked = 0
                if not unlocked:
                    result.update(integrity_status="encrypted", ocr_status="manual_review")
                    return result

            page_count = len(reader.pages)
            result["page_count"] = page_count
            if page_count == 0:
                result.update(integrity_status="warning", ocr_status="manual_review", notes="zero-page PDF")
                return result

            selected = pages_to_analyze(page_count, page_mode)
            low_text_pages = 0
            image_pages = 0
            extraction_errors = 0
            for index in selected:
                page = reader.pages[index]
                try:
                    text = page.extract_text() or ""
                    alphanumeric = sum(character.isalnum() for character in text)
                    if alphanumeric < min_text_chars:
                        low_text_pages += 1
                except Exception:
                    extraction_errors += 1
                    low_text_pages += 1
                if pdf_image_count(page) > 0:
                    image_pages += 1

            analyzed = len(selected)
            result.update(
                pages_analyzed=analyzed,
                low_text_pages=low_text_pages,
                image_pages=image_pages,
            )
            low_ratio = low_text_pages / analyzed
            if low_ratio >= 0.9:
                result["ocr_status"] = "ocr_candidate"
            elif low_ratio >= 0.2:
                result["ocr_status"] = "partial_ocr_candidate"
            else:
                result["ocr_status"] = "text_extractable"
            notes: list[str] = []
            if page_mode == "sample" and analyzed < page_count:
                notes.append(f"sampled {analyzed} of {page_count} pages")
            if low_text_pages and image_pages == 0:
                notes.append("low-text pages have no directly referenced image XObject; may be blank/drawing")
            if extraction_errors:
                result["integrity_status"] = "warning"
                notes.append(f"text extraction failed on {extraction_errors} analyzed page(s)")
            result["notes"] = "; ".join(notes)
            return result
    except Exception as exc:
        result.update(integrity_status="broken", ocr_status="not_assessed", notes=f"{type(exc).__name__}: {exc}")
        return result


def docx_text_and_media(archive: zipfile.ZipFile) -> tuple[int, int]:
    xml = archive.read("word/document.xml")
    root = ElementTree.fromstring(xml)
    text = "".join(node.text or "" for node in root.iter() if node.tag.endswith("}t"))
    media_count = sum(name.startswith("word/media/") and not name.endswith("/") for name in archive.namelist())
    return sum(character.isalnum() for character in text), media_count


def inspect_word(path: Path, suffix: str, min_text_chars: int) -> dict[str, Any]:
    result: dict[str, Any] = {
        "integrity_status": "ok",
        "page_count": None,
        "pages_analyzed": 0,
        "low_text_pages": None,
        "image_pages": None,
        "ocr_status": "not_required",
        "notes": "Word must be rendered to PDF before page-preserving ingestion",
    }
    try:
        if suffix in {".docx", ".docm", ".dotx", ".dotm"}:
            with zipfile.ZipFile(path, "r") as archive:
                bad_member = archive.testzip()
                if bad_member:
                    raise zipfile.BadZipFile(f"CRC failure in {bad_member}")
                if "word/document.xml" not in archive.namelist():
                    raise zipfile.BadZipFile("word/document.xml missing")
                text_chars, media_count = docx_text_and_media(archive)
                if text_chars < min_text_chars and media_count:
                    result["ocr_status"] = "ocr_candidate_after_render"
                    result["notes"] += f"; only {text_chars} text characters with {media_count} embedded media item(s)"
                elif text_chars < min_text_chars:
                    result["ocr_status"] = "manual_review"
                    result["notes"] += f"; only {text_chars} extractable text characters"
                return result

        with path.open("rb") as handle:
            prefix = handle.read(16)
        if suffix in {".doc", ".dot"}:
            if not prefix.startswith(COMPOUND_FILE_MAGIC):
                raise ValueError("invalid legacy Word compound-file signature")
            result.update(
                integrity_status="legacy_header_ok",
                ocr_status="manual_review_after_render",
                notes="Legacy Word header is valid; isolated render-to-PDF validation is required",
            )
        elif suffix == ".rtf":
            if not prefix.lstrip().startswith(b"{\\rtf"):
                raise ValueError("invalid RTF signature")
            result.update(
                integrity_status="rtf_header_ok",
                notes="RTF header is valid; isolated render-to-PDF validation is required",
            )
        return result
    except Exception as exc:
        result.update(integrity_status="broken", ocr_status="not_assessed", notes=f"{type(exc).__name__}: {exc}")
        return result


def inspect_file(path: Path, kind: str, suffix: str, page_mode: str, min_text_chars: int) -> dict[str, Any]:
    if kind == "pdf":
        return inspect_pdf(path, page_mode, min_text_chars)
    if kind == "word":
        return inspect_word(path, suffix, min_text_chars)
    return {
        "integrity_status": "not_applicable",
        "page_count": None,
        "pages_analyzed": 0,
        "low_text_pages": None,
        "image_pages": None,
        "ocr_status": "not_applicable",
        "notes": "",
    }


def open_database(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS files (
          relative_path TEXT PRIMARY KEY,
          top_level TEXT NOT NULL,
          checklist_group TEXT NOT NULL,
          checklist_note TEXT NOT NULL,
          extension TEXT NOT NULL,
          kind TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          modified_ns INTEGER NOT NULL,
          integrity_status TEXT NOT NULL,
          page_count INTEGER,
          pages_analyzed INTEGER NOT NULL,
          low_text_pages INTEGER,
          image_pages INTEGER,
          ocr_status TEXT NOT NULL,
          notes TEXT NOT NULL,
          sha256 TEXT,
          analyzer_version TEXT NOT NULL,
          audited_utc TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS run_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """
    )
    return connection


def file_is_cached(
    connection: sqlite3.Connection,
    relative: str,
    size: int,
    modified_ns: int,
    analyzer_signature: str,
) -> bool:
    row = connection.execute(
        "SELECT 1 FROM files WHERE relative_path=? AND size_bytes=? AND modified_ns=? AND analyzer_version=?",
        (relative, size, modified_ns, analyzer_signature),
    ).fetchone()
    return row is not None


def upsert_file(connection: sqlite3.Connection, values: tuple[Any, ...]) -> None:
    connection.execute(
        """
        INSERT INTO files (
          relative_path, top_level, checklist_group, checklist_note, extension, kind,
          size_bytes, modified_ns, integrity_status, page_count, pages_analyzed,
          low_text_pages, image_pages, ocr_status, notes, sha256, analyzer_version, audited_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(relative_path) DO UPDATE SET
          top_level=excluded.top_level, checklist_group=excluded.checklist_group,
          checklist_note=excluded.checklist_note, extension=excluded.extension,
          kind=excluded.kind, size_bytes=excluded.size_bytes, modified_ns=excluded.modified_ns,
          integrity_status=excluded.integrity_status, page_count=excluded.page_count,
          pages_analyzed=excluded.pages_analyzed, low_text_pages=excluded.low_text_pages,
          image_pages=excluded.image_pages, ocr_status=excluded.ocr_status,
          notes=excluded.notes, sha256=NULL, analyzer_version=excluded.analyzer_version,
          audited_utc=excluded.audited_utc
        """,
        values,
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb", buffering=1024 * 1024) as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def exact_duplicate_hashes(connection: sqlite3.Connection, source: Path, issues: list[dict[str, str]]) -> None:
    candidate_rows = connection.execute(
        """
        SELECT relative_path, size_bytes, modified_ns, sha256
        FROM files
        WHERE kind IN ('pdf', 'word') AND size_bytes IN (
          SELECT size_bytes FROM files WHERE kind IN ('pdf', 'word') GROUP BY size_bytes HAVING COUNT(*) > 1
        )
        ORDER BY size_bytes, relative_path
        """
    ).fetchall()
    for index, (relative, size, modified_ns, existing_hash) in enumerate(candidate_rows, start=1):
        if existing_hash:
            continue
        path = source / Path(relative)
        try:
            stat = path.stat()
            if stat.st_size != size or stat.st_mtime_ns != modified_ns:
                issues.append({"path": relative, "stage": "hash", "error": "file changed after inventory; hash skipped"})
                continue
            digest = sha256_file(path)
            connection.execute("UPDATE files SET sha256=? WHERE relative_path=?", (digest, relative))
        except OSError as exc:
            issues.append({"path": relative, "stage": "hash", "error": str(exc)})
        if index % 25 == 0:
            connection.commit()
            print(f"Hashed {index}/{len(candidate_rows)} duplicate candidates", flush=True)
    connection.commit()


def normalized_duplicate_key(relative: str) -> str:
    name = Path(relative).stem.casefold()
    name = re.sub(r"[_\-.]+", " ", name)
    name = re.sub(r"\b(copy|final|draft|rev(?:ision)?|v(?:ersion)?)\b", " ", name)
    name = re.sub(r"\(\d+\)|\s+", " ", name)
    return name.strip()


def write_csv(path: Path, headers: list[str], rows: Iterable[Iterable[Any]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        writer.writerows(rows)


def export_reports(
    connection: sqlite3.Connection,
    output: Path,
    issues: list[dict[str, str]],
    source: Path,
    page_mode: str,
    min_text_chars: int,
) -> dict[str, Any]:
    columns = [row[1] for row in connection.execute("PRAGMA table_info(files)")]
    rows = connection.execute("SELECT * FROM files ORDER BY relative_path COLLATE NOCASE").fetchall()
    write_csv(output / "inventory.csv", columns, rows)

    exact_groups: dict[str, list[str]] = defaultdict(list)
    for relative, digest in connection.execute("SELECT relative_path, sha256 FROM files WHERE sha256 IS NOT NULL"):
        exact_groups[digest].append(relative)
    exact_groups = {digest: paths for digest, paths in exact_groups.items() if len(paths) > 1}
    write_csv(
        output / "exact-duplicates.csv",
        ["sha256", "copy_count", "relative_path"],
        ((digest, len(paths), path) for digest, paths in sorted(exact_groups.items()) for path in sorted(paths)),
    )

    possible_groups: dict[str, list[tuple[str, int, str | None]]] = defaultdict(list)
    for relative, size, digest in connection.execute(
        "SELECT relative_path, size_bytes, sha256 FROM files WHERE kind IN ('pdf', 'word')"
    ):
        key = normalized_duplicate_key(relative)
        if key:
            possible_groups[key].append((relative, size, digest))
    possible_groups = {key: values for key, values in possible_groups.items() if len(values) > 1}
    write_csv(
        output / "possible-variants.csv",
        ["normalized_name", "relative_path", "size_bytes", "sha256"],
        ((key, relative, size, digest or "") for key, values in sorted(possible_groups.items()) for relative, size, digest in values),
    )

    folder_rows = connection.execute(
        """
        SELECT top_level, checklist_group,
          COUNT(*), SUM(size_bytes),
          SUM(CASE WHEN kind='pdf' THEN 1 ELSE 0 END),
          SUM(CASE WHEN kind='word' THEN 1 ELSE 0 END),
          SUM(CASE WHEN integrity_status='broken' THEN 1 ELSE 0 END),
          SUM(CASE WHEN ocr_status IN ('ocr_candidate','ocr_candidate_after_render') THEN 1 ELSE 0 END),
          SUM(CASE WHEN ocr_status='partial_ocr_candidate' THEN 1 ELSE 0 END)
        FROM files GROUP BY top_level, checklist_group ORDER BY top_level COLLATE NOCASE
        """
    ).fetchall()
    write_csv(
        output / "folder-summary.csv",
        [
            "top_level", "checklist_group", "all_files", "size_bytes", "pdf_files", "word_files",
            "broken_documents", "ocr_candidates", "partial_ocr_candidates",
        ],
        folder_rows,
    )

    issue_rows = [(item["path"], item["stage"], item["error"]) for item in issues]
    write_csv(output / "scan-errors.csv", ["relative_path", "stage", "error"], issue_rows)

    counts = dict(connection.execute("SELECT kind, COUNT(*) FROM files GROUP BY kind").fetchall())
    statuses = dict(connection.execute("SELECT ocr_status, COUNT(*) FROM files GROUP BY ocr_status").fetchall())
    integrity = dict(connection.execute("SELECT integrity_status, COUNT(*) FROM files GROUP BY integrity_status").fetchall())
    extension_counts = dict(connection.execute("SELECT extension, COUNT(*) FROM files GROUP BY extension").fetchall())
    total_files, total_bytes = connection.execute("SELECT COUNT(*), COALESCE(SUM(size_bytes),0) FROM files").fetchone()
    summary = {
        "generated_utc": utc_now(),
        "source_root": str(source),
        "source_was_not_modified": True,
        "pdf_page_mode": page_mode,
        "minimum_alphanumeric_characters_per_page": min_text_chars,
        "excluded_top_level": sorted(EXCLUDED_TOP_LEVEL_STEMS),
        "reference_only_excluded": sorted(REFERENCE_ONLY_STEMS),
        "total_files": total_files,
        "total_bytes": total_bytes,
        "pdf_files": counts.get("pdf", 0),
        "word_files": counts.get("word", 0),
        "other_files": counts.get("other", 0),
        "extension_counts": extension_counts,
        "integrity_status_counts": integrity,
        "ocr_status_counts": statuses,
        "ocr_required_candidates": statuses.get("ocr_candidate", 0) + statuses.get("ocr_candidate_after_render", 0),
        "partial_ocr_candidates": statuses.get("partial_ocr_candidate", 0),
        "exact_duplicate_groups": len(exact_groups),
        "exact_duplicate_extra_copies": sum(len(paths) - 1 for paths in exact_groups.values()),
        "possible_variant_groups": len(possible_groups),
        "scan_error_count": len(issues),
        "classification_warning": (
            "OCR results are conservative candidates based on extractable text per page. "
            "Blank pages, plans, and drawings may require human confirmation before OCR procurement."
        ),
    }
    (output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="Read-only source corpus root")
    parser.add_argument("--output", required=True, type=Path, help="Local report directory outside source")
    parser.add_argument(
        "--page-mode",
        choices=("all", "sample"),
        default="all",
        help="Analyze every PDF page (authoritative count) or a five-page sample (faster estimate)",
    )
    parser.add_argument("--min-text-chars", type=int, default=40, help="Per-page alphanumeric threshold")
    parser.add_argument("--progress-every", type=int, default=100)
    parser.add_argument("--restart", action="store_true", help="Replace only the local audit database")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = args.source.resolve(strict=True)
    output = args.output.resolve(strict=False)
    ensure_output_is_local(source, output)
    output.mkdir(parents=True, exist_ok=True)
    database_path = output / "audit.sqlite3"
    if args.restart and database_path.exists():
        database_path.unlink()

    connection = open_database(database_path)
    issues: list[dict[str, str]] = []
    started = time.monotonic()
    enumerated = 0
    analyzed = 0
    cached = 0
    seen_paths: set[str] = set()
    analyzer_signature = f"{ANALYZER_VERSION}:{args.page_mode}:{args.min_text_chars}"

    connection.execute("INSERT OR REPLACE INTO run_meta VALUES ('source_root', ?)", (str(source),))
    connection.execute("INSERT OR REPLACE INTO run_meta VALUES ('started_utc', ?)", (utc_now(),))
    connection.execute("INSERT OR REPLACE INTO run_meta VALUES ('page_mode', ?)", (args.page_mode,))
    connection.commit()

    for path, top_level in iter_files(source, issues):
        enumerated += 1
        relative = str(path.relative_to(source))
        seen_paths.add(relative)
        try:
            stat = path.stat()
        except OSError as exc:
            issues.append({"path": relative, "stage": "stat", "error": str(exc)})
            continue
        if file_is_cached(connection, relative, stat.st_size, stat.st_mtime_ns, analyzer_signature):
            cached += 1
            continue

        suffix = path.suffix.casefold()
        kind = document_kind(suffix)
        group, group_note = checklist_group(top_level)
        details = inspect_file(path, kind, suffix, args.page_mode, args.min_text_chars)
        upsert_file(
            connection,
            (
                relative,
                top_level,
                group,
                group_note,
                suffix or "[none]",
                kind,
                stat.st_size,
                stat.st_mtime_ns,
                details["integrity_status"],
                details["page_count"],
                details["pages_analyzed"],
                details["low_text_pages"],
                details["image_pages"],
                details["ocr_status"],
                details["notes"],
                None,
                analyzer_signature,
                utc_now(),
            ),
        )
        analyzed += 1
        if enumerated % args.progress_every == 0:
            connection.commit()
            print(
                f"Enumerated {enumerated:,}; analyzed {analyzed:,}; resumed {cached:,}; "
                f"elapsed {(time.monotonic() - started) / 60:.1f} min",
                flush=True,
            )

    # Remove records for files that disappeared between resumable runs. This changes only local state.
    for (relative,) in connection.execute("SELECT relative_path FROM files").fetchall():
        if relative not in seen_paths:
            connection.execute("DELETE FROM files WHERE relative_path=?", (relative,))
    connection.commit()

    print("Metadata/content inspection complete; confirming exact duplicates by SHA-256", flush=True)
    exact_duplicate_hashes(connection, source, issues)
    summary = export_reports(connection, output, issues, source, args.page_mode, args.min_text_chars)
    connection.execute("INSERT OR REPLACE INTO run_meta VALUES ('completed_utc', ?)", (utc_now(),))
    connection.commit()
    connection.close()

    print(json.dumps(summary, indent=2), flush=True)
    print(f"Reports: {output}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
