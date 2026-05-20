import unittest

from paper_reader_summary.abstract import extract_abstract_from_paper_text


class AbstractExtractTests(unittest.TestCase):
    def test_extracts_abstract_section(self) -> None:
        text = """
Title Line

Abstract
This paper studies beam damage in operando X-ray diffraction.
We compare multiple electrode chemistries.

Introduction
Background material here.
"""
        result = extract_abstract_from_paper_text(text)
        self.assertTrue(result.extracted)
        self.assertIn("beam damage", result.text)
        self.assertNotIn("Introduction", result.text)

    def test_fallback_when_no_heading(self) -> None:
        text = "Short."
        result = extract_abstract_from_paper_text(text)
        self.assertFalse(result.extracted)


if __name__ == "__main__":
    unittest.main()
