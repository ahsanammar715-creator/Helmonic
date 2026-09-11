import unittest

try:
    from .verify_content_completeness import merge_text_chunks, meaningful_page_shortfall, meaningful_shortfall
except ImportError:  # Direct invocation from this directory.
    from verify_content_completeness import merge_text_chunks, meaningful_page_shortfall, meaningful_shortfall


class CompletenessThresholdTests(unittest.TestCase):
    def test_document_requires_both_count_ratios_and_material_deficits(self):
        self.assertTrue(meaningful_shortfall(1000, 6000, 700, 4000))
        self.assertFalse(meaningful_shortfall(1000, 6000, 900, 4000))
        self.assertFalse(meaningful_shortfall(90, 450, 0, 0))

    def test_page_threshold_is_stricter_but_ignores_nearly_blank_pages(self):
        self.assertTrue(meaningful_page_shortfall(100, 600, 50, 250))
        self.assertFalse(meaningful_page_shortfall(49, 249, 0, 0))

    def test_primary_text_chunks_are_reassembled_without_overlap(self):
        self.assertEqual(merge_text_chunks(["alpha beta gamma", "beta gamma delta"]), "alpha beta gamma delta")


if __name__ == "__main__":
    unittest.main()
