from __future__ import annotations

import unittest

from paper_reader_summary.provenance_substrate import (
    build_source_spans,
    span_id_for,
)


class ProvenanceSubstrateTests(unittest.TestCase):
    def test_build_source_spans_page_markers(self) -> None:
        text = "\n\n[Page 1]\nAlpha text.\n\n[Page 2]\nBeta text.\n"
        source_hash = "abc123"
        spans = build_source_spans(text, source_hash)
        self.assertEqual(len(spans), 2)
        self.assertEqual(spans[0]["page"], 1)
        self.assertEqual(spans[1]["page"], 2)
        self.assertTrue(spans[0]["char_start"] < spans[1]["char_start"])
        self.assertTrue(spans[0]["char_end"] <= spans[1]["char_start"])
        expected_id = span_id_for(source_hash, 0, spans[0]["char_start"], spans[0]["char_end"])
        self.assertEqual(spans[0]["span_id"], expected_id)

    def test_span_id_is_deterministic(self) -> None:
        first = span_id_for("hash", 1, 10, 20)
        second = span_id_for("hash", 1, 10, 20)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
