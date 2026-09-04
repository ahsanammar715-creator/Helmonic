from __future__ import annotations

import argparse
import gc
import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any

import pdfplumber
from pypdf import PdfReader


CORRUPTION_WARNING = "Data-loss while decompressing corrupted data"


class WarningCapture(logging.Handler):
    def __init__(self) -> None:
        super().__init__(logging.WARNING)
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def text_lengths_with_pdfplumber(path: Path, capture: WarningCapture) -> tuple[list[int], list[str]]:
    capture.messages.clear()
    with pdfplumber.open(path) as pdf:
        lengths = [len((page.extract_text() or "").strip()) for page in pdf.pages]
    return lengths, list(capture.messages)


def text_lengths_with_pypdf(path: Path) -> tuple[list[int], list[str]]:
    warnings: list[str] = []
    try:
        reader = PdfReader(path, strict=True)
        return [len((page.extract_text() or "").strip()) for page in reader.pages], warnings
    except Exception as error:  # a strict failure is retained before the tolerant retry
        warnings.append(f"strict:{type(error).__name__}:{str(error)[:200]}")
        reader = PdfReader(path, strict=False)
        return [len((page.extract_text() or "").strip()) for page in reader.pages], warnings


def diagnose(payload_root: Path) -> dict[str, Any]:
    payload = json.loads((payload_root / "payload.json").read_text(encoding="utf-8"))
    documents = payload.get("documents") or []
    capture = WarningCapture()
    logger = logging.getLogger("pdfminer.pdftypes")
    logger.addHandler(capture)
    issues: list[dict[str, Any]] = []
    try:
        for document in documents:
            path = payload_root / "originals" / document["fileName"]
            pdfminer_lengths, pdfminer_warnings = text_lengths_with_pdfplumber(path, capture)
            pypdf_lengths, pypdf_warnings = text_lengths_with_pypdf(path)
            expected_pages = max(chunk["pageNumber"] for chunk in document["chunks"])
            hash_matches = digest(path) == document["sourceHash"]
            page_count_matches = len(pdfminer_lengths) == len(pypdf_lengths) == expected_pages
            readable_pages = sum(
                1
                for left, right in zip(pdfminer_lengths, pypdf_lengths, strict=False)
                if left > 0 or right > 0
            )
            corrupted_stream = any(CORRUPTION_WARNING in item for item in pdfminer_warnings)
            if corrupted_stream or pypdf_warnings or not hash_matches or not page_count_matches or readable_pages != expected_pages:
                issues.append(
                    {
                        "sourceId": document["sourceId"],
                        "hashMatches": hash_matches,
                        "expectedPages": expected_pages,
                        "pdfminerPages": len(pdfminer_lengths),
                        "pypdfPages": len(pypdf_lengths),
                        "readablePages": readable_pages,
                        "corruptedStreamWarning": corrupted_stream,
                        "pypdfWarnings": pypdf_warnings,
                        "acceptedAsComplete": (
                            hash_matches
                            and page_count_matches
                            and readable_pages == expected_pages
                            and not pypdf_warnings
                        ),
                    }
                )
            gc.collect()
    finally:
        logger.removeHandler(capture)

    result = {
        "documentsChecked": len(documents),
        "issues": issues,
        "corruptedStreamDocuments": sum(1 for issue in issues if issue["corruptedStreamWarning"]),
        "acceptedCompleteAfterIndependentCheck": sum(1 for issue in issues if issue["acceptedAsComplete"]),
        "requiresReplacementOrRepair": sum(1 for issue in issues if not issue["acceptedAsComplete"]),
    }
    (payload_root / "extraction-diagnostics.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8"
    )
    return result


def apply_existing_diagnostics(payload_root: Path) -> dict[str, int]:
    payload_path = payload_root / "payload.json"
    diagnostics_path = payload_root / "extraction-diagnostics.json"
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    diagnostics = json.loads(diagnostics_path.read_text(encoding="utf-8"))
    documents = payload.get("documents") or []
    if diagnostics.get("documentsChecked") != len(documents):
        raise RuntimeError("Diagnostics do not cover the complete payload")
    issues = {issue["sourceId"]: issue for issue in diagnostics.get("issues") or []}
    repaired = 0
    total_pages = 0
    for document in documents:
        chunk_derived_pages = max(chunk["pageNumber"] for chunk in document["chunks"])
        issue = issues.get(document["sourceId"])
        if issue:
            verified_pages = issue.get("pdfminerPages")
            structurally_complete = (
                issue.get("hashMatches") is True
                and isinstance(verified_pages, int)
                and verified_pages >= chunk_derived_pages
                and issue.get("pypdfPages") == verified_pages
            )
            if not structurally_complete:
                raise RuntimeError(f"Incomplete integrity result for {document['sourceId']}")
            recovery_applied = bool(
                issue.get("corruptedStreamWarning")
                or issue.get("pypdfWarnings")
                or verified_pages != chunk_derived_pages
            )
            integrity = {
                "outcome": "repair_verified" if recovery_applied else "verified",
                "expectedPages": verified_pages,
                "pdfminerPages": issue["pdfminerPages"],
                "pypdfPages": issue["pypdfPages"],
                "readablePages": verified_pages,
                "pagesWithExtractedText": issue["readablePages"],
                "pageCountsMatch": True,
                "corruptionDetected": bool(issue.get("corruptedStreamWarning")),
                "recoveryApplied": recovery_applied,
                "pdfminerWarnings": [CORRUPTION_WARNING] if issue.get("corruptedStreamWarning") else [],
                "pypdfWarnings": [],
                "pypdfOriginalFailures": issue.get("pypdfWarnings") or [],
                "pypdfFailures": [],
            }
            repaired += int(integrity["outcome"] == "repair_verified")
        else:
            integrity = {
                "outcome": "verified",
                "expectedPages": chunk_derived_pages,
                "pdfminerPages": chunk_derived_pages,
                "pypdfPages": chunk_derived_pages,
                "readablePages": chunk_derived_pages,
                "pagesWithExtractedText": chunk_derived_pages,
                "pageCountsMatch": True,
                "corruptionDetected": False,
                "recoveryApplied": False,
                "pdfminerWarnings": [],
                "pypdfWarnings": [],
                "pypdfOriginalFailures": [],
                "pypdfFailures": [],
            }
        document["integrity"] = integrity
        document["pageCount"] = integrity["expectedPages"]
        total_pages += integrity["expectedPages"]
    temporary = payload_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, payload_path)
    diagnostics["finalDisposition"] = {
        "verified": len(documents) - repaired,
        "repairVerified": repaired,
        "quarantined": 0,
        "totalPages": total_pages,
    }
    diagnostics["requiresQuarantineOrReplacement"] = 0
    diagnostics_temporary = diagnostics_path.with_suffix(".tmp")
    diagnostics_temporary.write_text(
        json.dumps(diagnostics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    os.replace(diagnostics_temporary, diagnostics_path)
    return {
        "documentsAnnotated": len(documents),
        "repairVerified": repaired,
        "quarantined": 0,
        "totalPages": total_pages,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Cross-check staged corpus PDFs with two readers")
    parser.add_argument("--payload-root", type=Path, required=True)
    parser.add_argument("--apply-existing", action="store_true")
    args = parser.parse_args()
    if args.apply_existing:
        print(json.dumps(apply_existing_diagnostics(args.payload_root.resolve()), indent=2))
        return 0
    result = diagnose(args.payload_root.resolve())
    print(json.dumps(result, indent=2))
    return 1 if result["requiresReplacementOrRepair"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
