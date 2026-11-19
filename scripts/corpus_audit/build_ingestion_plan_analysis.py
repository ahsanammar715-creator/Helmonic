from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


READY_PDF = {"kind": "pdf", "integrity_status": "ok", "ocr_status": "text_extractable"}
READY_WORD = {"kind": "word", "integrity_status": "ok", "ocr_status": "not_required"}
CLASSIFICATION_HOLDS = {"UNMAPPED:IA-21", "IA-06/IA-07-candidate"}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def matches(row: dict[str, str], expected: dict[str, str]) -> bool:
    return all(row.get(key) == value for key, value in expected.items())


def identity(row: dict[str, str]) -> str:
    digest = row.get("sha256", "")
    return f"sha256:{digest}" if digest else f"path:{row['relative_path']}"


def unique_by_identity(rows: list[dict[str, str]]) -> dict[str, list[dict[str, str]]]:
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        grouped[identity(row)].append(row)
    return grouped


def analyze(audit_dir: Path) -> dict[str, Any]:
    summary = json.loads((audit_dir / "summary.json").read_text(encoding="utf-8"))
    inventory = read_csv(audit_dir / "inventory.csv")
    folder_summary = read_csv(audit_dir / "folder-summary.csv")
    exact_duplicates = read_csv(audit_dir / "exact-duplicates.csv")
    possible_variants = read_csv(audit_dir / "possible-variants.csv")
    scan_errors = read_csv(audit_dir / "scan-errors.csv")

    documents = [row for row in inventory if row["kind"] in {"pdf", "word"}]
    ready = [row for row in documents if matches(row, READY_PDF) or matches(row, READY_WORD)]
    ready_identities = unique_by_identity(ready)
    eligible = [row for row in ready if row["checklist_group"] not in CLASSIFICATION_HOLDS]
    eligible_identities = unique_by_identity(eligible)
    held = [row for row in ready if row["checklist_group"] in CLASSIFICATION_HOLDS]
    held_identities = unique_by_identity(held)
    cross_category_holds = set(eligible_identities) & set(held_identities)
    strict_eligible_identities = {
        key: rows for key, rows in eligible_identities.items() if key not in cross_category_holds
    }

    exact_groups = defaultdict(list)
    for row in exact_duplicates:
        exact_groups[row["sha256"]].append(row)

    variant_groups = defaultdict(list)
    for row in possible_variants:
        variant_groups[row["normalized_name"]].append(row)
    exact_only_variant_groups = sum(
        1
        for rows in variant_groups.values()
        if len({row["sha256"] for row in rows}) == 1 and rows[0]["sha256"]
    )

    inventory_bytes = sum(int(row["size_bytes"]) for row in inventory)
    document_bytes = sum(int(row["size_bytes"]) for row in documents)
    eligible_unique_bytes = sum(
        int(sorted(rows, key=lambda row: row["relative_path"].casefold())[0]["size_bytes"])
        for rows in strict_eligible_identities.values()
    )

    duplicate_paths = len(inventory) - len({row["relative_path"].casefold() for row in inventory})
    nonbroken_pdfs_missing_pages = sum(
        1
        for row in documents
        if row["kind"] == "pdf"
        and row["integrity_status"] != "broken"
        and not row["page_count"]
    )

    checks = {
        "summary_row_count_matches_inventory": summary["total_files"] == len(inventory),
        "summary_byte_count_matches_inventory": summary["total_bytes"] == inventory_bytes,
        "folder_rows_match_inventory": sum(int(row["all_files"]) for row in folder_summary) == len(inventory),
        "folder_pdf_count_matches": sum(int(row["pdf_files"]) for row in folder_summary) == summary["pdf_files"],
        "folder_word_count_matches": sum(int(row["word_files"]) for row in folder_summary) == summary["word_files"],
        "relative_paths_are_unique": duplicate_paths == 0,
        "file_sizes_are_nonnegative": all(int(row["size_bytes"]) >= 0 for row in inventory),
        "nonbroken_pdfs_have_page_counts": nonbroken_pdfs_missing_pages == 0,
        "all_pdf_pages_were_requested": summary["pdf_page_mode"] == "all",
        "source_write_guard_reported_clean": summary["source_was_not_modified"] is True,
        "filesystem_scan_errors_are_zero": len(scan_errors) == 0,
    }

    by_top_level: list[dict[str, Any]] = []
    for top_level, rows in sorted(
        ((name, [row for row in documents if row["top_level"] == name])
         for name in {row["top_level"] for row in documents}),
        key=lambda pair: (-len(pair[1]), pair[0].casefold()),
    ):
        by_top_level.append(
            {
                "top_level": top_level,
                "documents": len(rows),
                "bytes": sum(int(row["size_bytes"]) for row in rows),
                "direct_pdf_ready": sum(1 for row in rows if matches(row, READY_PDF)),
                "word_render_candidates": sum(1 for row in rows if matches(row, READY_WORD)),
                "strong_ocr_candidates": sum(
                    1 for row in rows
                    if row["ocr_status"] in {"ocr_candidate", "ocr_candidate_after_render"}
                ),
                "partial_ocr_candidates": sum(
                    1 for row in rows if row["ocr_status"] == "partial_ocr_candidate"
                ),
                "broken": sum(1 for row in rows if row["integrity_status"] == "broken"),
            }
        )

    eligible_unique_by_kind = Counter()
    for rows in strict_eligible_identities.values():
        kinds = {row["kind"] for row in rows}
        # A byte-identical cross-format file is malformed; expose it rather than guessing.
        eligible_unique_by_kind[next(iter(kinds)) if len(kinds) == 1 else "mixed"] += 1

    result = {
        "snapshot": {
            "generated_utc": summary["generated_utc"],
            "page_mode": summary["pdf_page_mode"],
            "inventory_files": len(inventory),
            "inventory_bytes": inventory_bytes,
        },
        "quality": {
            "status": "pass" if all(checks.values()) else "fail",
            "checks": checks,
            "known_limitations": [
                "Word page counts do not exist until render-to-PDF validation runs.",
                "Possible filename variants are review candidates, not proven duplicates.",
                "OCR candidates include possible blank/drawing false positives pending human review.",
                "The snapshot does not prove that the source share remained unchanged after the audit timestamp.",
            ],
        },
        "corpus": {
            "pdf_word_documents": len(documents),
            "pdf_word_bytes": document_bytes,
            "pdf_word_share_of_all_bytes": document_bytes / inventory_bytes,
            "pdf_files": sum(1 for row in documents if row["kind"] == "pdf"),
            "word_files": sum(1 for row in documents if row["kind"] == "word"),
            "direct_pdf_ready_before_dedupe": sum(1 for row in ready if row["kind"] == "pdf"),
            "word_render_candidates_before_dedupe": sum(1 for row in ready if row["kind"] == "word"),
            "technically_ready_unique": len(ready_identities),
            "eligible_unique_before_cross_category_hold": len(eligible_identities),
            "cross_category_hold_unique": len(cross_category_holds),
            "eligible_unique_after_all_classification_holds": len(strict_eligible_identities),
            "eligible_unique_bytes": eligible_unique_bytes,
            "eligible_unique_by_kind": dict(eligible_unique_by_kind),
            "classification_hold_unique": len(held_identities),
            "classification_hold_overlap_with_eligible": len(cross_category_holds),
            "broken": sum(1 for row in documents if row["integrity_status"] == "broken"),
            "integrity_warning": sum(1 for row in documents if row["integrity_status"] == "warning"),
            "legacy_word_manual_review": sum(
                1 for row in documents if row["integrity_status"] == "legacy_header_ok"
            ),
            "strong_ocr_candidates": sum(
                1 for row in documents
                if row["ocr_status"] in {"ocr_candidate", "ocr_candidate_after_render"}
            ),
            "partial_ocr_candidates": sum(
                1 for row in documents if row["ocr_status"] == "partial_ocr_candidate"
            ),
            "exact_duplicate_groups": len(exact_groups),
            "exact_duplicate_extra_copies": sum(len(rows) - 1 for rows in exact_groups.values()),
            "possible_variant_groups": len(variant_groups),
            "possible_variant_groups_after_exact_only_removed": len(variant_groups) - exact_only_variant_groups,
            "ia_02_2_document_share": (
                sum(1 for row in documents if row["top_level"] == "IA-02.2") / len(documents)
            ),
        },
        "by_top_level": by_top_level,
        "decision_holds": [
            "Human owners must rank business value; audit metadata cannot determine priority.",
            "IA-21 requires classification before selection.",
            "iAcoustic_Cadna_OR requires raw-data/calculation classification before selection.",
            "Canonical copies and 258 non-exact filename-variant groups require a version rule/review.",
            "OCR, malware scanning, retention, and promotion-authority decisions remain separate gates.",
        ],
    }
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a read-only ingestion-plan profile from corpus-audit outputs")
    parser.add_argument("--audit-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = analyze(args.audit_dir.resolve())
    rendered = json.dumps(result, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0 if result["quality"]["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
