import importlib.util
import json
import shutil
import subprocess
import sys
import unittest
import uuid
import zipfile
from pathlib import Path

from pypdf import PdfWriter


MODULE_PATH = Path(__file__).with_name("audit_corpus.py")
SPEC = importlib.util.spec_from_file_location("audit_corpus", MODULE_PATH)
assert SPEC and SPEC.loader
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


def write_docx(path: Path, text: str = "A valid technical document") -> None:
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>"
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("word/document.xml", xml)


class CorpusAuditTests(unittest.TestCase):
    def test_checklist_mapping_and_exclusions(self):
        self.assertEqual(AUDIT.checklist_group("IA-02.1")[0], "IA-02")
        self.assertEqual(AUDIT.checklist_group("IA-02.2")[0], "IA-02")
        self.assertEqual(AUDIT.checklist_group("IA-21")[0], "UNMAPPED:IA-21")
        self.assertIn("tender desk", AUDIT.EXCLUDED_TOP_LEVEL_STEMS)

    def test_end_to_end_read_only_inventory(self):
        test_root = Path(__file__).parents[2] / "local-artifacts" / "test-temp"
        test_root.mkdir(parents=True, exist_ok=True)
        base = test_root / str(uuid.uuid4())
        base.mkdir()
        try:
            source = base / "source"
            output = base / "output"
            (source / "IA-01").mkdir(parents=True)
            (source / "IA-02.1").mkdir()
            (source / "Tender Desk").mkdir()

            writer = PdfWriter()
            writer.add_blank_page(width=612, height=792)
            pdf = source / "IA-01" / "scan.pdf"
            with pdf.open("wb") as handle:
                writer.write(handle)
            duplicate = source / "IA-02.1" / "scan copy.pdf"
            duplicate.write_bytes(pdf.read_bytes())
            write_docx(source / "IA-02.1" / "report.docx", "A" * 100)
            (source / "IA-01" / "broken.docx").write_bytes(b"not a zip")
            (source / "Tender Desk" / "excluded.pdf").write_bytes(b"not a pdf")
            before = {
                path.relative_to(source): path.read_bytes()
                for path in source.rglob("*")
                if path.is_file()
            }

            command = [
                sys.executable,
                str(MODULE_PATH),
                "--source",
                str(source),
                "--output",
                str(output),
                "--progress-every",
                "1",
            ]
            completed = subprocess.run(command, check=False, capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            summary = json.loads((output / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["total_files"], 4)
            self.assertEqual(summary["pdf_files"], 2)
            self.assertEqual(summary["word_files"], 2)
            self.assertEqual(summary["pdf_page_mode"], "all")
            self.assertEqual(summary["exact_duplicate_groups"], 1)
            self.assertEqual(summary["ocr_required_candidates"], 2)
            self.assertEqual(summary["integrity_status_counts"]["broken"], 1)
            self.assertFalse((source / "audit.sqlite3").exists())
            after = {
                path.relative_to(source): path.read_bytes()
                for path in source.rglob("*")
                if path.is_file()
            }
            self.assertEqual(after, before)
        finally:
            shutil.rmtree(base)


if __name__ == "__main__":
    unittest.main()
