import unittest

from paper_reader_summary.paperqa_runner import _parse_follow_up_questions


class FollowUpParseTests(unittest.TestCase):
    def test_parses_json_object(self) -> None:
        warnings: list[str] = []
        payload = _parse_follow_up_questions(
            '{"depth": ["a","b","c","d","e"], "breadth": ["1","2","3","4","5"]}',
            warnings,
        )
        self.assertEqual(len(payload["depth"]), 5)
        self.assertEqual(len(payload["breadth"]), 5)
        self.assertEqual(warnings, [])


if __name__ == "__main__":
    unittest.main()
