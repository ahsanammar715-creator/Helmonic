from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


CLASSIFICATION_HOLDS = {"UNMAPPED:IA-21", "IA-06/IA-07-candidate"}

TEXT_OR_TABLE_EXTENSIONS = {
    ".csv", ".htm", ".html", ".log", ".ods", ".odt", ".pptx", ".txt",
    ".xls", ".xlsb", ".xlsm", ".xlsx", ".xml",
}
MEDIA_EXTENSIONS = {".avi", ".mp3", ".mp4", ".wav"}
IMAGE_EXTENSIONS = {".bmp", ".heic", ".jpg", ".png", ".svg"}
DESIGN_EXTENSIONS = {
    ".dwg", ".fbx", ".ifc", ".nwc", ".nwf", ".obj", ".ply", ".rcp",
    ".rcs", ".rfa", ".rvt", ".skb", ".skp",
}
ACOUSTIC_EXTENSIONS = {
    ".cna", ".cni", ".cnp", ".iris", ".ixl", ".pcp", ".slog", ".svl",
    ".svu", ".xl2", ".xl2r", ".xl3", ".xl3ms", ".xl3si", ".xlba", ".xldb",
}
ARCHIVE_EXTENSIONS = {".bak", ".bin", ".db", ".dat", ".zip"}
EMAIL_EXTENSIONS = {".msg"}


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def opaque_source_id(row: dict[str, str]) -> str:
    material = "\0".join(
        (row["relative_path"].casefold(), row["size_bytes"], row["modified_ns"])
    ).encode("utf-8")
    return f"src-{hashlib.sha256(material).hexdigest()[:24]}"


def citation_namespace(row: dict[str, str]) -> str | None:
    if row["checklist_group"] == "APPROVED-REFERENCE":
        return "B"
    if row["extension"] in EMAIL_EXTENSIONS:
        return "E"
    if row["extension"] == ".wav":
        return "AU"
    if row["kind"] in {"pdf", "word"}:
        return "D"
    return None


def processing_lane(
    row: dict[str, str], *, cross_category_duplicate: bool = False
) -> tuple[str, str]:
    if cross_category_duplicate or row["checklist_group"] in CLASSIFICATION_HOLDS:
        return "classification_review", "held"

    if row["kind"] == "pdf":
        if row["integrity_status"] == "broken":
            return "document_repair", "quarantined"
        if row["integrity_status"] == "warning":
            return "document_review", "held"
        if row["ocr_status"] == "text_extractable":
            return "pdf_extract_embed", "candidate"
        if row["ocr_status"] in {"ocr_candidate", "partial_ocr_candidate"}:
            return "pdf_ocr", "held"
        return "document_review", "held"

    if row["kind"] == "word":
        if row["integrity_status"] == "broken":
            return "document_repair", "quarantined"
        if row["integrity_status"] == "legacy_header_ok":
            return "legacy_word_conversion", "held"
        if row["integrity_status"] == "ok" and row["ocr_status"] == "not_required":
            return "word_render_extract_embed", "candidate"
        if row["integrity_status"] == "ok" and row["ocr_status"] == "ocr_candidate_after_render":
            return "word_render_ocr", "held"
        return "document_review", "held"

    extension = row["extension"]
    if extension in TEXT_OR_TABLE_EXTENSIONS:
        return "text_or_table_classification", "catalogued"
    if extension in MEDIA_EXTENSIONS:
        return "media_catalog", "catalogued"
    if extension in IMAGE_EXTENSIONS:
        return "image_catalog", "catalogued"
    if extension in DESIGN_EXTENSIONS:
        return "design_model_catalog", "catalogued"
    if extension in ACOUSTIC_EXTENSIONS:
        return "acoustic_measurement_catalog", "catalogued"
    if extension in ARCHIVE_EXTENSIONS:
        return "archive_catalog", "catalogued"
    if extension in EMAIL_EXTENSIONS:
        return "email_future", "catalogued"
    return "specialist_catalog", "catalogued"


def exact_duplicate_canonicals(
    rows: Iterable[dict[str, str]],
) -> tuple[dict[str, str], dict[str, int]]:
    by_digest: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        if row["sha256"]:
            by_digest[row["sha256"]].append(row)

    canonical_by_path: dict[str, str] = {}
    copy_count_by_path: dict[str, int] = {}
    for digest_rows in by_digest.values():
        ordered = sorted(digest_rows, key=lambda row: row["relative_path"].casefold())
        canonical_id = opaque_source_id(ordered[0])
        for row in ordered:
            canonical_by_path[row["relative_path"]] = canonical_id
            copy_count_by_path[row["relative_path"]] = len(ordered)
    return canonical_by_path, copy_count_by_path


def variant_groups(path: Path) -> dict[str, str]:
    by_path: dict[str, str] = {}
    for row in read_csv(path):
        normalized = row["normalized_name"]
        group_id = "variant-" + hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
        by_path[row["relative_path"]] = group_id
    return by_path


def build_manifest(audit_dir: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    summary = json.loads((audit_dir / "summary.json").read_text(encoding="utf-8"))
    inventory = read_csv(audit_dir / "inventory.csv")
    canonicals, copy_counts = exact_duplicate_canonicals(inventory)
    variants = variant_groups(audit_dir / "possible-variants.csv")

    groups_by_digest: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in inventory:
        if row["sha256"]:
            groups_by_digest[row["sha256"]].append(row)
    cross_category_digests = {
        digest
        for digest, rows in groups_by_digest.items()
        if any(row["checklist_group"] in CLASSIFICATION_HOLDS for row in rows)
        and any(row["checklist_group"] not in CLASSIFICATION_HOLDS for row in rows)
    }

    manifest: list[dict[str, Any]] = []
    for row in sorted(inventory, key=lambda item: item["relative_path"].casefold()):
        source_id = opaque_source_id(row)
        digest = row["sha256"] or None
        lane, search_state = processing_lane(
            row, cross_category_duplicate=bool(digest and digest in cross_category_digests)
        )
        canonical_id = canonicals.get(row["relative_path"], source_id)
        manifest.append(
            {
                "manifest_version": 1,
                "source_id": source_id,
                "relative_path": row["relative_path"],
                "top_level": row["top_level"],
                "checklist_group": row["checklist_group"],
                "extension": row["extension"],
                "kind": row["kind"],
                "size_bytes": int(row["size_bytes"]),
                "modified_ns": int(row["modified_ns"]),
                "sha256": digest,
                "hash_state": "verified" if digest else "required_at_capture",
                "blob_name": f"originals/{source_id}{row['extension']}",
                "capture_original": True,
                "processing_lane": lane,
                "search_state": search_state,
                "citation_namespace": citation_namespace(row),
                "canonical_source_id": canonical_id,
                "is_canonical": source_id == canonical_id,
                "exact_copy_count": copy_counts.get(row["relative_path"], 1),
                "variant_group_id": variants.get(row["relative_path"]),
                "permission_scope": None,
                "permission_state": "required_before_search",
                "integrity_status": row["integrity_status"],
                "ocr_status": row["ocr_status"],
                "page_count": int(row["page_count"]) if row["page_count"] else None,
            }
        )

    lane_counts = Counter(item["processing_lane"] for item in manifest)
    state_counts = Counter(item["search_state"] for item in manifest)
    total_bytes = sum(item["size_bytes"] for item in manifest)
    result_summary = {
        "manifest_version": 1,
        "audit_generated_utc": summary["generated_utc"],
        "source_root": summary["source_root"],
        "excluded_top_level": summary["excluded_top_level"],
        "reference_only_excluded": summary["reference_only_excluded"],
        "source_was_not_modified": summary["source_was_not_modified"],
        "total_manifest_files": len(manifest),
        "total_manifest_bytes": total_bytes,
        "all_originals_marked_for_capture": all(item["capture_original"] for item in manifest),
        "files_requiring_capture_hash": sum(1 for item in manifest if not item["sha256"]),
        "canonical_files": sum(1 for item in manifest if item["is_canonical"]),
        "duplicate_copies": sum(1 for item in manifest if not item["is_canonical"]),
        "searchable_canonical_candidates": sum(
            1
            for item in manifest
            if item["search_state"] == "candidate" and item["is_canonical"]
        ),
        "cross_category_duplicate_families_held": len(cross_category_digests),
        "files_missing_permission_scope": sum(
            1 for item in manifest if item["permission_scope"] is None
        ),
        "processing_lanes": dict(sorted(lane_counts.items())),
        "search_states": dict(sorted(state_counts.items())),
    }

    if len(manifest) != summary["total_files"] or total_bytes != summary["total_bytes"]:
        raise RuntimeError("Manifest totals do not reconcile to the authoritative audit")
    if not summary["source_was_not_modified"]:
        raise RuntimeError("Audit did not prove its source-write guard remained clean")
    return manifest, result_summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a private, capture-all ingestion manifest from corpus-audit outputs"
    )
    parser.add_argument("--audit-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest, summary = build_manifest(args.audit_dir.resolve())
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "full-ingestion-manifest.jsonl"
    with manifest_path.open("w", encoding="utf-8", newline="\n") as handle:
        for item in manifest:
            handle.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
    (output_dir / "full-ingestion-summary.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
