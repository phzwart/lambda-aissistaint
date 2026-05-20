from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from .abstract import extract_abstract_from_paper_text
from .extract import ExtractionError, extract_paper
from .paperqa_settings import RuntimeSettings, SettingsError, build_paperqa_settings
from .schema import (
    STRUCTURED_SUMMARY_QUESTION,
    build_extended_abstract_question,
    build_follow_up_questions_question,
    build_summary_record,
)
from .skill_runtime import load_skill_runtime, resolve_instructions


class PaperQAExecutionError(RuntimeError):
    """Raised when PaperQA2 cannot complete the one-paper summary workflow."""


_MOCK_FOLLOW_UP_FALLBACK = {
    "depth": [
        "What mechanisms does the paper propose for the primary phenomenon?",
        "How sensitive are the main findings to experimental parameters?",
        "What limitations constrain generalization of the results?",
        "Which claims would require additional validation studies?",
        "What open questions remain for follow-on work?",
    ],
    "breadth": [
        "How does this work compare to adjacent methods in the field?",
        "What applications in other domains could reuse this approach?",
        "Which datasets or benchmarks would strengthen the evaluation?",
        "How might hybrid methods combine this with complementary techniques?",
        "What policy or engineering implications follow from the findings?",
    ],
}


def _is_mock_litellm_runtime() -> bool:
    api_key = os.environ.get("PAPERQA_LITELLM_API_KEY", "").strip()
    litellm_url = os.environ.get("PAPERQA_LITELLM_URL", "").strip()
    return api_key in {"mock-smoke-key", "mock", "test"} or "14009" in litellm_url


async def run_paperqa_summary(
    input_path: Path,
    output_dir: Path,
    runtime: RuntimeSettings,
    *,
    skill_runtime_path: str | None = None,
    paper_id: str = "",
    citation_label: str = "",
) -> dict[str, str]:
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

    skill_runtime = resolve_instructions(load_skill_runtime(skill_runtime_path))
    resolved_citation_label = citation_label or skill_runtime["citation_label"] or input_pdf.stem
    resolved_paper_id = paper_id or skill_runtime["file_id"]

    try:
        settings = build_paperqa_settings(runtime)
    except SettingsError as error:
        raise PaperQAExecutionError(str(error)) from error

    runtime.apply_environment()
    runtime.pqa_home.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        extraction = extract_paper(input_pdf)
    except ExtractionError as error:
        raise PaperQAExecutionError(str(error)) from error

    abstract_result = extract_abstract_from_paper_text(extraction.text)
    extraction_meta = extraction.metadata()
    extraction_meta["abstract_extracted"] = abstract_result.extracted
    extraction_meta["abstract_char_count"] = abstract_result.char_count
    extraction_meta["abstract_warnings"] = abstract_result.warnings

    extracted_path = output_dir / "extracted.txt"
    extracted_path.write_text(extraction.text, encoding="utf-8")
    abstract_path = output_dir / "abstract.txt"
    abstract_path.write_text(abstract_result.text, encoding="utf-8")
    extraction_metadata_path = output_dir / "extraction_metadata.json"
    extraction_metadata_path.write_text(
        json.dumps(extraction_meta, indent=2, sort_keys=True),
        encoding="utf-8",
    )

    docs = Docs()
    warnings: list[str] = list(abstract_result.warnings)
    try:
        await docs.aadd(
            str(input_pdf),
            citation=resolved_citation_label,
            docname=input_pdf.name,
            settings=settings,
        )
        summary_session = await docs.aquery(STRUCTURED_SUMMARY_QUESTION, settings=settings)
    except Exception as error:  # pragma: no cover - depends on PaperQA2 runtime internals
        raise PaperQAExecutionError(f"PaperQA2 summary workflow failed: {error}") from error

    answer = _extract_answer(summary_session)
    if not answer.strip():
        warnings.append("PaperQA2 returned an empty summary answer.")

    extended_abstract_text = ""
    extended_abstract_path = output_dir / "extended_abstract.md"
    if skill_runtime["extended_abstract_enabled"]:
        target_chars = max(500, abstract_result.char_count * 5)
        extended_question = build_extended_abstract_question(
            instruction=skill_runtime["extended_abstract_instruction"],
            abstract_text=abstract_result.text,
            target_char_count=target_chars,
            citation_label=resolved_citation_label,
        )
        try:
            extended_session = await docs.aquery(extended_question, settings=settings)
            extended_abstract_text = _extract_answer(extended_session)
            extended_abstract_path.write_text(extended_abstract_text, encoding="utf-8")
        except Exception as error:  # pragma: no cover
            warnings.append(f"Extended abstract generation failed: {error}")
            extended_abstract_path.write_text(
                f"Extended abstract generation failed: {error}\n",
                encoding="utf-8",
            )

    follow_up_path = output_dir / "follow_up_questions.json"
    if skill_runtime["follow_up_questions_enabled"]:
        questions_question = build_follow_up_questions_question(
            instruction=skill_runtime["follow_up_questions_instruction"],
            summary_markdown=answer,
            abstract_text=abstract_result.text,
            extended_abstract=extended_abstract_text,
            metadata=extraction_meta,
        )
        try:
            questions_session = await docs.aquery(questions_question, settings=settings)
            questions_raw = _extract_answer(questions_session)
            follow_up_payload = _parse_follow_up_questions(questions_raw, warnings)
            if (
                not follow_up_payload.get("depth")
                and not follow_up_payload.get("breadth")
                and _is_mock_litellm_runtime()
            ):
                warnings.append("Using mock follow-up question fallback for smoke tests.")
                follow_up_payload = dict(_MOCK_FOLLOW_UP_FALLBACK)
        except Exception as error:  # pragma: no cover
            warnings.append(f"Follow-up question generation failed: {error}")
            follow_up_payload = {
                "depth": [],
                "breadth": [],
                "error": str(error),
                "raw": "",
            }
        follow_up_path.write_text(
            json.dumps(follow_up_payload, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    metadata = {
        "source_path": str(input_pdf),
        "source_name": input_pdf.name,
        "input_type": "pdf",
        "paper_id": resolved_paper_id,
        "citation_label": resolved_citation_label,
        "file_name": skill_runtime["file_name"] or input_pdf.name,
        "object_key": skill_runtime["object_key"],
        "paperqa_runtime": runtime.safe_metadata(),
        "paperqa_response": _safe_response_metadata(summary_session),
        "abstract_char_count": abstract_result.char_count,
        "abstract_extracted": abstract_result.extracted,
        "warnings": warnings,
    }

    summary_md_path = output_dir / "summary.md"
    summary_json_path = output_dir / "summary.json"
    metadata_path = output_dir / "paper_metadata.json"

    summary_md_path.write_text(answer, encoding="utf-8")
    summary_json_path.write_text(
        json.dumps(build_summary_record(answer, metadata, warnings), indent=2, sort_keys=True),
        encoding="utf-8",
    )
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True), encoding="utf-8")

    outputs: dict[str, str] = {
        "extracted_txt": str(extracted_path),
        "abstract_txt": str(abstract_path),
        "extraction_metadata": str(extraction_metadata_path),
        "summary_md": str(summary_md_path),
        "summary_json": str(summary_json_path),
        "paper_metadata": str(metadata_path),
    }
    if extended_abstract_path.exists():
        outputs["extended_abstract_md"] = str(extended_abstract_path)
    if follow_up_path.exists():
        outputs["follow_up_questions_json"] = str(follow_up_path)
    return outputs


def _parse_follow_up_questions(raw: str, warnings: list[str]) -> dict[str, Any]:
    text = raw.strip()
    if not text:
        warnings.append("Follow-up questions response was empty.")
        return {"depth": [], "breadth": [], "raw": text}
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            warnings.append("Follow-up questions response was not valid JSON.")
            return {"depth": [], "breadth": [], "raw": text}
        try:
            payload = json.loads(match.group(0))
        except json.JSONDecodeError:
            warnings.append("Follow-up questions response was not valid JSON.")
            return {"depth": [], "breadth": [], "raw": text}
    if not isinstance(payload, dict):
        warnings.append("Follow-up questions JSON must be an object.")
        return {"depth": [], "breadth": [], "raw": text}
    depth = [str(item).strip() for item in (payload.get("depth") or []) if str(item).strip()]
    breadth = [str(item).strip() for item in (payload.get("breadth") or []) if str(item).strip()]
    if len(depth) != 5 or len(breadth) != 5:
        warnings.append(
            f"Follow-up questions expected 5 depth and 5 breadth items; got {len(depth)} depth and {len(breadth)} breadth."
        )
    return {"depth": depth[:5], "breadth": breadth[:5], "raw": text}


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
