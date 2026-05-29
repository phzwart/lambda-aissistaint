"""Standalone PaperQA2/LiteLLM settings for paper-gritsqueezer.

Duplicated (intentionally, no shared package) from the paper-reader-summary
runner. Adds tunable chunking knobs (chunk_chars / overlap) wired into
ParsingSettings.reader_config, used by the verification pass's Docs index.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_CHUNK_CHARS = 5000
DEFAULT_CHUNK_OVERLAP = 250


class SettingsError(RuntimeError):
    """Raised when runtime PaperQA2/LiteLLM settings are incomplete."""


def _default_request_timeout_seconds() -> float:
    for candidate in (os.environ.get("PAPERQA_LITELLM_TIMEOUT_S", "").strip(), "900"):
        if not candidate:
            continue
        try:
            return max(60.0, float(candidate))
        except ValueError:
            continue
    return 900.0


@dataclass(frozen=True)
class RuntimeSettings:
    llm_model: str
    summary_llm_model: str
    embedding_model: str
    litellm_url: str
    litellm_api_key: str
    pqa_home: Path
    request_timeout_seconds: float = 900.0
    provider_model: str = ""
    provider_endpoint: str = ""
    configured_name: str = ""
    tier: str = ""
    parsing_chunk_chars: int = DEFAULT_CHUNK_CHARS
    parsing_overlap: int = DEFAULT_CHUNK_OVERLAP

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
        chunk_chars = _resolve_int(
            runtime_json.get("chunkChars"),
            getattr(args, "chunk_chars", None),
            os.environ.get("PAPERQA_CHUNK_CHARS"),
            default=DEFAULT_CHUNK_CHARS,
            minimum=200,
        )
        overlap = _resolve_int(
            runtime_json.get("chunkOverlap"),
            getattr(args, "chunk_overlap", None),
            os.environ.get("PAPERQA_CHUNK_OVERLAP"),
            default=DEFAULT_CHUNK_OVERLAP,
            minimum=0,
        )
        return cls(
            llm_model=llm_model,
            summary_llm_model=summary_llm_model,
            embedding_model=embedding_model,
            litellm_url=litellm_url,
            litellm_api_key=litellm_api_key,
            pqa_home=pqa_home,
            request_timeout_seconds=request_timeout_seconds,
            provider_model=str(runtime_json.get("providerModel") or ""),
            provider_endpoint=str(runtime_json.get("providerEndpoint") or ""),
            configured_name=str(runtime_json.get("configuredName") or llm_model),
            tier=str(runtime_json.get("tier") or ""),
            parsing_chunk_chars=chunk_chars,
            parsing_overlap=overlap,
        )

    def apply_environment(self) -> None:
        os.environ["PQA_HOME"] = str(self.pqa_home)
        api_base = _openai_compatible_base(self.litellm_url)
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
            "parsing_chunk_chars": str(self.parsing_chunk_chars),
            "parsing_overlap": str(self.parsing_overlap),
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
    use_json = _env_truthy("PAPERQA_USE_JSON_CONTEXT", default=False)
    return PromptSettings(use_json=use_json)


def _build_answer_settings():
    try:
        from paperqa.settings import AnswerSettings
    except ImportError as error:
        raise SettingsError("PaperQA2 answer settings are unavailable.") from error
    evidence_skip_summary = _env_truthy("PAPERQA_EVIDENCE_SKIP_SUMMARY", default=True)
    return AnswerSettings(evidence_skip_summary=evidence_skip_summary)


def _reader_config(runtime: RuntimeSettings) -> dict[str, int]:
    return {
        "chunk_chars": int(runtime.parsing_chunk_chars),
        "overlap": int(runtime.parsing_overlap),
    }


def _apply_parsing_test_flags(parsing) -> None:
    if os.environ.get("PAPERQA_DISABLE_DOC_VALID_CHECK", "").strip().lower() in {"1", "true", "yes"}:
        parsing.disable_doc_valid_check = True


def _build_parsing_settings(runtime: RuntimeSettings):
    try:
        from paperqa.settings import MultimodalOptions, ParsingSettings
    except ImportError as error:
        raise SettingsError("PaperQA2 parsing settings are unavailable.") from error

    proxy_llm = _litellm_proxy_model(runtime.llm_model)
    llm_config = _litellm_config(runtime.llm_model, runtime)
    reader_config = _reader_config(runtime)
    try:
        parsing = ParsingSettings(
            use_doc_details=False,
            multimodal=MultimodalOptions.OFF,
            enrichment_llm=proxy_llm,
            enrichment_llm_config=llm_config,
            reader_config=reader_config,
        )
        _apply_parsing_test_flags(parsing)
        return parsing
    except TypeError:
        parsing = ParsingSettings()
        parsing.use_doc_details = False
        parsing.multimodal = MultimodalOptions.OFF
        parsing.enrichment_llm = proxy_llm
        parsing.enrichment_llm_config = llm_config
        parsing.reader_config = reader_config
        _apply_parsing_test_flags(parsing)
        return parsing


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


def settings_with_evidence_k(settings, evidence_k: int | None):
    """Return a copy of settings with answer.evidence_k overridden (for verification)."""
    if evidence_k is None:
        return settings
    base_answer = getattr(settings, "answer", None)
    if base_answer is None:
        return settings
    updates = {"evidence_k": int(evidence_k), "evidence_retrieval": True}
    try:
        answer = base_answer.model_copy(update=updates)
    except AttributeError:
        try:
            from paperqa.settings import AnswerSettings

            answer = AnswerSettings(**{**base_answer.model_dump(), **updates})
        except Exception:
            return settings
    try:
        return settings.model_copy(update={"answer": answer})
    except AttributeError:
        settings.answer = answer
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


def _resolve_int(
    runtime_value: object,
    cli_value: object,
    env_value: object,
    *,
    default: int,
    minimum: int,
) -> int:
    for candidate in (runtime_value, cli_value, env_value):
        if candidate is None:
            continue
        text = str(candidate).strip()
        if not text:
            continue
        try:
            value = int(float(text))
        except (TypeError, ValueError):
            continue
        return max(minimum, value)
    return default


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
