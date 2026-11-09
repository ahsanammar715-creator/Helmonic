import csv
import json
import shutil
import unittest
import uuid
from pathlib import Path

from build_full_ingestion_manifest import build_manifest


def write_csv(path: Path, headers: list[str], rows: list[list[object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        writer.writerows(rows)


class FullIngestionManifestTests(unittest.TestCase):
    def test_every_audited_original_is_captured_and_routed(self):
        test_root = Path(__file__).parents[2] / "local-artifacts" / "test-temp"
        test_root.mkdir(parents=True, exist_ok=True)
        root = test_root / str(uuid.uuid4())
        root.mkdir()
        try:
            headers = [
                "relative_path", "top_level", "checklist_group", "checklist_note",
                "extension", "kind", "size_bytes", "modified_ns", "integrity_status",
                "page_count", "pages_analyzed", "low_text_pages", "image_pages",
                "ocr_status", "notes", "sha256", "analyzer_version", "audited_utc",
            ]
            rows = [
                ["IA-02/a.pdf", "IA-02", "IA-02", "", ".pdf", "pdf", 100, 1, "ok", 2, 2, 0, 0, "text_extractable", "", "same", "v", "now"],
                ["IA-21/a-copy.pdf", "IA-21", "UNMAPPED:IA-21", "", ".pdf", "pdf", 100, 1, "ok", 2, 2, 0, 0, "text_extractable", "", "same", "v", "now"],
                ["IA-12/b.docx", "IA-12", "IA-12", "", ".docx", "word", 200, 2, "ok", "", "", "", "", "not_required", "", "", "v", "now"],
                ["IA-21/c.pdf", "IA-21", "UNMAPPED:IA-21", "", ".pdf", "pdf", 300, 3, "ok", 3, 3, 0, 0, "text_extractable", "", "held", "v", "now"],
                ["IA-02/raw.wav", "IA-02", "IA-02", "", ".wav", "other", 400, 4, "not_applicable", "", "", "", "", "not_applicable", "", "", "v", "now"],
                ["Books/reference.pdf", "Books", "APPROVED-REFERENCE", "", ".pdf", "pdf", 500, 5, "ok", 4, 4, 0, 0, "text_extractable", "", "book", "v", "now"],
            ]
            write_csv(root / "inventory.csv", headers, rows)
            write_csv(
                root / "possible-variants.csv",
                ["normalized_name", "relative_path", "size_bytes", "sha256"],
                [["a", "IA-02/a.pdf", 100, "same"], ["a", "IA-21/a-copy.pdf", 100, "same"]],
            )
            (root / "summary.json").write_text(
                json.dumps(
                    {
                        "generated_utc": "2026-09-02T00:00:00Z",
                        "source_root": "S:/approved",
                        "source_was_not_modified": True,
                        "excluded_top_level": ["backup_glen"],
                        "reference_only_excluded": ["checklist"],
                        "total_files": len(rows),
                        "total_bytes": 1600,
                    }
                ),
                encoding="utf-8",
            )

            manifest, summary = build_manifest(root)

            self.assertEqual(len(manifest), 6)
            self.assertTrue(summary["all_originals_marked_for_capture"])
            self.assertEqual(summary["total_manifest_bytes"], 1600)
            self.assertEqual(summary["duplicate_copies"], 1)
            by_path = {item["relative_path"]: item for item in manifest}
            self.assertEqual(by_path["IA-02/a.pdf"]["canonical_source_id"], by_path["IA-21/a-copy.pdf"]["canonical_source_id"])
            self.assertEqual(by_path["IA-02/a.pdf"]["search_state"], "held")
            self.assertEqual(summary["cross_category_duplicate_families_held"], 1)
            self.assertEqual(by_path["IA-12/b.docx"]["processing_lane"], "word_render_extract_embed")
            self.assertEqual(by_path["IA-21/c.pdf"]["search_state"], "held")
            self.assertEqual(by_path["IA-02/raw.wav"]["processing_lane"], "media_catalog")
            self.assertEqual(by_path["IA-02/raw.wav"]["citation_namespace"], "AU")
            self.assertEqual(by_path["Books/reference.pdf"]["citation_namespace"], "B")
            self.assertTrue(all(item["permission_scope"] is None for item in manifest))
        finally:
            shutil.rmtree(root)


if __name__ == "__main__":
    unittest.main()
