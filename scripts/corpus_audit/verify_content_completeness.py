#!/usr/bin/env python3
"""Compare the accepted corpus payload with an independent PDFium text pass."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pypdfium2 as pdfium


TOKEN = re.compile(r"[^\W_]+(?:[-'’][^\W_]+)*", re.UNICODE)


def counts(text: str) -> tuple[int, int]:
    words = TOKEN.findall(text)
    return len(words), sum(len(word) for word in words)


def merge_text_chunks(chunks: list[str], overlap_limit: int = 600) -> str:
    """Reconstruct the primary page text without counting chunk overlap twice."""
    if not chunks:
        return ""
    merged = chunks[0]
    for chunk in chunks[1:]:
        overlap = 0
        for size in range(min(overlap_limit, len(merged), len(chunk)), 0, -1):
            if merged.endswith(chunk[:size]):
                overlap = size
                break
        merged += chunk[overlap:]
    return merged


def meaningful_shortfall(source_words: int, source_chars: int, extracted_words: int, extracted_chars: int) -> bool:
    if source_words < 100 or source_chars < 500:
        return False
    word_ratio = extracted_words / source_words if source_words else 1.0
    char_ratio = extracted_chars / source_chars if source_chars else 1.0
    return (
        word_ratio < 0.80
        and char_ratio < 0.80
        and source_words - extracted_words >= 50
        and source_chars - extracted_chars >= 250
    )


def meaningful_page_shortfall(source_words: int, source_chars: int, extracted_words: int, extracted_chars: int) -> bool:
    if source_words < 50 or source_chars < 250:
        return False
    word_ratio = extracted_words / source_words if source_words else 1.0
    char_ratio = extracted_chars / source_chars if source_chars else 1.0
    return (
        word_ratio < 0.65
        and char_ratio < 0.65
        and source_words - extracted_words >= 25
        and source_chars - extracted_chars >= 125
    )


def extract_pdfium_pages(path: Path) -> list[str]:
    document = pdfium.PdfDocument(path)
    pages: list[str] = []
    try:
        for index in range(len(document)):
            page = document[index]
            text_page = page.get_textpage()
            try:
                pages.append(text_page.get_text_range())
            finally:
                text_page.close()
                page.close()
    finally:
        document.close()
    return pages


def inspect_document(document: dict[str, Any], originals: Path) -> dict[str, Any]:
    path = originals / document["fileName"]
    actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    extracted_by_page: dict[int, list[str]] = {}
    for chunk in document["chunks"]:
        # Tables are separately searchable atomic evidence derived from the same
        # page and would double-count text here. Compare PDFium only with the
        # pipeline's primary plain-text chunks.
        if chunk.get("kind") == "text":
            extracted_by_page.setdefault(int(chunk["pageNumber"]), []).append(chunk["content"])

    try:
        source_pages = extract_pdfium_pages(path)
        independent_error = None
    except Exception as exc:  # pragma: no cover - real-corpus evidence path
        source_pages = []
        independent_error = f"{type(exc).__name__}: {exc}"

    page_rows = []
    for page_number in range(1, max(len(source_pages), max(extracted_by_page, default=0)) + 1):
        source_text = source_pages[page_number - 1] if page_number <= len(source_pages) else ""
        extracted_text = merge_text_chunks(extracted_by_page.get(page_number, []))
        source_words, source_chars = counts(source_text)
        extracted_words, extracted_chars = counts(extracted_text)
        page_rows.append(
            {
                "page": page_number,
                "sourceWords": source_words,
                "sourceCharacters": source_chars,
                "extractedWords": extracted_words,
                "extractedCharacters": extracted_chars,
                "wordCoverage": round(extracted_words / source_words, 6) if source_words else None,
                "characterCoverage": round(extracted_chars / source_chars, 6) if source_chars else None,
                "meaningfulShortfall": meaningful_page_shortfall(
                    source_words, source_chars, extracted_words, extracted_chars
                ),
            }
        )

    source_words = sum(row["sourceWords"] for row in page_rows)
    source_chars = sum(row["sourceCharacters"] for row in page_rows)
    extracted_words = sum(row["extractedWords"] for row in page_rows)
    extracted_chars = sum(row["extractedCharacters"] for row in page_rows)
    declared_pages = int(document["integrity"]["expectedPages"])
    page_count_match = len(source_pages) == declared_pages
    short_pages = [row for row in page_rows if row["meaningfulShortfall"]]
    reasons = []
    if independent_error:
        reasons.append("independent_reader_error")
    if actual_hash != document["sourceHash"]:
        reasons.append("source_hash_mismatch")
    if not page_count_match:
        reasons.append("page_count_mismatch")
    if meaningful_shortfall(source_words, source_chars, extracted_words, extracted_chars):
        reasons.append("document_text_shortfall")
    if short_pages:
        reasons.append("page_text_shortfall")

    return {
        "sourceId": document["sourceId"],
        "title": document["title"],
        "fileName": document["fileName"],
        "sourceHashMatches": actual_hash == document["sourceHash"],
        "sourcePages": len(source_pages),
        "declaredPages": declared_pages,
        "extractedPagesWithContent": len(extracted_by_page),
        "pageCountMatches": page_count_match,
        "sourceWords": source_words,
        "sourceCharacters": source_chars,
        "extractedWords": extracted_words,
        "extractedCharacters": extracted_chars,
        "wordCoverage": round(extracted_words / source_words, 6) if source_words else None,
        "characterCoverage": round(extracted_chars / source_chars, 6) if source_chars else None,
        "shortfallPages": [row["page"] for row in short_pages],
        "reasons": reasons,
        "passed": not reasons,
        "independentReader": "PDFium 5.13.0",
        "independentReaderError": independent_error,
        "pages": page_rows if reasons else [],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", type=Path, required=True)
    parser.add_argument("--originals", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Reserved for compatibility. PDFium is intentionally run serially in-process.",
    )
    args = parser.parse_args()

    payload = json.loads(args.payload.read_text(encoding="utf-8"))
    documents = payload["documents"]
    # PDFium's process-global state is not safe under concurrent Python threads:
    # a two-thread corpus pass produced spurious "Failed to load page" errors on
    # valid PDFs. Keep this independent verification pass serial and deterministic.
    final_results = []
    for completed, document in enumerate(documents, start=1):
        final_results.append(inspect_document(document, args.originals))
        if completed % 25 == 0 or completed == len(documents):
            print(f"Independent completeness audit: {completed}/{len(documents)}")
    flagged = [result for result in final_results if not result["passed"]]
    summary = {
        "status": "complete",
        "independentReader": "PDFium 5.13.0",
        "acceptedDocuments": len(final_results),
        "passedFullCoverage": len(final_results) - len(flagged),
        "meaningfulShortfallOrError": len(flagged),
        "pageCountMismatches": sum(not result["pageCountMatches"] for result in final_results),
        "sourceHashMismatches": sum(not result["sourceHashMatches"] for result in final_results),
        "thresholds": {
            "document": "both word and normalized-character coverage below 80%, with at least 50 words and 250 characters missing",
            "page": "both word and normalized-character coverage below 65%, with at least 25 words and 125 characters missing",
            "minimumIndependentText": "100 words/500 characters per document; 50 words/250 characters per page",
        },
        "flaggedSourceIds": [result["sourceId"] for result in flagged],
    }

    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "completeness-report.json").write_text(
        json.dumps({"summary": summary, "flagged": flagged, "documents": final_results}, indent=2),
        encoding="utf-8",
    )
    with (args.output_dir / "completeness-report.csv").open("w", newline="", encoding="utf-8-sig") as stream:
        fields = [
            "sourceId", "title", "sourcePages", "declaredPages", "extractedPagesWithContent",
            "sourceWords", "extractedWords", "wordCoverage", "sourceCharacters",
            "extractedCharacters", "characterCoverage", "passed", "shortfallPages", "reasons",
        ]
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for result in final_results:
            writer.writerow({
                key: ";".join(map(str, result[key])) if isinstance(result.get(key), list) else result.get(key)
                for key in fields
            })
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
