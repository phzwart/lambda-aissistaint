from __future__ import annotations

import json
import unittest
from pathlib import Path
from types import SimpleNamespace

from paper_reader_summary.extract import (
    _figure_filter_reason,
    _normalize_paperqa_pages,
    _write_figures_from_parsed,
)
from paper_reader_summary.schema import (
    append_figures_markdown_section,
    build_extended_abstract_question,
    format_figures_prompt_block,
)


class ExtractNormalizationTests(unittest.TestCase):
    def test_normalize_parsedtext_content_not_model_fields(self) -> None:
        parsed = SimpleNamespace(
            content={
                "1": ("Page one text", []),
                "2": ("Page two text", []),
            },
            metadata=SimpleNamespace(model_dump=lambda: {"title": "Sample"}),
        )
        page_texts, metadata, _warnings = _normalize_paperqa_pages(parsed)
        self.assertEqual(metadata.get("title"), "Sample")
        self.assertIn("Page one text", page_texts[0])
        self.assertIn("Page two text", page_texts[1])
        self.assertIn("[Page 1]", page_texts[0])
        joined = "".join(page_texts)
        self.assertNotIn("('content'", joined)
        self.assertNotIn("ParsedMetadata", joined)


class FigureExtractionTests(unittest.TestCase):
    def test_skips_inline_equation_sized_drawings(self) -> None:
        info = {
            "bbox": (411.36, 137.19, 515.62, 164.18),
            "type": "drawing",
            "width": 105,
            "height": 28,
        }
        self.assertIsNotNone(_figure_filter_reason(info))

    def test_keeps_large_figure_bbox(self) -> None:
        info = {
            "bbox": (72.0, 72.0, 400.0, 320.0),
            "type": "drawing",
            "width": 400,
            "height": 320,
        }
        self.assertIsNone(_figure_filter_reason(info))

    def test_write_figures_from_parsed_saves_png_and_manifest(self) -> None:
        import tempfile

        png_header = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
        media = SimpleNamespace(
            index=0,
            data=png_header,
            text=None,
            info={
                "bbox": (72.0, 72.0, 400.0, 320.0),
                "type": "drawing",
                "width": 400,
                "height": 320,
            },
        )
        parsed = SimpleNamespace(
            content={"12": ("Appendix text", [media])},
            metadata=SimpleNamespace(model_dump=lambda: {}),
        )
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            figures, warnings = _write_figures_from_parsed(parsed, tmp_path)
            self.assertEqual(len(figures), 1)
            self.assertEqual(figures[0].artifact_name, "figures/page012_fig01.png")
            self.assertTrue((tmp_path / figures[0].artifact_name).exists())
            manifest = json.loads((tmp_path / "figures_manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["count"], 1)
            self.assertEqual(manifest["figures"][0]["page"], 12)
            self.assertNotIn("No embedded figures", " ".join(warnings))

    def test_write_figures_skips_small_drawings(self) -> None:
        import tempfile

        png_header = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
        media = SimpleNamespace(
            index=0,
            data=png_header,
            text=None,
            info={
                "bbox": (411.36, 137.19, 515.62, 164.18),
                "type": "drawing",
                "width": 105,
                "height": 28,
            },
        )
        parsed = SimpleNamespace(
            content={"12": ("Body", [media])},
            metadata=SimpleNamespace(model_dump=lambda: {}),
        )
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            figures, _warnings = _write_figures_from_parsed(parsed, tmp_path)
            self.assertEqual(len(figures), 0)
            manifest = json.loads((tmp_path / "figures_manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["count"], 0)
            self.assertEqual(manifest["skipped_count"], 1)


class ExtendedAbstractFigureTests(unittest.TestCase):
    def test_extended_abstract_prompt_includes_figure_index(self) -> None:
        figures = [{"page": 5, "artifact_name": "figures/page005_fig01.png", "media_type": "drawing"}]
        block = format_figures_prompt_block(figures)
        self.assertIn("p. 5", block)
        self.assertIn("page005_fig01.png", block)
        question = build_extended_abstract_question(
            instruction="Write extended abstract.",
            abstract_text="Short abstract.",
            citation_label="paper.pdf",
            figures=figures,
        )
        self.assertIn("Extracted figures", question)
        self.assertIn("page005_fig01.png", question)

    def test_append_figures_markdown_section(self) -> None:
        result = append_figures_markdown_section(
            "# Body\n",
            [{"page": 3, "artifact_name": "figures/page003_fig01.png"}],
        )
        self.assertIn("![Page 3 figure](figures/page003_fig01.png)", result)
        self.assertIn("## Figures from PDF", result)


if __name__ == "__main__":
    unittest.main()
