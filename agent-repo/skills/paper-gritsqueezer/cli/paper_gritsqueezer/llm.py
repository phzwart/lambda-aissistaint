"""Standalone LLM-call helpers for paper-gritsqueezer.

Duplicated (intentionally, no shared package) from the paper-reader-summary
runner: a direct summary-LLM call that routes through the LiteLLM proxy, and a
mock-runtime detector for smoke tests.
"""

from __future__ import annotations

import os


def _is_mock_litellm_runtime() -> bool:
    api_key = os.environ.get("PAPERQA_LITELLM_API_KEY", "").strip()
    litellm_url = os.environ.get("PAPERQA_LITELLM_URL", "").strip()
    return api_key in {"mock-smoke-key", "mock", "test"} or "14009" in litellm_url


async def _call_summary_llm_direct(settings, prompt: str, *, name: str) -> str:
    """Direct LLM call without PaperQA evidence retrieval (routes via LiteLLM proxy)."""
    model = settings.get_summary_llm()
    result = await model.call_single(prompt, name=name)
    return str(result.text or "").strip()
