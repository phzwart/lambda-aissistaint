import unittest

from paper_reader_summary.schema import (
    DEFAULT_EXTENDED_ABSTRACT_INSTRUCTION,
    DEFAULT_STRUCTURED_SUMMARY_INSTRUCTION,
    build_extended_abstract_question,
    build_follow_up_questions_question,
    load_default_extended_abstract_instruction,
    load_default_follow_up_questions_instruction,
    load_default_structured_summary_instruction,
)


class StructuredSummaryInstructionTests(unittest.TestCase):
    def test_default_summary_instruction_has_ten_sections(self) -> None:
        text = load_default_structured_summary_instruction()
        self.assertIn("Citation Header", text)
        self.assertIn("Confidence / Ambiguity Notes", text)
        self.assertEqual(DEFAULT_STRUCTURED_SUMMARY_INSTRUCTION, text)


class FollowUpQuestionsTests(unittest.TestCase):
    def test_build_follow_up_uses_summary_and_extended_only(self) -> None:
        question = build_follow_up_questions_question(
            instruction=load_default_follow_up_questions_instruction(),
            summary_markdown="# Summary section",
            extended_abstract="# Extended section",
        )
        self.assertIn("# Summary section", question)
        self.assertIn("# Extended section", question)
        self.assertIn("## Extended abstract", question)
        self.assertIn("## Structured summary", question)
        self.assertNotIn("## Original abstract", question)
        self.assertIn("uncertainty", question.lower())


class ExtendedAbstractQuestionTests(unittest.TestCase):
    def test_default_instruction_is_reconstruction_not_paraphrase(self) -> None:
        text = load_default_extended_abstract_instruction()
        self.assertIn("ANTI-SUMMARIZATION RULE", text)
        self.assertIn("observation → comparison → interpretation → uncertainty", text)
        self.assertIn("900", text)
        self.assertGreater(len(text), 800)

    def test_build_uses_rag_not_embedded_paper_body(self) -> None:
        question = build_extended_abstract_question(
            instruction=DEFAULT_EXTENDED_ABSTRACT_INSTRUCTION,
            abstract_text="Short journal abstract.",
            paper_text="Full paper body with 15 keV exposure and SOC mapping on page 12.",
            citation_label="beam-damage-paper",
            document_name="beam-damage-paper.pdf",
        )
        self.assertIn("Short journal abstract.", question)
        self.assertNotIn("Full paper body with 15 keV", question)
        self.assertNotIn("### Full paper text", question)
        self.assertIn("beam-damage-paper.pdf", question)
        self.assertIn("900", question)
        self.assertIn("1200", question)
        self.assertIn("ANTI-SUMMARIZATION RULE", question)
        self.assertIn("retrieved evidence", question.lower())


if __name__ == "__main__":
    unittest.main()
