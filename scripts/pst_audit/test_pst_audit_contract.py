from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[2]
AUDIT = ROOT / "scripts" / "pst_audit" / "PstMetadataAudit.cs"
EXTENSION = ROOT / "scripts" / "pst_audit" / "MetadataOnlyXstFile.cs"
LAUNCHER = ROOT / "scripts" / "pst_audit" / "run-pst-metadata-audit.ps1"


class PstAuditContractTests(unittest.TestCase):
    def setUp(self):
        self.code = AUDIT.read_text(encoding="utf-8") + "\n" + EXTENSION.read_text(
            encoding="utf-8"
        )

    def test_payload_loading_calls_are_absent(self):
        forbidden_calls = (
            r"\.ReadMessageDetails\s*\(",
            r"\.ReadAttachmentProperties\s*\(",
            r"\.SaveAttachment(?:ToFolder|sToFolder)?\s*\(",
            r"EpropertyTag\.PidTagAttachDataBinary",
            r"\bpgMessageContent\b",
            r"\.Properties\s*(?:\.|\[)",
        )
        for pattern in forbidden_calls:
            self.assertIsNone(re.search(pattern, self.code), pattern)

    def test_runtime_body_and_attachment_guards_exist(self):
        for required in (
            "message.Body != null",
            "message.BodyHtml != null",
            "message.Html != null",
            "message.RtfCompressed != null",
            "attachment.Content != null",
        ):
            self.assertIn(required, self.code)

    def test_default_discovery_is_narrow_and_jim_is_optional(self):
        launcher = LAUNCHER.read_text(encoding="utf-8")
        self.assertIn("backup_glen*.pst", launcher)
        self.assertIn("backup_owen*.pst", launcher)
        self.assertIn("*jim*.pst", launcher)
        self.assertIn("Jim PST is not present yet", launcher)
        self.assertNotIn("-Recurse", launcher)

    def test_reports_are_local_and_ignored(self):
        gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
        launcher = LAUNCHER.read_text(encoding="utf-8")
        self.assertIn("/local-artifacts/", gitignore)
        self.assertIn("local-artifacts\\pst-audit\\reports", launcher)


if __name__ == "__main__":
    unittest.main()
