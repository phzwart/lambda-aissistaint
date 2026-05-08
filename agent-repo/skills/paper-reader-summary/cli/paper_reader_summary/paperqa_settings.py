from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


class SettingsError(RuntimeError):
    """Raised when runtime PaperQA2/LiteLLM settings are incomplete."""


@dataclass(frozen=True)
class RuntimeSettings:
    llm_model: str
    summary_llm_model: str
    embedding_model: str
    litellm_url: str
    litellm_api_key: str
    pqa_home: Path

    @classmethod
    def from_args(cls, args: object) -> "RuntimeSettings":
        llm_model = _required_arg(args, "llm_model", "--llm-model")
        summary_llm_model = _required_arg(args, "summary_llm_model", "--summary-llm-model")
        embedding_model = _required_arg(args, "embedding_model", "--embedding-model")
        litellm_url = _required_env("PAPERQA_LITELLM_URL").rstrip("/")
        litellm_api_key = _required_env("PAPERQA_LITELLM_API_KEY")
        pqa_home = Path(str(getattr(args, "pqa_home", "") or "/workspace/.pqa")).expanduser()
        return cls(
            llm_model=llm_model,
            summary_llm_model=summary_llm_model,
            embedding_model=embedding_model,
            litellm_url=litellm_url,
            litellm_api_key=litellm_api_key,
            pqa_home=pqa_home,
        )

    def apply_environment(self) -> None:
        os.environ["PQA_HOME"] = str(self.pqa_home)

    def safe_metadata(self) -> dict[str, str]:
        return {
            "llm_model": self.llm_model,
            "summary_llm_model": self.summary_llm_model,
            "embedding_model": self.embedding_model,
            "litellm_url": self.litellm_url,
            "pqa_home": str(self.pqa_home),
        }


def build_paperqa_settings(runtime: RuntimeSettings):
    try:
        from paperqa import Settings
    except ImportError as error:
        raise SettingsError("PaperQA2 is not installed in the runner environment.") from error

    llm_config = _litellm_config(runtime.llm_model, runtime)
    summary_llm_config = _litellm_config(runtime.summary_llm_model, runtime)
    try:
        return Settings(
            llm=runtime.llm_model,
            llm_config=llm_config,
            summary_llm=runtime.summary_llm_model,
            summary_llm_config=summary_llm_config,
            embedding=runtime.embedding_model,
            parsing={"use_doc_details": False},
        )
    except TypeError:
        settings = Settings()
        settings.llm = runtime.llm_model
        settings.llm_config = llm_config
        settings.summary_llm = runtime.summary_llm_model
        settings.summary_llm_config = summary_llm_config
        settings.embedding = runtime.embedding_model
        if hasattr(settings, "parsing"):
            try:
                settings.parsing.use_doc_details = False
            except AttributeError:
                pass
        return settings


def _litellm_config(model: str, runtime: RuntimeSettings) -> dict[str, object]:
    return {
        "model_list": [
            {
                "model_name": model,
                "litellm_params": {
                    "model": model,
                    "api_base": runtime.litellm_url,
                    "api_key": runtime.litellm_api_key,
                    "temperature": 0.1,
                },
            }
        ]
    }


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
