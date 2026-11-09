import csv
import shutil
import struct
import unittest
import uuid
import wave
from pathlib import Path

from audit_audio_headers import SPEECH_HINT, inspect, review_sample


class AudioAuditTests(unittest.TestCase):
    def test_compound_voice_note_name_is_detected(self):
        self.assertIsNotNone(SPEECH_HINT.search("2026-06-30_RT60_000_VoiceNote"))

    def test_header_only_audit_routes_and_preserves_sources(self):
        test_root = Path(__file__).parents[2] / "local-artifacts" / "test-temp"
        test_root.mkdir(parents=True, exist_ok=True)
        root = test_root / str(uuid.uuid4())
        root.mkdir()
        try:
            source = root / "source"
            source.mkdir()
            folder = source / "IA-02"
            folder.mkdir()
            wav = folder / "site.wav"
            with wave.open(str(wav), "wb") as handle:
                handle.setnchannels(1)
                handle.setsampwidth(2)
                handle.setframerate(8_000)
                handle.writeframes(struct.pack("<" + "h" * 8_000, *([0] * 8_000)))
            measurement = folder / "site.xl3"
            measurement.write_bytes(b"measurement")
            before = (wav.stat().st_size, wav.stat().st_mtime_ns)

            inventory = root / "inventory.csv"
            with inventory.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(
                    handle,
                    fieldnames=["relative_path", "top_level", "extension", "size_bytes"],
                )
                writer.writeheader()
                writer.writerow({"relative_path": "IA-02\\site.wav", "top_level": "IA-02", "extension": ".wav", "size_bytes": wav.stat().st_size})
                writer.writerow({"relative_path": "IA-02\\site.xl3", "top_level": "IA-02", "extension": ".xl3", "size_bytes": measurement.stat().st_size})

            rows, summary = inspect(source, inventory)

            self.assertEqual(summary["header_ok"], 1)
            self.assertEqual(summary["header_errors"], 0)
            self.assertEqual(rows[0]["sample_rate_hz"], 8_000)
            self.assertEqual(rows[0]["channels"], 1)
            self.assertAlmostEqual(rows[0]["duration_seconds"], 1.0)
            self.assertTrue(rows[0]["measurement_companion"])
            self.assertFalse(summary["audio_content_decoded"])
            self.assertEqual(review_sample(rows, 1)[0]["relative_path"], "IA-02\\site.wav")
            self.assertEqual(before, (wav.stat().st_size, wav.stat().st_mtime_ns))
        finally:
            shutil.rmtree(root)


if __name__ == "__main__":
    unittest.main()
