from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


class SettingsError(RuntimeError):
    """Raised when runtime PaperQA2/LiteLLM settings are incomplete."""


def _default_request_timeout_seconds() -> float:
    for candidate in (
        os.environ.get("PAPERQA_LITELLM_TIMEOUT_S", "").strip(),
        "900",
    ):
        if not candidate:
            continue
        try:
            return max(60.0, float(candidate))
        except ValueError:
            continue
    return 900.0


def _default_render_dpi() -> int:
    raw = os.environ.get("PAPER_RENDER_DPI", "").strip()
    if raw:
        try:
            value = int(raw)
            if value > 0:
                return value
        except ValueError:
            pass
    return 300


@dataclass(frozen=True)
class RuntimeSettings:
    llm_model: str
    summary_llm_model: str
    embedding_model: str
    litellm_url: str
    litellm_api_key: str
    pqa_home: Path
    request_timeout_seconds: float = 900.0
    render_dpi: int = 300
    provider_model: str = ""
    provider_endpoint: str = ""
    configured_name: str = ""
    tier: str = ""

    @classmethod
    def from_args(cls, args: object) -> "RuntimeSettings":
        runtime_json = _load_runtime_json(getattr(args, "litellm_runtime", None))
        llm_model = _resolve_model_alias(runtime_json, args, "llm_model", "--llm-model")
        summary_llm_model = _resolve_model_alias(
            runtime_json, args, "summary_llm_model", "--summary-llm-model", fallback=llm_model
        )
        embedding_model = _required_arg(args, "embedding_model", "--embedding-model")
        litellm_url = _resolve_litellm_url(runtime_json, args)
        litellm_api_key = _required_env("PAPERQA_LITELLM_API_KEY")
        pqa_home = Path(str(getattr(args, "pqa_home", "") or "/workspace/.pqa")).expanduser()
        timeout_from_runtime = runtime_json.get("requestTimeoutSeconds")
        request_timeout_seconds = _default_request_timeout_seconds()
        if timeout_from_runtime is not None:
            try:
                request_timeout_seconds = max(60.0, float(timeout_from_runtime))
            except (TypeError, ValueError):
                pass
        render_dpi = _default_render_dpi()
        cli_dpi = getattr(args, "render_dpi", None)
        if cli_dpi is not None:
            try:
                value = int(cli_dpi)
                if value > 0:
                    render_dpi = value
            except (TypeError, ValueError):
                pass
        return cls(
            llm_model=llm_model,
            summary_llm_model=summary_llm_model,
            embedding_model=embedding_model,
            litellm_url=litellm_url,
            litellm_api_key=litellm_api_key,
            pqa_home=pqa_home,
            request_timeout_seconds=request_timeout_seconds,
            render_dpi=render_dpi,
            provider_model=str(runtime_json.get("providerModel") or ""),
            provider_endpoint=str(runtime_json.get("providerEndpoint") or ""),
            configured_name=str(runtime_json.get("configuredName") or llm_model),
            tier=str(runtime_json.get("tier") or ""),
        )

    def apply_environment(self) -> None:
        os.environ["PQA_HOME"] = str(self.pqa_home)
        api_base = _openai_compatible_base(self.litellm_url)
        # PaperQA/LiteLLM may fall back to the OpenAI SDK; point it at the LiteLLM proxy.
        os.environ["OPENAI_API_KEY"] = self.litellm_api_key
        os.environ["OPENAI_API_BASE"] = api_base
        os.environ["LITELLM_API_KEY"] = self.litellm_api_key
        os.environ["LITELLM_PROXY_API_KEY"] = self.litellm_api_key
        timeout = str(int(self.request_timeout_seconds))
        os.environ["PAPERQA_LITELLM_TIMEOUT_S"] = timeout
        os.environ["LITELLM_REQUEST_TIMEOUT"] = timeout
        os.environ["OPENAI_TIMEOUT"] = timeout

    def safe_metadata(self) -> dict[str, str]:
        return {
            "llm_model": self.llm_model,
            "summary_llm_model": self.summary_llm_model,
            "embedding_model": self.embedding_model,
            "litellm_url": self.litellm_url,
            "pqa_home": str(self.pqa_home),
            "provider_model": self.provider_model,
            "provider_endpoint": self.provider_endpoint,
            "configured_name": self.configured_name,
            "tier": self.tier,
            "request_timeout_seconds": str(int(self.request_timeout_seconds)),
            "render_dpi": str(self.render_dpi),
        }


def _env_truthy(name: str, *, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _build_prompt_settings():
    try:
        from paperqa.settings import PromptSettings
    except ImportError as error:
        raise SettingsError("PaperQA2 prompt settings are unavailable.") from error

    # Chatty / instruction-tuned models often return markdown instead of
    # {"summary", "relevance_score"}, which breaks PaperQA's JSON evidence step.
    use_json = _env_truthy("PAPERQA_USE_JSON_CONTEXT", default=False)
    return PromptSettings(use_json=use_json)


def _build_answer_settings():
    try:
        from paperqa.settings import AnswerSettings
    except ImportError as error:
        raise SettingsError("PaperQA2 answer settings are unavailable.") from error

    # Our final query asks for a full structured paper summary. Using that same
    # question for every excerpt causes long markdown blobs and score-parse errors.
    # Skip per-chunk LLM summarization and pass raw excerpts to the final answer step.
    evidence_skip_summary = _env_truthy("PAPERQA_EVIDENCE_SKIP_SUMMARY", default=True)
    return AnswerSettings(evidence_skip_summary=evidence_skip_summary)


def _apply_parsing_test_flags(parsing) -> None:
    """Allow tiny fixture PDFs in mock E2E smoke tests."""
    if os.environ.get("PAPERQA_DISABLE_DOC_VALID_CHECK", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }:
        parsing.disable_doc_valid_check = True


def _build_parsing_settings(runtime: RuntimeSettings):
    try:
        from paperqa.settings import MultimodalOptions, ParsingSettings
    except ImportError as error:
        raise SettingsError("PaperQA2 parsing settings are unavailable.") from error

    proxy_llm = _litellm_proxy_model(runtime.llm_model)
    llm_config = _litellm_config(runtime.llm_model, runtime)
    # Default PaperQA parsing enables multimodal enrichment with gpt-4o-2024-11-20,
    # which bypasses the host LiteLLM alias (LLM_A -> gemma, etc.). Route enrichment
    # through the same proxy alias or disable it entirely.
    try:
        parsing = ParsingSettings(
            use_doc_details=False,
            multimodal=MultimodalOptions.OFF,
            enrichment_llm=proxy_llm,
            enrichment_llm_config=llm_config,
        )
        _apply_parsing_test_flags(parsing)
        return parsing
    except TypeError:
        parsing = ParsingSettings()
        parsing.use_doc_details = False
        parsing.multimodal = MultimodalOptions.OFF
        parsing.enrichment_llm = proxy_llm
        parsing.enrichment_llm_config = llm_config
        _apply_parsing_test_flags(parsing)
        return parsing


def settings_for_extended_abstract(settings):
    """Tune retrieval/answer length for the extended-abstract reconstruction pass."""
    try:
        from paperqa.settings import AnswerSettings
    except ImportError as error:
        raise SettingsError("PaperQA2 answer settings are unavailable.") from error

    base_answer = getattr(settings, "answer", None)
    if base_answer is None:
        return settings

    updates = {
        "answer_length": "900 to 1200 words",
        "evidence_k": 20,
        "evidence_retrieval": True,
    }
    try:
        answer = base_answer.model_copy(update=updates)
    except AttributeError:
        answer = AnswerSettings(**{**base_answer.model_dump(), **updates})

    try:
        return settings.model_copy(update={"answer": answer})
    except AttributeError:
        settings.answer = answer
        return settings


def build_paperqa_settings(runtime: RuntimeSettings):
    try:
        from paperqa import Settings
    except ImportError as error:
        raise SettingsError("PaperQA2 is not installed in the runner environment.") from error

    proxy_llm = _litellm_proxy_model(runtime.llm_model)
    proxy_summary = _litellm_proxy_model(runtime.summary_llm_model)
    llm_config = _litellm_config(runtime.llm_model, runtime)
    summary_llm_config = _litellm_config(runtime.summary_llm_model, runtime)
    parsing = _build_parsing_settings(runtime)
    prompts = _build_prompt_settings()
    answer = _build_answer_settings()
    try:
        return Settings(
            llm=proxy_llm,
            llm_config=llm_config,
            summary_llm=proxy_summary,
            summary_llm_config=summary_llm_config,
            embedding=runtime.embedding_model,
            parsing=parsing,
            prompts=prompts,
            answer=answer,
        )
    except TypeError:
        settings = Settings()
        settings.llm = proxy_llm
        settings.llm_config = llm_config
        settings.summary_llm = proxy_summary
        settings.summary_llm_config = summary_llm_config
        settings.embedding = runtime.embedding_model
        settings.parsing = parsing
        settings.prompts = prompts
        settings.answer = answer
        _apply_parsing_test_flags(settings.parsing)
        return settings


def _load_runtime_json(path: object) -> dict[str, object]:
    if not path:
        return {}
    runtime_path = Path(str(path)).expanduser()
    if not runtime_path.is_file():
        return {}
    try:
        payload = json.loads(runtime_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SettingsError(f"Invalid LiteLLM runtime JSON at {runtime_path}: {error}") from error
    return payload if isinstance(payload, dict) else {}


def _resolve_model_alias(
    runtime_json: dict[str, object],
    args: object,
    attribute: str,
    flag: str,
    *,
    fallback: str | None = None,
) -> str:
    from_runtime = str(runtime_json.get("modelAlias") or "").strip()
    if from_runtime:
        return from_runtime
    value = str(getattr(args, attribute, "") or "").strip()
    if value:
        return value
    if fallback:
        return fallback
    raise SettingsError(f"{flag} is required.")


def _resolve_litellm_url(runtime_json: dict[str, object], args: object) -> str:
    for candidate in (
        str(runtime_json.get("litellmUrl") or "").strip(),
        str(getattr(args, "litellm_url", "") or "").strip(),
        os.environ.get("PAPERQA_LITELLM_URL", "").strip(),
    ):
        if candidate.startswith("http"):
            return candidate.rstrip("/")
    raise SettingsError("PAPERQA_LITELLM_URL or --litellm-url is required.")


def _openai_compatible_base(litellm_url: str) -> str:
    base = litellm_url.rstrip("/")
    return base if base.endswith("/v1") else f"{base}/v1"


def _litellm_proxy_model(model: str) -> str:
    alias = str(model or "").strip()
    if not alias:
        raise SettingsError("LiteLLM model alias is required.")
    if alias.startswith("litellm_proxy/"):
        return alias
    return f"litellm_proxy/{alias}"


def _litellm_params(runtime: RuntimeSettings, *, proxy_model: str) -> dict[str, object]:
    api_base = runtime.litellm_url.rstrip("/")
    timeout = runtime.request_timeout_seconds
    return {
        "model": proxy_model,
        "api_base": api_base,
        "api_key": runtime.litellm_api_key,
        "temperature": 0.1,
        "timeout": timeout,
        "request_timeout": timeout,
        "stream_timeout": timeout,
    }


def _litellm_config(model: str, runtime: RuntimeSettings) -> dict[str, object]:
    proxy_model = _litellm_proxy_model(model)
    params = _litellm_params(runtime, proxy_model=proxy_model)
    # Register both the deployment alias and the litellm_proxy form so PaperQA
    # internals that resolve either name still hit the LiteLLM proxy.
    entries = [
        {"model_name": model, "litellm_params": dict(params)},
        {"model_name": proxy_model, "litellm_params": dict(params)},
    ]
    provider_model = str(runtime.provider_model or "").strip()
    if provider_model and provider_model not in {model, proxy_model}:
        entries.append({"model_name": provider_model, "litellm_params": dict(params)})
    return {"model_list": entries}


def _required_arg(args: object, attribute: str, flag: str) -> str:
    value = str(getattr(args, attribute, "") or "").strip()
    if not value:
        raise SettingsError(f"{flag} is required.")
    return value


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SettingsError(f"{name} is required.")
    return value
