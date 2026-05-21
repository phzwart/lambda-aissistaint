from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_SKILL_INSTRUCTION_DIR = Path(__file__).resolve().parent
_EXTENDED_ABSTRACT_INSTRUCTION_PATH = _SKILL_INSTRUCTION_DIR / "extended_abstract_instruction_default.txt"
_STRUCTURED_SUMMARY_INSTRUCTION_PATH = _SKILL_INSTRUCTION_DIR / "structured_summary_instruction_default.txt"
_FOLLOW_UP_QUESTIONS_INSTRUCTION_PATH = _SKILL_INSTRUCTION_DIR / "follow_up_questions_instruction_default.txt"
_KNOWLEDGE_GRAPH_INSTRUCTION_PATH = _SKILL_INSTRUCTION_DIR / "knowledge_graph_instruction_default.txt"

KNOWLEDGE_GRAPH_TOP_LEVEL_KEYS = (
    "entities",
    "claims",
    "observations",
    "methods",
    "materials",
    "parameters",
    "limitations",
    "questions",
    "relationships",
)
DEFAULT_EXTENDED_ABSTRACT_MAX_PAPER_CHARS = 120_000
DEFAULT_EXTENDED_ABSTRACT_WORD_MIN = 900
DEFAULT_EXTENDED_ABSTRACT_WORD_MAX = 1200


def load_default_extended_abstract_instruction() -> str:
    try:
        text = _EXTENDED_ABSTRACT_INSTRUCTION_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        text = ""
    if text:
        return text
    return (
        "Write an expert-level extended abstract that reconstructs the paper as a dense, "
        "evidence-rich scientific narrative. Treat the journal abstract as a scaffold; recover "
        "omitted evidence from the full paper text below. Target 900–1200 words. Use "
        "observation → comparison → interpretation → uncertainty. Inline citations: "
        "(DOCUMENT_NAME, pp. X–Y)."
    )


DEFAULT_EXTENDED_ABSTRACT_INSTRUCTION = load_default_extended_abstract_instruction()


def load_default_structured_summary_instruction() -> str:
    try:
        text = _STRUCTURED_SUMMARY_INSTRUCTION_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        text = ""
    if text:
        return text
    return (
        "Read the provided paper and produce a grounded structured summary with citation header, "
        "executive summary, methods, findings, limitations, and evidence anchors."
    )


DEFAULT_STRUCTURED_SUMMARY_INSTRUCTION = load_default_structured_summary_instruction()

# Back-compat alias for imports and tests.
STRUCTURED_SUMMARY_QUESTION = DEFAULT_STRUCTURED_SUMMARY_INSTRUCTION


SUMMARY_SECTIONS = [
    "Citation Header",
    "Executive Summary",
    "Research Question",
    "Approach / Methods",
    "Data / Experimental Setup",
    "Main Findings",
    "Claimed Contributions",
    "Limitations / Caveats",
    "Evidence Anchors",
    "Confidence / Ambiguity Notes",
]

def load_default_follow_up_questions_instruction() -> str:
    try:
        text = _FOLLOW_UP_QUESTIONS_INSTRUCTION_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        text = ""
    if text:
        return text
    return (
        'Generate exactly 5 depth and 5 breadth questions from the supplied extended abstract and '
        'structured summary. Return JSON only: {"depth": ["..."], "breadth": ["..."]}.'
    )


DEFAULT_FOLLOW_UP_QUESTIONS_INSTRUCTION = load_default_follow_up_questions_instruction()


def load_default_knowledge_graph_instruction() -> str:
    try:
        text = _KNOWLEDGE_GRAPH_INSTRUCTION_PATH.read_text(encoding="utf-8").strip()
    except OSError:
        text = ""
    if text:
        return text
    return (
        "Convert the paper package into a structured scientific knowledge graph. "
        'Return JSON only with keys: entities, claims, observations, methods, materials, '
        "parameters, limitations, questions, relationships."
    )


DEFAULT_KNOWLEDGE_GRAPH_INSTRUCTION = load_default_knowledge_graph_instruction()


def format_figures_prompt_block(figures: list[dict[str, Any]]) -> str:
    if not figures:
        return ""
    lines = [
        "## Extracted figures (from PDF)",
        "",
        "The PDF contains embedded figures saved during extraction. When discussing visual results, "
        "refer to them by page (e.g. “Figure on p. 12”). Do not paste binary data.",
        "",
    ]
    for entry in figures:
        page = entry.get("page")
        artifact = entry.get("artifact_name") or ""
        media_type = entry.get("media_type") or "figure"
        caption = (entry.get("caption") or "").strip()
        nearby = (entry.get("nearby_text") or "").strip()
        evidence_id = entry.get("id") or ""
        label = f"p. {page}" if page is not None else "unknown page"
        detail = f"- {label}, `{artifact}` ({media_type})"
        if evidence_id:
            detail = f"{detail} [{evidence_id}]"
        if caption:
            detail = f"{detail}: {caption}"
        elif nearby:
            detail = f"{detail}: {nearby[:200]}"
        lines.append(detail)
    lines.append("")
    return "\n".join(lines)


def append_figures_markdown_section(markdown: str, figures: list[dict[str, Any]]) -> str:
    body = markdown.rstrip()
    if not figures:
        return body
    lines = ["", "## Figures from PDF", ""]
    for entry in figures:
        page = entry.get("page")
        artifact = str(entry.get("artifact_name") or "").strip()
        if not artifact:
            continue
        alt = f"Page {page} figure" if page is not None else "Figure"
        lines.append(f"![{alt}]({artifact})")
        lines.append("")
    return f"{body}\n" + "\n".join(lines).rstrip() + "\n"


def build_extended_abstract_question(
    *,
    instruction: str,
    abstract_text: str,
    paper_text: str = "",
    citation_label: str,
    document_name: str | None = None,
    figures: list[dict[str, Any]] | None = None,
    target_word_min: int = DEFAULT_EXTENDED_ABSTRACT_WORD_MIN,
    target_word_max: int = DEFAULT_EXTENDED_ABSTRACT_WORD_MAX,
    max_paper_chars: int = DEFAULT_EXTENDED_ABSTRACT_MAX_PAPER_CHARS,
) -> str:
    """Build the PaperQA query. Full paper text is retrieved via indexed chunks, not embedded here."""
    del paper_text, max_paper_chars  # kept for call-site compatibility; body comes from Docs RAG
    user_instruction = (instruction or DEFAULT_EXTENDED_ABSTRACT_INSTRUCTION).strip()
    abstract_body = abstract_text.strip() or "Not available."
    doc_name = (document_name or f"{citation_label}.pdf").strip()
    figures_block = format_figures_prompt_block(figures or [])

    return f"""{user_instruction}

## Journal abstract (scaffold only — expand using retrieved evidence from the indexed paper)

{abstract_body}
{figures_block}
## Task

- Indexed document for citations and evidence: `{doc_name}`
- Target length: {target_word_min}–{target_word_max} words (minimum 800 words).
- Citation format: ({doc_name}, pp. X–Y) using only page ranges supported by retrieved evidence.
- Output ONLY the extended abstract prose. Do not repeat these instructions, this abstract block, or retrieved source excerpts.
- Write plain Markdown (no JSON).
- When figures are listed above, reference them by page where relevant; figure images are appended after generation.
"""


def build_follow_up_questions_question(
    *,
    instruction: str,
    summary_markdown: str,
    extended_abstract: str,
) -> str:
    user_instruction = (instruction or DEFAULT_FOLLOW_UP_QUESTIONS_INSTRUCTION).strip()
    return f"""{user_instruction}

## Extended abstract

{extended_abstract.strip() or "Not available."}

## Structured summary

{summary_markdown.strip() or "Not available."}
"""


def build_knowledge_graph_question(
    *,
    instruction: str,
    abstract_text: str,
    summary_markdown: str,
    extended_abstract: str,
    follow_up_payload: dict[str, Any],
) -> str:
    user_instruction = (instruction or DEFAULT_KNOWLEDGE_GRAPH_INSTRUCTION).strip()
    follow_up_json = json.dumps(follow_up_payload, indent=2, sort_keys=True)
    return f"""{user_instruction}

## Journal abstract

{abstract_text.strip() or "Not available."}

## Structured summary

{summary_markdown.strip() or "Not available."}

## Extended abstract

{extended_abstract.strip() or "Not available."}

## Follow-up questions

{follow_up_json}
"""


def empty_knowledge_graph_payload() -> dict[str, list]:
    return {key: [] for key in KNOWLEDGE_GRAPH_TOP_LEVEL_KEYS}


def parse_knowledge_graph_response(raw: str, warnings: list[str]) -> dict[str, Any]:
    text = raw.strip()
    json_start = text.find("{")
    if json_start > 0:
        text = text[json_start:]
    if not text:
        warnings.append("Knowledge graph response was empty.")
        return empty_knowledge_graph_payload()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            warnings.append("Knowledge graph response was not valid JSON.")
            return empty_knowledge_graph_payload()
        try:
            payload = json.loads(match.group(0))
        except json.JSONDecodeError:
            warnings.append("Knowledge graph response was not valid JSON.")
            return empty_knowledge_graph_payload()
    if not isinstance(payload, dict):
        warnings.append("Knowledge graph JSON must be an object.")
        return empty_knowledge_graph_payload()

    result: dict[str, Any] = empty_knowledge_graph_payload()
    for key in KNOWLEDGE_GRAPH_TOP_LEVEL_KEYS:
        value = payload.get(key)
        if value is None:
            continue
        if not isinstance(value, list):
            warnings.append(f"Knowledge graph key '{key}' must be an array; coercing to [].")
            continue
        result[key] = value
    return result


@dataclass
class ExtractionResult:
    source_path: str
    source_name: str
    input_type: str
    text: str
    page_count: int | None = None
    title: str | None = None
    authors: list[str] = field(default_factory=list)
    venue: str | None = None
    year: str | None = None
    doi: str | None = None
    doi_candidates: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    figure_count: int = 0

    def metadata(self) -> dict[str, Any]:
        return {
            "source_path": self.source_path,
            "source_name": self.source_name,
            "input_type": self.input_type,
            "title": self.title,
            "authors": self.authors,
            "venue": self.venue,
            "year": self.year,
            "doi": self.doi,
            "doi_candidates": self.doi_candidates,
            "page_count": self.page_count,
            "figure_count": self.figure_count,
            "character_count": len(self.text),
            "word_count": len(self.text.split()),
            "warnings": self.warnings,
        }


def empty_summary_schema(metadata: dict[str, Any]) -> dict[str, Any]:
    return {
        "citation_header": {
            "title": metadata.get("title") or "Not available in provided paper",
            "authors": metadata.get("authors") or [],
            "venue_year": " / ".join(
                item for item in [metadata.get("venue"), metadata.get("year")] if item
            )
            or "Not available in provided paper",
        },
        "executive_summary": [],
        "research_question": None,
        "approach_methods": None,
        "data_experimental_setup": None,
        "main_findings": [],
        "claimed_contributions": [],
        "limitations_caveats": [],
        "evidence_anchors": [],
        "confidence_ambiguity_notes": [],
        "metadata": metadata,
    }


def build_summary_record(answer: str, metadata: dict[str, Any], warnings: list[str]) -> dict[str, Any]:
    return {
        "summary_markdown": answer,
        "structured_fields": empty_summary_schema(metadata),
        "warnings": warnings,
        "metadata": metadata,
    }


