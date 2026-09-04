from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

import pdfplumber


BATCH_ID = "corpus-pilot-100-v1"
PERMISSION_SCOPE = "iAcoustics"
MAX_CHARS = 4_500
OVERLAP_CHARS = 300
GROUP_QUOTAS = {
    "IA-02.2": 40,
    "IA-13": 15,
    "IA-04": 10,
    "IOA Bulletin": 10,
    "Third Party Acoustic Reports": 10,
    "IA-02.1": 10,
    "IA-08": 2,
    "IA-12": 1,
    "IA-14": 2,
}


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def eligible(row: dict[str, Any]) -> bool:
    return (
        row.get("search_state") == "candidate"
        and row.get("is_canonical") is True
        and row.get("processing_lane") == "pdf_extract_embed"
        and row.get("extension") == ".pdf"
        and row.get("integrity_status") == "ok"
        and row.get("ocr_status") == "text_extractable"
        and row.get("top_level") in GROUP_QUOTAS
    )


def stable_selection_key(row: dict[str, Any]) -> tuple[str, str]:
    material = f"{BATCH_ID}\0{row['source_id']}\0{row.get('sha256') or 'capture-hash-required'}".encode("utf-8")
    return hashlib.sha256(material).hexdigest(), row["source_id"]


def select_rows(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates = [row for row in rows if eligible(row)]
    selected: list[dict[str, Any]] = []
    for group, quota in GROUP_QUOTAS.items():
        group_rows = sorted(
            (row for row in candidates if row["top_level"] == group),
            key=stable_selection_key,
        )
        if len(group_rows) < quota:
            raise RuntimeError(f"{group} has {len(group_rows)} eligible PDFs; {quota} required")
        selected.extend(group_rows[:quota])
    if len(selected) != 100 or len({row["source_id"] for row in selected}) != 100:
        raise RuntimeError("The corpus pilot selection must contain exactly 100 unique sources")
    return sorted(selected, key=lambda row: row["source_id"])


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


def payload_document(row: dict[str, Any], source_root: Path, originals: Path) -> tuple[dict[str, Any], dict[str, int]]:
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

    file_name = f"{row['source_id']}.pdf"
    staged = originals / file_name
    shutil.copyfile(source, staged)
    if digest(staged) != source_hash:
        raise RuntimeError(f"Staged copy hash mismatch for {row['source_id']}")

    chunks: list[dict[str, Any]] = []
    table_pages: set[int] = set()
    with pdfplumber.open(staged) as pdf:
        if len(pdf.pages) != int(row["page_count"]):
            raise RuntimeError(f"Page-count drift for {row['source_id']}")
        for page_number, page in enumerate(pdf.pages, start=1):
            for ordinal, content in enumerate(split_text(page.extract_text() or ""), start=1):
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
    if not chunks:
        raise RuntimeError(f"No extractable content for {row['source_id']}")

    return (
        {
            "sourceId": row["source_id"],
            "title": Path(row["relative_path"]).name,
            "fileName": file_name,
            "sourceHash": source_hash,
            "permissionScope": PERMISSION_SCOPE,
            "citationNamespace": "D",
            "tablePageNumbers": sorted(table_pages),
            "chunks": chunks,
        },
        {"pages": len(pdf.pages), "chunks": len(chunks), "tablePages": len(table_pages)},
    )


def build(args: argparse.Namespace) -> dict[str, Any]:
    output = args.output_dir.resolve()
    if output.exists():
        raise RuntimeError(f"Output already exists: {output}")
    output.mkdir(parents=True)
    originals = output / "originals"
    originals.mkdir()

    selected = select_rows(read_jsonl(args.manifest.resolve()))
    documents: list[dict[str, Any]] = []
    totals = Counter()
    for row in selected:
        document, metrics = payload_document(row, args.source_root.resolve(), originals)
        documents.append(document)
        totals.update(metrics)

    payload = {
        "batch": {
            "id": BATCH_ID,
            "selection": "deterministic-category-balanced-pipeline-validation",
            "promotionReady": False,
            "promotionBlocker": "consultant-ranked sources and known-answer evaluation are pending",
        },
        "extraction": {"version": 2, "tableStrategy": "atomic-markdown-or-key-value"},
        "documents": documents,
    }
    (output / "payload.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    summary = {
        "batchId": BATCH_ID,
        "documentCount": len(documents),
        "bytes": sum(int(row["size_bytes"]) for row in selected),
        "pages": totals["pages"],
        "chunks": totals["chunks"],
        "tablePages": totals["tablePages"],
        "permissionScope": PERMISSION_SCOPE,
        "groupCounts": dict(sorted(Counter(row["top_level"] for row in selected).items())),
        "promotionReady": False,
    }
    (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the private 100-PDF corpus pilot payload")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    print(json.dumps(build(parse_args()), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
