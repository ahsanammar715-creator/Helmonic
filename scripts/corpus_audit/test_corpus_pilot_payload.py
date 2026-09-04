import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("build_corpus_pilot_payload.py")
SPEC = importlib.util.spec_from_file_location("build_corpus_pilot_payload", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class CorpusPilotSelectionTests(unittest.TestCase):
    def test_selection_is_exactly_100_eligible_unique_sources(self):
        rows = []
        for group, quota in MODULE.GROUP_QUOTAS.items():
            for index in range(quota + 2):
                rows.append(
                    {
                        "source_id": f"src-{group}-{index}",
                        "sha256": f"{index + 1:064x}"[-64:],
                        "top_level": group,
                        "search_state": "candidate",
                        "is_canonical": True,
                        "processing_lane": "pdf_extract_embed",
                        "extension": ".pdf",
                        "integrity_status": "ok",
                        "ocr_status": "text_extractable",
                    }
                )
        selected = MODULE.select_rows(rows)
        self.assertEqual(len(selected), 100)
        self.assertEqual(len({row["source_id"] for row in selected}), 100)

    def test_selection_rejects_noncanonical_and_ocr_rows(self):
        self.assertFalse(MODULE.eligible({}))
        row = {
            "source_id": "src-held",
            "sha256": "a" * 64,
            "top_level": "IA-02.2",
            "search_state": "candidate",
            "is_canonical": True,
            "processing_lane": "pdf_extract_embed",
            "extension": ".pdf",
            "integrity_status": "ok",
            "ocr_status": "ocr_candidate",
        }
        self.assertFalse(MODULE.eligible(row))


if __name__ == "__main__":
    unittest.main()
