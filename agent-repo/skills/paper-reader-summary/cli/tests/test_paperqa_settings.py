from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from paper_reader_summary.paperqa_settings import (
    RuntimeSettings,
    SettingsError,
    _build_answer_settings,
    _build_prompt_settings,
    _litellm_config,
    _litellm_params,
    _litellm_proxy_model,
    build_paperqa_settings,
)


class LitellmProxyModelTests(unittest.TestCase):
    def test_adds_litellm_proxy_prefix(self) -> None:
        self.assertEqual(_litellm_proxy_model("LLM_A"), "litellm_proxy/LLM_A")

    def test_preserves_existing_prefix(self) -> None:
        self.assertEqual(_litellm_proxy_model("litellm_proxy/LLM_A"), "litellm_proxy/LLM_A")

    def test_rejects_empty_alias(self) -> None:
        with self.assertRaises(SettingsError):
            _litellm_proxy_model("")


class LitellmTimeoutTests(unittest.TestCase):
    def _runtime(self, timeout: float = 600.0) -> RuntimeSettings:
        return RuntimeSettings(
            llm_model="LLM_A",
            summary_llm_model="LLM_A",
            embedding_model="st-multi-qa-MiniLM-L6-cos-v1",
            litellm_url="http://127.0.0.1:4000",
            litellm_api_key="test-key",
            pqa_home=Path("/workspace/.pqa"),
            request_timeout_seconds=timeout,
        )

    def test_litellm_params_include_timeout(self) -> None:
        runtime = self._runtime(900.0)
        params = _litellm_params(runtime, proxy_model="litellm_proxy/LLM_A")
        self.assertEqual(params["timeout"], 900.0)
        self.assertEqual(params["request_timeout"], 900.0)

    def test_litellm_config_applies_timeout_to_all_entries(self) -> None:
        runtime = self._runtime(600.0)
        config = _litellm_config("LLM_A", runtime)
        for entry in config["model_list"]:
            self.assertEqual(entry["litellm_params"]["timeout"], 600.0)
            self.assertEqual(entry["litellm_params"]["request_timeout"], 600.0)
            self.assertEqual(entry["litellm_params"]["api_base"], "http://127.0.0.1:4000")

    def test_from_args_reads_timeout_from_runtime_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            runtime_path = Path(tmp) / "litellm-runtime.json"
            runtime_path.write_text(
                json.dumps(
                    {
                        "modelAlias": "LLM_A",
                        "litellmUrl": "http://127.0.0.1:4000",
                        "requestTimeoutSeconds": 720,
                    }
                ),
                encoding="utf-8",
            )
            args = mock.Mock(
                litellm_runtime=str(runtime_path),
                llm_model="",
                summary_llm_model="",
                embedding_model="st-multi-qa-MiniLM-L6-cos-v1",
                litellm_url="",
                pqa_home="/workspace/.pqa",
            )
            with mock.patch.dict(os.environ, {"PAPERQA_LITELLM_API_KEY": "secret"}, clear=False):
                runtime = RuntimeSettings.from_args(args)
            self.assertEqual(runtime.request_timeout_seconds, 720.0)
            self.assertEqual(runtime.llm_model, "LLM_A")

    def test_apply_environment_exports_timeout_vars(self) -> None:
        runtime = self._runtime(600.0)
        with mock.patch.dict(os.environ, {}, clear=False):
            runtime.apply_environment()
            self.assertEqual(os.environ.get("PAPERQA_LITELLM_TIMEOUT_S"), "600")
            self.assertEqual(os.environ.get("LITELLM_REQUEST_TIMEOUT"), "600")
            self.assertEqual(os.environ.get("OPENAI_TIMEOUT"), "600")


class PaperQASettingsTests(unittest.TestCase):
    def test_build_paperqa_settings_tunes_evidence_for_structured_summary(self) -> None:
        try:
            from paperqa import Settings  # noqa: F401
        except ImportError:
            self.skipTest("paperqa not installed on host")
            return

        runtime = LitellmTimeoutTests()._runtime()
        settings = build_paperqa_settings(runtime)
        self.assertFalse(settings.prompts.use_json)
        self.assertTrue(settings.answer.evidence_skip_summary)

    def test_prompt_and_answer_settings_respect_env_overrides(self) -> None:
        try:
            from paperqa.settings import AnswerSettings, PromptSettings  # noqa: F401
        except ImportError:
            self.skipTest("paperqa not installed on host")
            return

        with mock.patch.dict(
            os.environ,
            {"PAPERQA_USE_JSON_CONTEXT": "1", "PAPERQA_EVIDENCE_SKIP_SUMMARY": "0"},
            clear=False,
        ):
            self.assertTrue(_build_prompt_settings().use_json)
            self.assertFalse(_build_answer_settings().evidence_skip_summary)


class ParsingSettingsTests(unittest.TestCase):
    def test_build_parsing_settings_disables_multimodal_when_paperqa_installed(self) -> None:
        try:
            from paperqa.settings import MultimodalOptions, ParsingSettings
        except ImportError:
            self.skipTest("paperqa not installed on host")
            return

        runtime = LitellmTimeoutTests()._runtime()
        from paper_reader_summary.paperqa_settings import _build_parsing_settings

        parsing = _build_parsing_settings(runtime)
        self.assertIsInstance(parsing, ParsingSettings)
        self.assertEqual(parsing.multimodal, MultimodalOptions.OFF)


if __name__ == "__main__":
    unittest.main()
