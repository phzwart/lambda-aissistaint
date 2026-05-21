from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from .abstract import extract_abstract_from_paper_text
from .extract import ExtractionError, extract_paper, load_figures_manifest
from .paperqa_settings import (
    RuntimeSettings,
    SettingsError,
    build_paperqa_settings,
    settings_for_extended_abstract as _settings_for_extended_abstract,
)
from .schema import (
    DEFAULT_STRUCTURED_SUMMARY_INSTRUCTION,
    append_figures_markdown_section,
    build_extended_abstract_question,
    build_follow_up_questions_question,
    build_knowledge_graph_question,
    build_summary_record,
    empty_knowledge_graph_payload,
    parse_knowledge_graph_response,
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


async def _call_summary_llm_direct(settings, prompt: str, *, name: str) -> str:
    """Direct LLM call without PaperQA evidence retrieval (for follow-up questions)."""
    model = settings.get_summary_llm()
    # LiteLLMModel.call_single accepts a plain str (no lmi.Message import required).
    result = await model.call_single(prompt, name=name)
    return str(result.text or "").strip()


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
        extraction = extract_paper(input_pdf, output_dir=output_dir)
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
        summary_question = (
            skill_runtime["structured_summary_instruction"] or DEFAULT_STRUCTURED_SUMMARY_INSTRUCTION
        )
        summary_session = await docs.aquery(summary_question, settings=settings)
    except Exception as error:  # pragma: no cover - depends on PaperQA2 runtime internals
        raise PaperQAExecutionError(f"PaperQA2 summary workflow failed: {error}") from error

    answer = _extract_answer(summary_session)
    if not answer.strip():
        warnings.append("PaperQA2 returned an empty summary answer.")

    extended_abstract_text = ""
    extended_abstract_path = output_dir / "extended_abstract.md"
    figures_manifest = load_figures_manifest(output_dir)
    if skill_runtime["extended_abstract_enabled"]:
        extended_question = build_extended_abstract_question(
            instruction=skill_runtime["extended_abstract_instruction"],
            abstract_text=abstract_result.text,
            paper_text=extraction.text,
            citation_label=resolved_citation_label,
            document_name=input_pdf.name,
            figures=figures_manifest,
        )
        extended_settings = _settings_for_extended_abstract(settings)
        try:
            extended_session = await docs.aquery(extended_question, settings=extended_settings)
            extended_abstract_text = append_figures_markdown_section(
                _extract_answer(extended_session),
                figures_manifest,
            )
            extended_abstract_path.write_text(extended_abstract_text, encoding="utf-8")
        except Exception as error:  # pragma: no cover
            warnings.append(f"Extended abstract generation failed: {error}")
            extended_abstract_path.write_text(
                f"Extended abstract generation failed: {error}\n",
                encoding="utf-8",
            )

    follow_up_path = output_dir / "follow_up_questions.json"
    follow_up_payload: dict[str, Any] = {"depth": [], "breadth": []}
    if skill_runtime["follow_up_questions_enabled"]:
        questions_question = build_follow_up_questions_question(
            instruction=skill_runtime["follow_up_questions_instruction"],
            summary_markdown=answer,
            extended_abstract=extended_abstract_text,
        )
        try:
            questions_raw = await _call_summary_llm_direct(
                settings,
                questions_question,
                name="follow_up_questions",
            )
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
            }
        follow_up_path.write_text(
            json.dumps(follow_up_payload, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    knowledge_graph_path = output_dir / "knowledge_graph.json"
    if skill_runtime["knowledge_graph_enabled"]:
        kg_question = build_knowledge_graph_question(
            instruction=skill_runtime["knowledge_graph_instruction"],
            abstract_text=abstract_result.text,
            summary_markdown=answer,
            extended_abstract=extended_abstract_text,
            follow_up_payload=follow_up_payload,
        )
        try:
            kg_raw = await _call_summary_llm_direct(
                settings,
                kg_question,
                name="knowledge_graph",
            )
            kg_payload = parse_knowledge_graph_response(kg_raw, warnings)
        except Exception as error:  # pragma: no cover
            warnings.append(f"Knowledge graph generation failed: {error}")
            kg_payload = {**empty_knowledge_graph_payload(), "error": str(error)}
        knowledge_graph_path.write_text(
            json.dumps(kg_payload, indent=2, sort_keys=True),
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
    if knowledge_graph_path.exists():
        outputs["knowledge_graph_json"] = str(knowledge_graph_path)
    return outputs


def _strip_paperqa_formatted_wrapper(text: str) -> str:
    """PaperQA formatted_answer prefixes the full query as 'Question: …'."""
    stripped = text.strip()
    if stripped.startswith("Question:"):
        parts = stripped.split("\n\n", 1)
        if len(parts) == 2:
            stripped = parts[1].strip()
    if "\n\nReferences\n\n" in stripped:
        stripped = stripped.split("\n\nReferences\n\n", 1)[0].strip()
    return stripped


def _strip_leading_prompt_echo(text: str, *, question: str | None = None) -> str:
    normalized = text.strip()
    if not question:
        return normalized
    prompt = question.strip()
    if not prompt:
        return normalized
    if normalized.startswith(prompt):
        return normalized[len(prompt) :].lstrip()
    for prefix_len in (min(800, len(prompt)), min(400, len(prompt)), min(200, len(prompt))):
        prefix = prompt[:prefix_len]
        if prefix_len > 40 and normalized.startswith(prefix):
            remainder = normalized[prefix_len:].lstrip(" \t\n:-")
            if len(remainder) > 80:
                return remainder
    return normalized


def _extract_answer(session: object) -> str:
    question = getattr(session, "question", None)
    question_text = str(question).strip() if question else None

    for attribute in ("answer", "raw_answer"):
        value = getattr(session, attribute, None)
        if value:
            text = _strip_leading_prompt_echo(str(value).strip(), question=question_text)
            if text:
                return text

    formatted = getattr(session, "formatted_answer", None)
    if formatted:
        text = _strip_leading_prompt_echo(
            _strip_paperqa_formatted_wrapper(str(formatted)),
            question=question_text,
        )
        if text:
            return text

    fallback = getattr(session, "text", None)
    if fallback:
        text = _strip_leading_prompt_echo(
            _strip_paperqa_formatted_wrapper(str(fallback).strip()),
            question=question_text,
        )
        if text:
            return text
    return ""


def _parse_follow_up_questions(raw: str, warnings: list[str]) -> dict[str, Any]:
    text = raw.strip()
    json_start = text.find("{")
    if json_start > 0:
        text = text[json_start:]
    if not text:
        warnings.append("Follow-up questions response was empty.")
        return {"depth": [], "breadth": []}
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            warnings.append("Follow-up questions response was not valid JSON.")
            return {"depth": [], "breadth": []}
        try:
            payload = json.loads(match.group(0))
        except json.JSONDecodeError:
            warnings.append("Follow-up questions response was not valid JSON.")
            return {"depth": [], "breadth": []}
    if not isinstance(payload, dict):
        warnings.append("Follow-up questions JSON must be an object.")
        return {"depth": [], "breadth": []}
    depth = [str(item).strip() for item in (payload.get("depth") or []) if str(item).strip()]
    breadth = [str(item).strip() for item in (payload.get("breadth") or []) if str(item).strip()]
    if len(depth) != 5 or len(breadth) != 5:
        warnings.append(
            f"Follow-up questions expected 5 depth and 5 breadth items; got {len(depth)} depth and {len(breadth)} breadth."
        )
    return {"depth": depth[:5], "breadth": breadth[:5]}


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
