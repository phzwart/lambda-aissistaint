from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

from paper_reader_summary.layout_detect import detect_layout
from paper_reader_summary.layout_runtime import reset_layout_model_cache_for_tests
from paper_reader_summary.page_render import PageImage


class _FakeBlock:
    def __init__(self, label: str, bbox: tuple[float, float, float, float], score: float = 0.9) -> None:
        self.type = label
        self.score = score
        self.block = type(
            "BBox",
            (),
            {"x_1": bbox[0], "y_1": bbox[1], "x_2": bbox[2], "y_2": bbox[3]},
        )()


class _FakeModel:
    def __init__(self) -> None:
        self.calls: list[object] = []

    def detect(self, image: object) -> list[_FakeBlock]:
        self.calls.append(image)
        return [_FakeBlock("Figure", (10, 20, 110, 220))]


class LayoutDetectTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_layout_model_cache_for_tests()

    def tearDown(self) -> None:
        reset_layout_model_cache_for_tests()

    def test_detect_layout_passes_pil_image_not_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            page_path = Path(tmp) / "page_0001.png"
            Image.new("RGB", (200, 300), color="white").save(page_path)
            page = PageImage(page=1, width=200, height=300, path=page_path, dpi=72)
            fake_model = _FakeModel()
            with mock.patch(
                "paper_reader_summary.layout_detect.get_layout_model",
                return_value=(fake_model, None),
            ):
                regions, warnings, model_id = detect_layout([page], enabled=True)
            self.assertEqual(len(regions), 1)
            self.assertEqual(regions[0].type, "figure")
            self.assertFalse(warnings)
            self.assertEqual(len(fake_model.calls), 1)
            self.assertIsInstance(fake_model.calls[0], Image.Image)

    def test_detect_layout_disabled(self) -> None:
        with mock.patch.dict(os.environ, {"PAPER_LAYOUT_ENABLED": "false"}, clear=False):
            regions, _, model_id = detect_layout([], enabled=None)
        self.assertEqual(regions, [])
        self.assertEqual(model_id, "disabled")


if __name__ == "__main__":
    unittest.main()
