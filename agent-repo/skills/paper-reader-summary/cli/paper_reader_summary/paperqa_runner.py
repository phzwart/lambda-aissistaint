from __future__ import annotations

from pathlib import Path
from typing import Any

from .paperqa_settings import RuntimeSettings, SettingsError, build_paperqa_settings
from .schema import STRUCTURED_SUMMARY_QUESTION, build_summary_record


class PaperQAExecutionError(RuntimeError):
    """Raised when PaperQA2 cannot complete the one-paper summary workflow."""


async def run_paperqa_summary(input_path: Path, output_dir: Path, runtime: RuntimeSettings) -> dict[str, str]:
    try:
        from paperqa import Docs
    except ImportError as error:
        raise PaperQAExecutionError("PaperQA2 is not installed in the runner environment.") from error

    input_pdf = input_path.expanduser().resolve()
    if not input_pdf.exists():
        raise PaperQAExecutionError(f"Input file does not exist: {input_pdf}")
    if not input_pdf.is_file():
        raise PaperQAExecutionError(f"Input path is not a file: {input_pdf}")
    if input_pdf.suffix.lower() != ".pdf":
        raise PaperQAExecutionError("Unsupported input type. This runner accepts PDF files only.")

    try:
        settings = build_paperqa_settings(runtime)
    except SettingsError as error:
        raise PaperQAExecutionError(str(error)) from error

    runtime.apply_environment()
    runtime.pqa_home.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    docs = Docs()
    try:
        await docs.aadd(str(input_pdf), citation=input_pdf.stem, docname=input_pdf.name, settings=settings)
        session = await docs.aquery(STRUCTURED_SUMMARY_QUESTION, settings=settings)
    except Exception as error:  # pragma: no cover - depends on PaperQA2 runtime internals
        raise PaperQAExecutionError(f"PaperQA2 summary workflow failed: {error}") from error

    answer = _extract_answer(session)
    warnings = [] if answer.strip() else ["PaperQA2 returned an empty summary answer."]
    metadata = {
        "source_path": str(input_pdf),
        "source_name": input_pdf.name,
        "input_type": "pdf",
        "paperqa_runtime": runtime.safe_metadata(),
        "paperqa_response": _safe_response_metadata(session),
        "warnings": warnings,
    }

    summary_md_path = output_dir / "summary.md"
    summary_json_path = output_dir / "summary.json"
    metadata_path = output_dir / "paper_metadata.json"

    import json

    summary_md_path.write_text(answer, encoding="utf-8")
    summary_json_path.write_text(
        json.dumps(build_summary_record(answer, metadata, warnings), indent=2, sort_keys=True),
        encoding="utf-8",
    )
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True), encoding="utf-8")

    return {
        "summary_md": str(summary_md_path),
        "summary_json": str(summary_json_path),
        "paper_metadata": str(metadata_path),
    }


def _extract_answer(session: object) -> str:
    for attribute in ("formatted_answer", "answer", "text"):
        value = getattr(session, attribute, None)
        if value:
            return str(value).strip()
    return str(session or "").strip()


def _safe_response_metadata(session: object) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "response_type": type(session).__name__,
    }
    question = getattr(session, "question", None)
    if question:
        metadata["question"] = str(question)[:500]
    contexts = getattr(session, "contexts", None) or getattr(session, "context", None)
    if contexts is not None:
        try:
            metadata["context_count"] = len(contexts)
        except TypeError:
            metadata["context_count"] = None
    return metadata
