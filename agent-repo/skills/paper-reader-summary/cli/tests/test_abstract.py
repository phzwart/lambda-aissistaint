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

    def test_skips_graphical_abstract_line(self) -> None:
        text = """
Graphical abstract
Short teaser only.

Abstract
Real abstract text about operando microscopy and battery electrodes for analysis.
"""
        result = extract_abstract_from_paper_text(text)
        self.assertTrue(result.extracted)
        self.assertIn("Real abstract", result.text)
        self.assertNotIn("Short teaser", result.text)

    def test_keywords_before_introduction_journal_layout(self) -> None:
        text = """
[Page 1]
Image registration for battery electrodes

Tianxiao Sun, Robert Peng

Keywords: operando imaging, battery degradation, image registration

Operando imaging techniques have become increasingly valuable in both battery research
and manufacturing. However, the reliability of these methods can be compromised by
instabilities in the imaging setup and operando cells, particularly when utilizing
high-resolution imaging systems. The acquired imaging data often include features arising
from both undesirable system vibrations and drift, as well as the scientifically relevant
deformations occurring in the battery sample during cell operation.

1. Introduction
Batteries are essential to modern energy storage systems.
"""
        result = extract_abstract_from_paper_text(text)
        self.assertTrue(result.extracted)
        self.assertIn("Operando imaging techniques", result.text)
        self.assertGreater(result.char_count, 200)
        self.assertNotIn("Batteries are essential", result.text)

    def test_fallback_when_no_heading(self) -> None:
        text = "Short."
        result = extract_abstract_from_paper_text(text)
        self.assertFalse(result.extracted)


if __name__ == "__main__":
    unittest.main()
