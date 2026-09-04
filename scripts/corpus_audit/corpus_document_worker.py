from __future__ import annotations

import argparse
import gc
import hashlib
import json
import logging
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any


MAX_CHARS = 4_500
OVERLAP_CHARS = 300
CORRUPTION_WARNING = "Data-loss while decompressing corrupted data"


class WarningCapture(logging.Handler):
    def __init__(self) -> None:
        super().__init__(logging.WARNING)
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage()[:500])


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def compact(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def useful_table(table: list[list[object]]) -> bool:
    populated = [row for row in table if any(compact(cell) for cell in row)]
    width = max((sum(bool(compact(cell)) for cell in row) for row in populated), default=0)
    return len(populated) >= 2 and width >= 2


def table_markdown(table: list[list[object]], ordinal: int) -> str:
    width = max(len(row) for row in table)
    rows = [list(row) + [""] * (width - len(row)) for row in table]
    header = [compact(cell).replace("|", "\\|") or f"Column {index + 1}" for index, cell in enumerate(rows[0])]
    body = [[compact(cell).replace("|", "\\|") for cell in row] for row in rows[1:]]
    lines = [
        f"Table {ordinal}",
        f"| {' | '.join(header)} |",
        f"| {' | '.join('---' for _ in header)} |",
    ]
    lines.extend(f"| {' | '.join(row)} |" for row in body)
    return "\n".join(lines)


def split_text(text: str) -> list[str]:
    normalized = re.sub(r"[ \t]+", " ", text).strip()
    if not normalized:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(start + MAX_CHARS, len(normalized))
        if end < len(normalized):
            boundary = max(normalized.rfind("\n", start, end), normalized.rfind(". ", start, end))
            if boundary > start + MAX_CHARS // 2:
                end = boundary + 1
        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(normalized):
            break
        start = max(end - OVERLAP_CHARS, start + 1)
    return chunks


def integrity_decision(
    *,
    expected_pages: int,
    pdfminer_lengths: list[int],
    pypdf_lengths: list[int],
    pdfminer_warnings: list[str],
    pypdf_unresolved_failures: list[str],
    recovery_applied: bool = False,
) -> dict[str, Any]:
    page_counts_match = len(pdfminer_lengths) == len(pypdf_lengths) == expected_pages
    pages_with_extracted_text = sum(
        1
        for left, right in zip(pdfminer_lengths, pypdf_lengths, strict=False)
        if left > 0 or right > 0
    )
    readable_pages = min(len(pdfminer_lengths), len(pypdf_lengths))
    corruption_detected = any(CORRUPTION_WARNING in warning for warning in pdfminer_warnings)
    complete = page_counts_match and readable_pages == expected_pages and not pypdf_unresolved_failures
    if not complete:
        outcome = "quarantine"
    elif corruption_detected or recovery_applied:
        outcome = "repair_verified"
    else:
        outcome = "verified"
    return {
        "outcome": outcome,
        "expectedPages": expected_pages,
        "pdfminerPages": len(pdfminer_lengths),
        "pypdfPages": len(pypdf_lengths),
        "readablePages": readable_pages,
        "pagesWithExtractedText": pages_with_extracted_text,
        "pageCountsMatch": page_counts_match,
        "corruptionDetected": corruption_detected,
        "recoveryApplied": recovery_applied or corruption_detected,
        "pdfminerWarnings": pdfminer_warnings,
        "pypdfFailures": pypdf_unresolved_failures,
    }


def extract_with_two_readers(staged: Path, row: dict[str, Any]) -> tuple[dict[str, Any], dict[str, int]]:
    import pdfplumber
    from pypdf import PdfReader

    pdfminer_capture = WarningCapture()
    pypdf_capture = WarningCapture()
    pdfminer_logger = logging.getLogger("pdfminer.pdftypes")
    pypdf_logger = logging.getLogger("pypdf")
    pdfminer_logger.addHandler(pdfminer_capture)
    pypdf_logger.addHandler(pypdf_capture)
    chunks: list[dict[str, Any]] = []
    table_pages: set[int] = set()
    pdfminer_lengths: list[int] = []
    try:
        with pdfplumber.open(staged) as pdf:
            if len(pdf.pages) != int(row["page_count"]):
                raise RuntimeError(f"Page-count drift for {row['source_id']}")
            for page_number, page in enumerate(pdf.pages, start=1):
                page_text = page.extract_text() or ""
                pdfminer_lengths.append(len(page_text.strip()))
                for ordinal, content in enumerate(split_text(page_text), start=1):
                    chunk_id = f"{row['source_id']}-p{page_number:04d}-c{ordinal:03d}"
                    chunks.append(
                        {
                            "chunkId": chunk_id,
                            "section": f"Page {page_number}",
                            "pageNumber": page_number,
                            "content": content,
                            "contentHash": hashlib.sha256(content.encode("utf-8")).hexdigest(),
                            "kind": "text",
                            "contentFormat": "plain_text",
                            "atomic": False,
                        }
                    )
                tables = [table for table in (page.extract_tables() or []) if useful_table(table)]
                for ordinal, table in enumerate(tables, start=1):
                    content = table_markdown(table, ordinal)
                    chunk_id = f"{row['source_id']}-p{page_number:04d}-t{ordinal:03d}"
                    chunks.append(
                        {
                            "chunkId": chunk_id,
                            "section": f"Page {page_number} table {ordinal}",
                            "pageNumber": page_number,
                            "content": content,
                            "contentHash": hashlib.sha256(content.encode("utf-8")).hexdigest(),
                            "kind": "table",
                            "contentFormat": "markdown",
                            "atomic": True,
                        }
                    )
                    table_pages.add(page_number)

        pypdf_original_failures: list[str] = []
        try:
            reader = PdfReader(staged, strict=True)
            pypdf_lengths = [len((page.extract_text() or "").strip()) for page in reader.pages]
        except Exception as error:
            pypdf_original_failures.append(f"strict:{type(error).__name__}:{str(error)[:200]}")
            reader = PdfReader(staged, strict=False)
            pypdf_lengths = [len((page.extract_text() or "").strip()) for page in reader.pages]
    finally:
        pdfminer_logger.removeHandler(pdfminer_capture)
        pypdf_logger.removeHandler(pypdf_capture)

    integrity = integrity_decision(
        expected_pages=int(row["page_count"]),
        pdfminer_lengths=pdfminer_lengths,
        pypdf_lengths=pypdf_lengths,
        pdfminer_warnings=pdfminer_capture.messages,
        pypdf_unresolved_failures=[],
        recovery_applied=bool(pypdf_original_failures),
    )
    integrity["pypdfWarnings"] = pypdf_capture.messages
    integrity["pypdfOriginalFailures"] = pypdf_original_failures
    if integrity["outcome"] == "quarantine":
        raise RuntimeError(f"Two-reader integrity check requires quarantine for {row['source_id']}")
    if not chunks:
        raise RuntimeError(f"No extractable content for {row['source_id']}")

    document = {
        "sourceId": row["source_id"],
        "title": Path(row["relative_path"]).name,
        "fileName": staged.name,
        "sourceHash": digest(staged),
        "permissionScope": "iAcoustics",
        "citationNamespace": "D",
        "tablePageNumbers": sorted(table_pages),
        "pageCount": integrity["expectedPages"],
        "integrity": integrity,
        "chunks": chunks,
    }
    metrics = {
        "pages": len(pdfminer_lengths),
        "chunks": len(chunks),
        "tablePages": len(table_pages),
    }
    return document, metrics


def process(request_path: Path) -> dict[str, Any]:
    request = json.loads(request_path.read_text(encoding="utf-8"))
    row = request["row"]
    source_root = Path(request["sourceRoot"])
    originals = Path(request["originals"])
    result_path = Path(request["resultPath"])
    source = source_root / Path(row["relative_path"])
    if not source.is_file():
        raise RuntimeError(f"Approved source is unavailable for {row['source_id']}")
    stat_before = source.stat()
    if stat_before.st_size != int(row["size_bytes"]) or stat_before.st_mtime_ns != int(row["modified_ns"]):
        raise RuntimeError(f"Approved source changed after audit for {row['source_id']}")
    source_hash = digest(source)
    stat_after = source.stat()
    if stat_after.st_size != stat_before.st_size or stat_after.st_mtime_ns != stat_before.st_mtime_ns:
        raise RuntimeError(f"Approved source changed while hashing for {row['source_id']}")
    if row.get("sha256") and source_hash != row["sha256"]:
        raise RuntimeError(f"Approved source hash changed after audit for {row['source_id']}")

    originals.mkdir(parents=True, exist_ok=True)
    staged = originals / f"{row['source_id']}.pdf"
    with tempfile.NamedTemporaryFile(dir=originals, suffix=".partial", delete=False) as handle:
        partial = Path(handle.name)
    try:
        shutil.copyfile(source, partial)
        if digest(partial) != source_hash:
            raise RuntimeError(f"Staged copy hash mismatch for {row['source_id']}")
        os.replace(partial, staged)
    finally:
        partial.unlink(missing_ok=True)

    try:
        document, metrics = extract_with_two_readers(staged, row)
        if document["sourceHash"] != source_hash:
            raise RuntimeError(f"Staged source changed during extraction for {row['source_id']}")
        result = {"document": document, "metrics": metrics}
        result_path.parent.mkdir(parents=True, exist_ok=True)
        temp_result = result_path.with_suffix(".tmp")
        temp_result.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
        os.replace(temp_result, result_path)
        return result
    except Exception:
        staged.unlink(missing_ok=True)
        raise
    finally:
        gc.collect()


def main() -> int:
    parser = argparse.ArgumentParser(description="Process and verify one corpus PDF")
    parser.add_argument("--request", type=Path, required=True)
    process(parser.parse_args().request.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
