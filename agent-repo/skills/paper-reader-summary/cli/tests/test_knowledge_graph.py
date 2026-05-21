import unittest

from paper_reader_summary.schema import (
    KNOWLEDGE_GRAPH_TOP_LEVEL_KEYS,
    build_knowledge_graph_question,
    load_default_knowledge_graph_instruction,
    parse_knowledge_graph_response,
)


class KnowledgeGraphQuestionTests(unittest.TestCase):
    def test_build_includes_package_sections_not_full_paper(self) -> None:
        question = build_knowledge_graph_question(
            instruction=load_default_knowledge_graph_instruction(),
            abstract_text="Short abstract.",
            summary_markdown="# Summary body",
            extended_abstract="# Extended body",
            follow_up_payload={"depth": ["q1"], "breadth": ["q2"]},
        )
        self.assertIn("Short abstract.", question)
        self.assertIn("# Summary body", question)
        self.assertIn("# Extended body", question)
        self.assertIn('"depth"', question)
        self.assertIn("knowledge graph", question.lower())
        self.assertNotIn("## Full paper text", question)

    def test_default_instruction_requests_graph_sections(self) -> None:
        text = load_default_knowledge_graph_instruction()
        self.assertIn('"entities"', text)
        self.assertIn('"relationships"', text)
        self.assertIn("depends_on", text)


class KnowledgeGraphParseTests(unittest.TestCase):
    def test_parses_valid_json(self) -> None:
        warnings: list[str] = []
        payload = parse_knowledge_graph_response(
            '{"entities":[{"id":"ent_1","label":"LFP"}],"claims":[],"observations":[],'
            '"methods":[],"materials":[],"parameters":[],"limitations":[],'
            '"questions":[],"relationships":[]}',
            warnings,
        )
        self.assertEqual(len(payload["entities"]), 1)
        self.assertEqual(warnings, [])
        for key in KNOWLEDGE_GRAPH_TOP_LEVEL_KEYS:
            self.assertIn(key, payload)

    def test_strips_leading_prose_before_json(self) -> None:
        warnings: list[str] = []
        payload = parse_knowledge_graph_response(
            'Here is the graph:\n{"entities":[],"claims":[],"observations":[],'
            '"methods":[],"materials":[],"parameters":[],"limitations":[],'
            '"questions":[],"relationships":[]}',
            warnings,
        )
        self.assertEqual(payload["entities"], [])


if __name__ == "__main__":
    unittest.main()
