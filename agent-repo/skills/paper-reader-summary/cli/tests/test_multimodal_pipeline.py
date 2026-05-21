from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from paper_reader_summary.chunk_augment import augment_spans_with_evidence
from paper_reader_summary.evidence_schema import EvidenceObject, empty_links
from paper_reader_summary.multimodal_pipeline import finalize_multimodal_artifacts, run_multimodal_preprocess


class MultimodalPipelineTests(unittest.TestCase):
    def test_run_multimodal_preprocess_layout_disabled(self) -> None:
        fixture = Path(__file__).resolve().parents[2] / "fixtures" / "minimal.pdf"
        if not fixture.exists():
            self.skipTest("minimal.pdf fixture missing")
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)
            with mock.patch.dict(os.environ, {"PAPER_LAYOUT_ENABLED": "false"}, clear=False):
                result = run_multimodal_preprocess(
                    fixture,
                    output,
                    paper_id="test-paper",
                    source_hash="abc123",
                    full_text="[Page 1]\nHello\n",
                    render_dpi=72,
                )
            self.assertGreaterEqual(len(result.pages), 1)
            self.assertTrue((output / "layout.json").exists())
            self.assertTrue((output / "evidence.json").exists())
            layout = json.loads((output / "layout.json").read_text(encoding="utf-8"))
            self.assertEqual(layout.get("regions"), [])

    def test_finalize_writes_chunks_and_spans(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)
            spans = [
                {
                    "source_hash": "h",
                    "span_id": "s1",
                    "chunk_index": 0,
                    "char_start": 0,
                    "char_end": 10,
                    "page": 1,
                    "text_preview": "x",
                }
            ]
            obj = EvidenceObject(
                id="fig_p001_01",
                paper_id="p",
                source_hash="h",
                page=1,
                bbox=[0, 0, 10, 10],
                type="figure",
                links=empty_links(),
            )
            from paper_reader_summary.evidence_index import EvidenceIndex
            from paper_reader_summary.multimodal_pipeline import MultimodalPreprocessResult

            result = MultimodalPreprocessResult(evidence_objects=[obj], evidence_index=EvidenceIndex.from_objects([obj]))
            augmented = finalize_multimodal_artifacts(output, spans=spans, result=result)
            self.assertEqual(augmented[0].get("linked_evidence_ids"), ["fig_p001_01"])
            self.assertTrue((output / "chunks.json").exists())
            self.assertTrue((output / "multimodal_context.json").exists())

    def test_augment_spans_with_evidence(self) -> None:
        spans = [{"span_id": "s", "page": 2, "chunk_index": 0}]
        obj = EvidenceObject(
            id="eq_p002_01",
            paper_id="p",
            source_hash="h",
            page=2,
            bbox=[0, 0, 1, 1],
            type="equation",
            links=empty_links(),
        )
        augmented = augment_spans_with_evidence(spans, [obj])
        self.assertEqual(augmented[0]["linked_evidence_ids"], ["eq_p002_01"])


if __name__ == "__main__":
    unittest.main()
