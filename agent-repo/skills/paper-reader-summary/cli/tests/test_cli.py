from __future__ import annotations

import unittest

from paper_reader_summary.__main__ import parse_args


class CliParseTests(unittest.TestCase):
    def test_parse_args_requires_core_flags(self) -> None:
        args = parse_args(
            [
                "--input",
                "/workspace/input/paper.pdf",
                "--output",
                "/workspace/output",
                "--llm-model",
                "LLM_A",
                "--summary-llm-model",
                "LLM_A",
                "--embedding-model",
                "st-multi-qa-MiniLM-L6-cos-v1",
                "--litellm-url",
                "http://127.0.0.1:4000",
            ]
        )
        self.assertEqual(args.input, "/workspace/input/paper.pdf")
        self.assertEqual(args.llm_model, "LLM_A")


if __name__ == "__main__":
    unittest.main()
