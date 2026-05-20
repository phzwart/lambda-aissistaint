from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


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

STRUCTURED_SUMMARY_QUESTION = """Read the provided paper and produce a grounded structured summary.

Return the answer with exactly these sections:

1. Citation Header
   - title
   - authors if available
   - venue/year if available
2. Executive Summary
   - 5 to 8 sentences in plain language
3. Research Question
4. Approach / Methods
5. Data / Experimental Setup
6. Main Findings
7. Claimed Contributions
8. Limitations / Caveats
9. Evidence Anchors
   - page or section references for the most important claims whenever possible
10. Confidence / Ambiguity Notes
   - clearly state when information is missing, unclear, or inferred

Be faithful to the paper. Distinguish author claims from interpretation. Do not fabricate page numbers, datasets, baselines, metrics, results, or limitations. Do not summarize references that were not read."""


DEFAULT_EXTENDED_ABSTRACT_INSTRUCTION = (
    "Expand the paper's abstract into a richer narrative (~5× the original abstract length). "
    "Add concrete detail on methods, materials, key results, and caveats drawn only from the paper. "
    "Do not invent facts, citations, or page numbers."
)

DEFAULT_FOLLOW_UP_QUESTIONS_INSTRUCTION = (
    'Generate exactly 5 in-depth follow-up questions and 5 breadth questions grounded in the paper. '
    'Return JSON only: {"depth": ["..."], "breadth": ["..."]} with five strings in each array.'
)


def build_extended_abstract_question(
    *,
    instruction: str,
    abstract_text: str,
    target_char_count: int,
    citation_label: str,
) -> str:
    user_instruction = (instruction or DEFAULT_EXTENDED_ABSTRACT_INSTRUCTION).strip()
    abstract_body = abstract_text.strip() or "Not available."
    return f"""{user_instruction}

## Original abstract (verbatim from paper)

{abstract_body}

## Requirements

- Target length: approximately {target_char_count} characters (~5× the original abstract).
- Cite evidence using the document name `{citation_label}.pdf` with page references when available.
- Ground every statement in the paper; do not fabricate results or citations.
- Write plain Markdown prose (no JSON).
"""


def build_follow_up_questions_question(
    *,
    instruction: str,
    summary_markdown: str,
    abstract_text: str,
    extended_abstract: str,
    metadata: dict[str, Any],
) -> str:
    user_instruction = (instruction or DEFAULT_FOLLOW_UP_QUESTIONS_INSTRUCTION).strip()
    title = metadata.get("title") or "Not available"
    return f"""{user_instruction}

Return JSON only with keys "depth" and "breadth", each an array of exactly five question strings.

## Paper metadata

- Title: {title}
- Authors: {", ".join(metadata.get("authors") or []) or "Not available"}

## Original abstract

{abstract_text.strip() or "Not available."}

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
