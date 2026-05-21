from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from paper_reader_summary.page_render import (
    DEFAULT_RENDER_DPI,
    page_image_filename,
    render_pdf_pages,
    resolve_render_dpi,
)


class PageRenderTests(unittest.TestCase):
    def test_page_image_filename(self) -> None:
        self.assertEqual(page_image_filename(1), "page_0001.png")
        self.assertEqual(page_image_filename(42), "page_0042.png")

    def test_resolve_render_dpi_default(self) -> None:
        self.assertEqual(resolve_render_dpi(None), DEFAULT_RENDER_DPI)
        self.assertEqual(resolve_render_dpi(150), 150)

    def test_render_pdf_pages_fixture(self) -> None:
        fixture = Path(__file__).resolve().parents[2] / "fixtures" / "minimal.pdf"
        if not fixture.exists():
            self.skipTest("minimal.pdf fixture missing")
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)
            pages = render_pdf_pages(fixture, output, dpi=72)
            self.assertGreaterEqual(len(pages), 1)
            first = pages[0]
            self.assertEqual(first.page, 1)
            self.assertTrue(first.path.exists())
            self.assertEqual(first.path.name, page_image_filename(1))


if __name__ == "__main__":
    unittest.main()
