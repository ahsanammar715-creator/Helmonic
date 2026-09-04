import importlib.util
import json
import shutil
import sys
import unittest
import uuid
from contextlib import contextmanager
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("build_corpus_pilot_payload.py")
SPEC = importlib.util.spec_from_file_location("build_corpus_pilot_payload", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)

WORKER_PATH = Path(__file__).with_name("corpus_document_worker.py")
WORKER_SPEC = importlib.util.spec_from_file_location("corpus_document_worker", WORKER_PATH)
WORKER = importlib.util.module_from_spec(WORKER_SPEC)
assert WORKER_SPEC.loader
WORKER_SPEC.loader.exec_module(WORKER)


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


class CorpusPilotHardeningTests(unittest.TestCase):
    @staticmethod
    @contextmanager
    def temporary_directory():
        path = Path.cwd() / "local-artifacts" / "test-scratch" / uuid.uuid4().hex
        path.mkdir(parents=True)
        try:
            yield str(path)
        finally:
            shutil.rmtree(path, ignore_errors=True)

    def test_two_reader_decision_accepts_only_complete_page_parity(self):
        verified = WORKER.integrity_decision(
            expected_pages=2,
            pdfminer_lengths=[100, 0],
            pypdf_lengths=[95, 50],
            pdfminer_warnings=[],
            pypdf_unresolved_failures=[],
        )
        self.assertEqual(verified["outcome"], "verified")

        blank_page = WORKER.integrity_decision(
            expected_pages=1,
            pdfminer_lengths=[0],
            pypdf_lengths=[0],
            pdfminer_warnings=[],
            pypdf_unresolved_failures=[],
        )
        self.assertEqual(blank_page["outcome"], "verified")
        self.assertEqual(blank_page["pagesWithExtractedText"], 0)

        repaired = WORKER.integrity_decision(
            expected_pages=2,
            pdfminer_lengths=[100, 0],
            pypdf_lengths=[95, 50],
            pdfminer_warnings=[WORKER.CORRUPTION_WARNING],
            pypdf_unresolved_failures=[],
        )
        self.assertEqual(repaired["outcome"], "repair_verified")

        quarantined = WORKER.integrity_decision(
            expected_pages=2,
            pdfminer_lengths=[100],
            pypdf_lengths=[95, 0],
            pdfminer_warnings=[],
            pypdf_unresolved_failures=[],
        )
        self.assertEqual(quarantined["outcome"], "quarantine")

        recovered_strict_reader = WORKER.integrity_decision(
            expected_pages=2,
            pdfminer_lengths=[100, 50],
            pypdf_lengths=[95, 50],
            pdfminer_warnings=[],
            pypdf_unresolved_failures=[],
            recovery_applied=True,
        )
        self.assertEqual(recovered_strict_reader["outcome"], "repair_verified")

        unresolved_reader = WORKER.integrity_decision(
            expected_pages=2,
            pdfminer_lengths=[100, 50],
            pypdf_lengths=[95, 50],
            pdfminer_warnings=[],
            pypdf_unresolved_failures=["second reader failed"],
        )
        self.assertEqual(unresolved_reader["outcome"], "quarantine")

    def test_document_timeout_kills_only_worker(self):
        with self.temporary_directory() as directory:
            root = Path(directory)
            result = MODULE.run_limited_process(
                [sys.executable, "-c", "import time; time.sleep(5)"],
                timeout_seconds=0.2,
                memory_bytes=512 * 1024 * 1024,
                stdout_path=root / "stdout.log",
                stderr_path=root / "stderr.log",
            )
            self.assertEqual(result["reason"], "timeout")
            self.assertNotEqual(result["returnCode"], 0)

    def test_document_memory_limit_kills_only_worker(self):
        with self.temporary_directory() as directory:
            root = Path(directory)
            result = MODULE.run_limited_process(
                [sys.executable, "-c", "import time; value=bytearray(32*1024*1024); time.sleep(5)"],
                timeout_seconds=3,
                memory_bytes=8 * 1024 * 1024,
                stdout_path=root / "stdout.log",
                stderr_path=root / "stderr.log",
            )
            self.assertEqual(result["reason"], "memory_limit")
            self.assertNotEqual(result["returnCode"], 0)

    def test_checkpoint_refuses_changed_identity_or_limits(self):
        with self.temporary_directory() as directory:
            path = Path(directory) / "checkpoint.json"
            path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "identity": "original",
                        "limits": {"timeoutSeconds": 600, "memoryMiB": 2048},
                        "documents": {},
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "does not match"):
                MODULE.load_checkpoint(
                    path,
                    "changed",
                    {"timeoutSeconds": 600, "memoryMiB": 2048},
                )

    def test_processing_telemetry_percentiles_are_deterministic(self):
        self.assertEqual(MODULE.percentile([1.0, 2.0, 3.0, 4.0, 5.0], 0.5), 3.0)
        self.assertEqual(MODULE.percentile([1.0, 2.0, 3.0, 4.0, 5.0], 0.95), 5.0)

    def test_checkpoint_resume_reuses_only_hash_verified_completed_output(self):
        with self.temporary_directory() as directory:
            root = Path(directory)
            originals = root / "originals"
            originals.mkdir()
            staged = originals / "src-resume.pdf"
            staged.write_bytes(b"unchanged captured source")
            result_path = root / "src-resume.result.json"
            result_path.write_text(
                json.dumps(
                    {
                        "document": {
                            "fileName": staged.name,
                            "sourceHash": MODULE.digest(staged),
                        },
                        "metrics": {},
                    }
                ),
                encoding="utf-8",
            )
            existing = {"status": "completed"}
            self.assertIsNotNone(MODULE.load_resumable_result(existing, result_path, originals))
            staged.write_bytes(b"changed")
            self.assertIsNone(MODULE.load_resumable_result(existing, result_path, originals))

    @unittest.skipUnless(
        importlib.util.find_spec("reportlab")
        and importlib.util.find_spec("pdfplumber")
        and importlib.util.find_spec("pypdf"),
        "local document libraries are not installed",
    )
    def test_real_worker_process_accepts_a_two_reader_verified_pdf(self):
        from reportlab.pdfgen.canvas import Canvas

        with self.temporary_directory() as directory:
            root = Path(directory)
            source_root = root / "source"
            source_root.mkdir()
            source = source_root / "sample.pdf"
            canvas = Canvas(str(source))
            canvas.drawString(72, 720, "Verified acoustic evidence page")
            canvas.save()
            stat = source.stat()
            row = {
                "source_id": "src-synthetic-worker",
                "relative_path": source.name,
                "size_bytes": stat.st_size,
                "modified_ns": stat.st_mtime_ns,
                "sha256": MODULE.digest(source),
                "page_count": 1,
            }
            result, record = MODULE.process_document(
                row,
                source_root=source_root,
                output=root / "output",
                timeout_seconds=30,
                memory_mib=512,
            )
            self.assertEqual(record["status"], "completed")
            self.assertIsNotNone(result)
            self.assertEqual(result["document"]["integrity"]["outcome"], "verified")
            self.assertEqual(result["metrics"]["pages"], 1)

    @unittest.skipUnless(
        importlib.util.find_spec("pdfplumber") and importlib.util.find_spec("pypdf"),
        "local document libraries are not installed",
    )
    def test_completed_legacy_diagnostics_can_annotate_staged_payload(self):
        diagnostic_path = Path(__file__).with_name("diagnose_corpus_pilot_extraction.py")
        diagnostic_spec = importlib.util.spec_from_file_location("corpus_diagnostics", diagnostic_path)
        diagnostic = importlib.util.module_from_spec(diagnostic_spec)
        assert diagnostic_spec.loader
        diagnostic_spec.loader.exec_module(diagnostic)
        with self.temporary_directory() as directory:
            root = Path(directory)
            (root / "payload.json").write_text(
                json.dumps(
                    {
                        "documents": [
                            {
                                "sourceId": "src-legacy",
                                "chunks": [{"pageNumber": 1, "content": "evidence"}],
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            (root / "extraction-diagnostics.json").write_text(
                json.dumps(
                    {
                        "documentsChecked": 1,
                        "issues": [],
                        "requiresReplacementOrRepair": 0,
                    }
                ),
                encoding="utf-8",
            )
            result = diagnostic.apply_existing_diagnostics(root)
            applied = json.loads((root / "payload.json").read_text(encoding="utf-8"))
            self.assertEqual(result["documentsAnnotated"], 1)
            self.assertEqual(applied["documents"][0]["integrity"]["outcome"], "verified")


if __name__ == "__main__":
    unittest.main()
