from __future__ import annotations

import os
import unittest
from unittest import mock

from paper_reader_summary.layout_config import layout_enabled
from paper_reader_summary.layout_detect import detect_layout
from paper_reader_summary.layout_runtime import (
    log_layout_runtime_status,
    reset_layout_model_cache_for_tests,
)
class LayoutRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_layout_model_cache_for_tests()

    def tearDown(self) -> None:
        reset_layout_model_cache_for_tests()

    def test_layout_enabled_false_skips_model(self) -> None:
        with mock.patch.dict(os.environ, {"PAPER_LAYOUT_ENABLED": "false"}, clear=False):
            self.assertFalse(layout_enabled())
            regions, warnings, model_id = detect_layout([], enabled=False)
            self.assertEqual(regions, [])
            self.assertEqual(model_id, "disabled")
            self.assertTrue(any("disabled" in warning.lower() for warning in warnings))

    def test_log_layout_runtime_status_when_disabled(self) -> None:
        with mock.patch.dict(os.environ, {"PAPER_LAYOUT_ENABLED": "false"}, clear=False):
            io_sink = _StringIO()
            status = log_layout_runtime_status(stream=io_sink)
            self.assertFalse(status["paper_layout_enabled"])
            self.assertFalse(status["layout_model_loaded"])
            self.assertIn("skipped", io_sink.getvalue().lower())


class _StringIO:
    def __init__(self) -> None:
        self._parts: list[str] = []

    def write(self, text: str) -> int:
        self._parts.append(text)
        return len(text)

    def flush(self) -> None:
        return None

    def getvalue(self) -> str:
        return "".join(self._parts)


if __name__ == "__main__":
    unittest.main()
