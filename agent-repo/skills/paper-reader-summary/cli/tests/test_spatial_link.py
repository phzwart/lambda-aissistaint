from __future__ import annotations

import unittest

from paper_reader_summary.spatial_link import nearest_region, vertical_gap


class SpatialLinkTests(unittest.TestCase):
    def test_vertical_gap_non_overlapping(self) -> None:
        figure = (0, 0, 100, 100)
        caption = (0, 120, 100, 140)
        self.assertEqual(vertical_gap(figure, caption), 20.0)

    def test_nearest_caption_below_figure(self) -> None:
        figure = {"page": 1, "type": "figure", "bbox": [0, 0, 200, 200]}
        caption_near = {"page": 1, "type": "caption", "bbox": [0, 210, 200, 240], "text": "Fig. 1"}
        caption_far = {"page": 1, "type": "caption", "bbox": [0, 400, 200, 430], "text": "Fig. 2"}
        nearest = nearest_region(figure, [caption_far, caption_near], type_filter="caption")
        self.assertIs(nearest, caption_near)


if __name__ == "__main__":
    unittest.main()
