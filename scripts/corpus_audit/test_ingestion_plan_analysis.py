import csv
import json
import shutil
import unittest
import uuid
from pathlib import Path

from build_ingestion_plan_analysis import analyze


def write_csv(path: Path, headers: list[str], rows: list[list[object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        writer.writerows(rows)


class IngestionPlanAnalysisTests(unittest.TestCase):
    def test_cross_category_duplicate_is_held(self):
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
                ["IA-02/a.pdf", "IA-02", "IA-02", "", ".pdf", "pdf", 100, 1, "ok", 1, 1, 0, 0, "text_extractable", "", "same", "v", "now"],
                ["IA-21/a.pdf", "IA-21", "UNMAPPED:IA-21", "", ".pdf", "pdf", 100, 1, "ok", 1, 1, 0, 0, "text_extractable", "", "same", "v", "now"],
                ["IA-12/b.docx", "IA-12", "IA-12", "", ".docx", "word", 200, 1, "ok", "", "", "", "", "not_required", "", "", "v", "now"],
                ["IA-04/bad.pdf", "IA-04", "IA-04", "", ".pdf", "pdf", 50, 1, "broken", "", "", "", "", "not_assessed", "", "", "v", "now"],
            ]
            write_csv(root / "inventory.csv", headers, rows)
            write_csv(
                root / "folder-summary.csv",
                ["top_level", "checklist_group", "all_files", "size_bytes", "pdf_files", "word_files", "broken_documents", "ocr_candidates", "partial_ocr_candidates"],
                [["all", "all", 4, 450, 3, 1, 1, 0, 0]],
            )
            write_csv(
                root / "exact-duplicates.csv",
                ["sha256", "copy_count", "relative_path"],
                [["same", 2, "IA-02/a.pdf"], ["same", 2, "IA-21/a.pdf"]],
            )
            write_csv(
                root / "possible-variants.csv",
                ["normalized_name", "relative_path", "size_bytes", "sha256"],
                [["a", "IA-02/a.pdf", 100, "same"], ["a", "IA-21/a.pdf", 100, "same"]],
            )
            write_csv(root / "scan-errors.csv", ["path", "stage", "error"], [])
            (root / "summary.json").write_text(
                json.dumps(
                    {
                        "generated_utc": "2026-09-02T00:00:00Z",
                        "pdf_page_mode": "all",
                        "source_was_not_modified": True,
                        "total_files": 4,
                        "total_bytes": 450,
                        "pdf_files": 3,
                        "word_files": 1,
                    }
                ),
                encoding="utf-8",
            )

            result = analyze(root)

            self.assertEqual(result["quality"]["status"], "pass")
            self.assertEqual(result["corpus"]["technically_ready_unique"], 2)
            self.assertEqual(result["corpus"]["eligible_unique_before_cross_category_hold"], 2)
            self.assertEqual(result["corpus"]["cross_category_hold_unique"], 1)
            self.assertEqual(result["corpus"]["eligible_unique_after_all_classification_holds"], 1)
            self.assertEqual(result["corpus"]["eligible_unique_by_kind"], {"word": 1})
        finally:
            shutil.rmtree(root)


if __name__ == "__main__":
    unittest.main()
