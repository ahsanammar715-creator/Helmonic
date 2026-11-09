import importlib.util
import json
import shutil
import sys
import threading
import time
import unittest
import uuid
from argparse import Namespace
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch


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

    def test_large_batch_selection_is_balanced_and_excludes_completed_sources(self):
        rows = []
        for group, count in {"large": 12, "small": 4}.items():
            for index in range(count):
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
        selected = MODULE.select_rows(
            rows,
            batch_id="corpus-batch-12-v1",
            document_count=12,
            excluded_source_ids={"src-large-0"},
        )
        self.assertEqual(len(selected), 12)
        self.assertNotIn("src-large-0", {row["source_id"] for row in selected})
        self.assertEqual(
            dict(sorted(MODULE.Counter(row["top_level"] for row in selected).items())),
            {"large": 9, "small": 3},
        )


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

    def test_two_workers_are_bounded_and_checkpointed_by_parent(self):
        with self.temporary_directory() as directory:
            root = Path(directory)
            (root / "originals").mkdir()
            (root / "checkpoint-documents").mkdir()
            checkpoint = {"documents": {}}
            active = 0
            maximum_active = 0
            guard = threading.Lock()

            def fake_process(row, **_kwargs):
                nonlocal active, maximum_active
                with guard:
                    active += 1
                    maximum_active = max(maximum_active, active)
                time.sleep(0.15)
                with guard:
                    active -= 1
                return (
                    {"document": {"sourceId": row["source_id"]}, "metrics": {}},
                    {
                        "status": "completed",
                        "execution": {
                            "returnCode": 0,
                            "reason": "completed",
                            "elapsedSeconds": 0.15,
                            "peakMemoryBytes": 1,
                        },
                        "resultFile": f"{row['source_id']}.result.json",
                    },
                )

            rows = [{"source_id": f"src-{index}"} for index in range(4)]
            with (
                patch.object(MODULE, "process_document", side_effect=fake_process),
                patch.object(MODULE, "available_memory_bytes", return_value=16 * 1024**3),
            ):
                results, resumed = MODULE.process_selected_documents(
                    rows,
                    source_root=root,
                    output=root,
                    timeout_seconds=600,
                    memory_mib=2048,
                    workers=2,
                    free_memory_reserve_mib=2048,
                    checkpoint=checkpoint,
                    checkpoint_path=root / "checkpoint.json",
                )
            self.assertEqual(resumed, 0)
            self.assertEqual(maximum_active, 2)
            self.assertEqual(set(results), {"src-0", "src-1", "src-2", "src-3"})
            saved = json.loads((root / "checkpoint.json").read_text(encoding="utf-8"))
            self.assertEqual(len(saved["documents"]), 4)

    def test_free_memory_gate_fails_before_starting_a_worker(self):
        with self.temporary_directory() as directory:
            root = Path(directory)
            (root / "originals").mkdir()
            (root / "checkpoint-documents").mkdir()
            with patch.object(MODULE, "available_memory_bytes", return_value=1024**3):
                with self.assertRaisesRegex(RuntimeError, "Insufficient free memory"):
                    MODULE.process_selected_documents(
                        [{"source_id": "src-low-memory"}],
                        source_root=root,
                        output=root,
                        timeout_seconds=600,
                        memory_mib=2048,
                        workers=2,
                        free_memory_reserve_mib=2048,
                        checkpoint={"documents": {}},
                        checkpoint_path=root / "checkpoint.json",
                    )

    def test_free_memory_gate_can_wait_then_start_a_worker(self):
        with self.temporary_directory() as directory:
            root = Path(directory)
            (root / "originals").mkdir()
            (root / "checkpoint-documents").mkdir()

            def fake_process(row, **_kwargs):
                return (
                    {"document": {"sourceId": row["source_id"]}, "metrics": {}},
                    {
                        "status": "completed",
                        "execution": {
                            "returnCode": 0,
                            "reason": "completed",
                            "elapsedSeconds": 0.01,
                            "peakMemoryBytes": 1,
                        },
                        "resultFile": f"{row['source_id']}.result.json",
                    },
                )

            with (
                patch.object(MODULE, "process_document", side_effect=fake_process),
                patch.object(
                    MODULE,
                    "available_memory_bytes",
                    side_effect=[1024**3, 16 * 1024**3],
                ),
                patch.object(MODULE.time, "sleep"),
            ):
                results, _ = MODULE.process_selected_documents(
                    [{"source_id": "src-wait-memory"}],
                    source_root=root,
                    output=root,
                    timeout_seconds=600,
                    memory_mib=2048,
                    workers=1,
                    free_memory_reserve_mib=2048,
                    checkpoint={"documents": {}},
                    checkpoint_path=root / "checkpoint.json",
                    memory_wait_seconds=60,
                )
            self.assertEqual(set(results), {"src-wait-memory"})

    def test_retry_memory_document_runs_exclusively_with_4_gib_cap(self):
        with self.temporary_directory() as directory:
            root = Path(directory)
            (root / "originals").mkdir()
            (root / "checkpoint-documents").mkdir()
            active = 0
            maximum_active_for_retry = 0
            observed_limits = {}
            guard = threading.Lock()

            def fake_process(row, **kwargs):
                nonlocal active, maximum_active_for_retry
                with guard:
                    active += 1
                    if row["source_id"] == "src-retry":
                        maximum_active_for_retry = max(maximum_active_for_retry, active)
                    observed_limits[row["source_id"]] = kwargs["memory_mib"]
                time.sleep(0.05)
                with guard:
                    active -= 1
                return (
                    {"document": {"sourceId": row["source_id"]}, "metrics": {}},
                    {
                        "status": "completed",
                        "execution": {
                            "returnCode": 0,
                            "reason": "completed",
                            "elapsedSeconds": 0.05,
                            "peakMemoryBytes": 1,
                        },
                        "resultFile": f"{row['source_id']}.result.json",
                    },
                )

            rows = [
                {"source_id": "src-normal-1"},
                {"source_id": "src-normal-2"},
                {"source_id": "src-retry"},
            ]
            with (
                patch.object(MODULE, "process_document", side_effect=fake_process),
                patch.object(MODULE, "available_memory_bytes", return_value=16 * 1024**3),
                patch.object(MODULE, "available_commit_bytes", return_value=16 * 1024**3),
            ):
                MODULE.process_selected_documents(
                    rows,
                    source_root=root,
                    output=root,
                    timeout_seconds=600,
                    memory_mib=2048,
                    workers=2,
                    free_memory_reserve_mib=1024,
                    checkpoint={"documents": {}},
                    checkpoint_path=root / "checkpoint.json",
                    retry_memory_source_ids={"src-retry"},
                    retry_memory_mib=4096,
                    retry_physical_floor_mib=3072,
                    retry_commit_floor_mib=5120,
                )
            self.assertEqual(maximum_active_for_retry, 1)
            self.assertEqual(observed_limits["src-normal-1"], 2048)
            self.assertEqual(observed_limits["src-normal-2"], 2048)
            self.assertEqual(observed_limits["src-retry"], 4096)

    def test_retry_memory_gate_requires_physical_and_commit_floors(self):
        with self.temporary_directory() as directory:
            root = Path(directory)
            (root / "originals").mkdir()
            (root / "checkpoint-documents").mkdir()
            with (
                patch.object(MODULE, "available_memory_bytes", return_value=4 * 1024**3),
                patch.object(MODULE, "available_commit_bytes", return_value=4 * 1024**3),
            ):
                with self.assertRaisesRegex(RuntimeError, "commit available"):
                    MODULE.process_selected_documents(
                        [{"source_id": "src-retry"}],
                        source_root=root,
                        output=root,
                        timeout_seconds=600,
                        memory_mib=2048,
                        workers=1,
                        free_memory_reserve_mib=1024,
                        checkpoint={"documents": {}},
                        checkpoint_path=root / "checkpoint.json",
                        retry_memory_source_ids={"src-retry"},
                        retry_memory_mib=4096,
                        retry_physical_floor_mib=3072,
                        retry_commit_floor_mib=5120,
                    )

    def test_quarantined_document_is_reported_without_backfill(self):
        with self.temporary_directory() as directory:
            root = Path(directory)
            manifest = root / "manifest.jsonl"
            rows = [
                {
                    "source_id": f"src-{index}",
                    "sha256": f"{index + 1:064x}"[-64:],
                    "top_level": "IA-02.2",
                    "search_state": "candidate",
                    "is_canonical": True,
                    "processing_lane": "pdf_extract_embed",
                    "extension": ".pdf",
                    "integrity_status": "ok",
                    "ocr_status": "text_extractable",
                    "size_bytes": 10,
                }
                for index in range(3)
            ]
            manifest.write_text(
                "\n".join(json.dumps(row) for row in rows) + "\n",
                encoding="utf-8",
            )
            primary = MODULE.select_rows(
                rows,
                batch_id="corpus-batch-replacement-v1",
                document_count=2,
            )
            failed_source = primary[0]["source_id"]

            def fake_process(row, **_kwargs):
                completed = row["source_id"] != failed_source
                record = {
                    "status": "completed" if completed else "manual_review",
                    "execution": {
                        "returnCode": 0 if completed else 1,
                        "reason": "completed" if completed else "reader_failure",
                        "elapsedSeconds": 0.01,
                        "peakMemoryBytes": 1,
                    },
                    "resultFile": f"{row['source_id']}.result.json",
                }
                if not completed:
                    record["error"] = "synthetic reader failure"
                    return None, record
                return (
                    {
                        "document": {
                            "sourceId": row["source_id"],
                            "fileName": f"{row['source_id']}.pdf",
                            "sourceHash": row["sha256"],
                            "permissionScope": "iAcoustics",
                            "citationNamespace": "D",
                            "integrity": {"outcome": "verified"},
                            "chunks": [{"chunkId": f"chunk-{row['source_id']}"}],
                        },
                        "metrics": {"pages": 1, "chunks": 1},
                    },
                    record,
                )

            args = Namespace(
                output_dir=root / "output",
                manifest=manifest,
                source_root=root,
                batch_id="corpus-batch-replacement-v1",
                document_count=2,
                exclude_payload=[],
                document_timeout_seconds=600,
                document_memory_mib=2048,
                workers=2,
                free_memory_reserve_mib=2048,
            )
            with (
                patch.object(MODULE, "process_document", side_effect=fake_process),
                patch.object(MODULE, "available_memory_bytes", return_value=16 * 1024**3),
            ):
                summary = MODULE.build(args)
            self.assertEqual(summary["attemptedDocumentCount"], 2)
            self.assertEqual(summary["documentCount"], 1)
            self.assertEqual(summary["manualReviewCount"], 1)
            payload = json.loads((root / "output" / "payload.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["batch"]["attemptedDocumentCount"], 2)
            self.assertEqual(payload["batch"]["quarantineCount"], 1)
            self.assertNotIn(failed_source, {item["sourceId"] for item in payload["documents"]})

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
        importlib.util.find_spec("reportlab")
        and importlib.util.find_spec("pdfplumber")
        and importlib.util.find_spec("pypdf"),
        "local document libraries are not installed",
    )
    def test_two_real_pdf_workers_complete_concurrently(self):
        from reportlab.pdfgen.canvas import Canvas

        with self.temporary_directory() as directory:
            root = Path(directory)
            source_root = root / "source"
            source_root.mkdir()
            output = root / "output"
            (output / "originals").mkdir(parents=True)
            (output / "checkpoint-documents").mkdir()
            rows = []
            for index in range(2):
                source = source_root / f"sample-{index}.pdf"
                canvas = Canvas(str(source))
                canvas.drawString(72, 720, f"Verified parallel evidence {index}")
                canvas.save()
                stat = source.stat()
                rows.append(
                    {
                        "source_id": f"src-parallel-{index}",
                        "relative_path": source.name,
                        "size_bytes": stat.st_size,
                        "modified_ns": stat.st_mtime_ns,
                        "sha256": MODULE.digest(source),
                        "page_count": 1,
                        "citation_namespace": "D",
                    }
                )
            with patch.object(MODULE, "available_memory_bytes", return_value=16 * 1024**3):
                results, _ = MODULE.process_selected_documents(
                    rows,
                    source_root=source_root,
                    output=output,
                    timeout_seconds=30,
                    memory_mib=512,
                    workers=2,
                    free_memory_reserve_mib=512,
                    checkpoint={"documents": {}},
                    checkpoint_path=output / "checkpoint.json",
                )
            self.assertEqual(set(results), {"src-parallel-0", "src-parallel-1"})
            self.assertTrue(
                all(result["document"]["integrity"]["outcome"] == "verified" for result in results.values())
            )

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
