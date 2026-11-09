from __future__ import annotations

import unittest

from build_audio_pilot_manifest import REQUIRED_FEATURES, build_pilot


def audio_row(
    name: str,
    *,
    top: str,
    size: int,
    duration: float,
    format_tag: int,
    channels: int = 1,
    measurement: bool = False,
    pdf: bool = False,
    text: bool = False,
    speech: bool = False,
) -> dict[str, object]:
    return {
        "relative_path": f"{top}\\{name}.wav",
        "top_level": top,
        "size_bytes": str(size),
        "status": "ok",
        "source_was_not_modified": "True",
        "duration_seconds": str(duration),
        "format_tag": str(format_tag),
        "channels": str(channels),
        "sample_rate_hz": "24000",
        "measurement_companion": str(measurement),
        "pdf_companion": str(pdf),
        "text_companion": str(text),
        "speech_filename_hint": str(speech),
    }


class AudioPilotManifestTests(unittest.TestCase):
    def test_bounded_pilot_covers_formats_context_and_duration(self):
        audio = [
            audio_row("a", top="IA-02.2", size=10, duration=30, format_tag=1, pdf=True),
            audio_row("b", top="IA-02.2", size=20, duration=300, format_tag=17, measurement=True, text=True),
            audio_row("c", top="IA-06", size=30, duration=1800, format_tag=3, channels=4, speech=True),
        ]
        manifest = [
            {
                "source_id": f"src-{index}",
                "relative_path": row["relative_path"],
                "extension": ".wav",
                "size_bytes": int(row["size_bytes"]),
                "blob_name": f"originals/src-{index}.wav",
                "sha256": None,
                "hash_state": "required_at_capture",
                "capture_original": True,
                "is_canonical": True,
                "citation_namespace": "AU",
            }
            for index, row in enumerate(audio)
        ]

        rows, summary = build_pilot(
            audio,
            manifest,
            count=3,
            max_bytes=100,
            permission_scope="iAcoustics",
        )

        self.assertEqual(summary["selected_files"], 3)
        self.assertEqual(summary["selected_bytes"], 60)
        self.assertTrue(summary["all_required_features_covered"])
        self.assertEqual(set(summary["required_features"]), REQUIRED_FEATURES)
        self.assertTrue(all(row["citation_namespace"] == "AU" for row in rows))
        self.assertTrue(all(row["promotion_state"] == "pilot_only" for row in rows))
        self.assertEqual(
            {row["format_tag"]: row["playback_strategy"] for row in rows},
            {1: "native_compatibility_test", 17: "derived_playback_required", 3: "native_compatibility_test"},
        )


if __name__ == "__main__":
    unittest.main()
