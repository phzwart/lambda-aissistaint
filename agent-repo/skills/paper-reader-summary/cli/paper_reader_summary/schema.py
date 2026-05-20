from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_SKILL_INSTRUCTION_DIR = Path(__file__).resolve().parent
_EXTENDED_ABSTRACT_INSTRUCTION_PATH = _SKILL_INSTRUCTION_DIR / "extended_abstract_instruction_default.txt"
_STRUCTURED_SUMMARY_INSTRUCTION_PATH = _SKILL_INSTRUCTION_DIR / "structured_summary_instruction_default.txt"
_FOLLOW_UP_QUESTIONS_INSTRUCTION_PATH = _SKILL_INSTRUCTION_DIR / "follow_up_questions_instruction_default.txt"
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


def build_extended_abstract_question(
    *,
    instruction: str,
    abstract_text: str,
    paper_text: str = "",
    citation_label: str,
    document_name: str | None = None,
    target_word_min: int = DEFAULT_EXTENDED_ABSTRACT_WORD_MIN,
    target_word_max: int = DEFAULT_EXTENDED_ABSTRACT_WORD_MAX,
    max_paper_chars: int = DEFAULT_EXTENDED_ABSTRACT_MAX_PAPER_CHARS,
) -> str:
    """Build the PaperQA query. Full paper text is retrieved via indexed chunks, not embedded here."""
    del paper_text, max_paper_chars  # kept for call-site compatibility; body comes from Docs RAG
    user_instruction = (instruction or DEFAULT_EXTENDED_ABSTRACT_INSTRUCTION).strip()
    abstract_body = abstract_text.strip() or "Not available."
    doc_name = (document_name or f"{citation_label}.pdf").strip()

    return f"""{user_instruction}

## Journal abstract (scaffold only — expand using retrieved evidence from the indexed paper)

{abstract_body}

## Task

- Indexed document for citations and evidence: `{doc_name}`
- Target length: {target_word_min}–{target_word_max} words (minimum 800 words).
- Citation format: ({doc_name}, pp. X–Y) using only page ranges supported by retrieved evidence.
- Output ONLY the extended abstract prose. Do not repeat these instructions, this abstract block, or retrieved source excerpts.
- Write plain Markdown (no JSON).
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


def build_summary_prompt(metadata: dict[str, Any], paper_text: str) -> str:
    title = metadata.get("title") or "Not available in provided paper"
    authors = ", ".join(metadata.get("authors") or []) or "Not available in provided paper"
    venue_year = " / ".join(
        item for item in [metadata.get("venue"), metadata.get("year")] if item
    ) or "Not available in provided paper"

    sections = "\n".join(f"- {section}" for section in SUMMARY_SECTIONS)
    return f"""# Paper Reader Summary Input

Summarize only the provided paper text. Do not use external search, outside metadata APIs, or cited references that are not included in the paper text.

## Available Metadata

- Title: {title}
- Authors: {authors}
- Venue / Year: {venue_year}
- DOI: {metadata.get("doi") or "Not available in provided paper"}
- Source: {metadata.get("source_name") or "Unknown"}

## Required Summary Sections

{sections}

## Behavioral Requirements

- Be faithful to the paper.
- Distinguish author claims from your interpretation.
- Preserve uncertainty when information is missing, unclear, or inferred.
- Do not fabricate page numbers, datasets, baselines, metrics, results, or limitations.
- Use page or section markers from the paper text as evidence anchors when available.

## Paper Text

{paper_text}
"""
