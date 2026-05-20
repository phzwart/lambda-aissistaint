import unittest

from paper_reader_summary.paperqa_runner import (
    _extract_answer,
    _strip_paperqa_formatted_wrapper,
)


class _FakeSession:
    def __init__(self, **fields: object) -> None:
        for key, value in fields.items():
            setattr(self, key, value)


class ExtractAnswerTests(unittest.TestCase):
    def test_prefers_answer_over_formatted_question_wrapper(self) -> None:
        session = _FakeSession(
            question="Write a long instruction.\n\n## Full paper\n\nPAGE ONE TEXT",
            answer="## Extended abstract prose\n\nRecovered findings here.",
            formatted_answer=(
                "Question: Write a long instruction.\n\n## Full paper\n\nPAGE ONE TEXT\n\n"
                "## Extended abstract prose\n\nRecovered findings here."
            ),
        )
        self.assertEqual(_extract_answer(session), "## Extended abstract prose\n\nRecovered findings here.")

    def test_strips_question_prefix_from_formatted_answer_fallback(self) -> None:
        session = _FakeSession(
            question="Short task instruction.",
            formatted_answer="Question: Short task instruction.\n\nOnly the narrative body.",
        )
        self.assertEqual(_extract_answer(session), "Only the narrative body.")

    def test_strip_paperqa_references_section(self) -> None:
        text = "Question: Q?\n\nBody text.\n\nReferences\n\n1. (doc): cite"
        self.assertEqual(_strip_paperqa_formatted_wrapper(text), "Body text.")


if __name__ == "__main__":
    unittest.main()
