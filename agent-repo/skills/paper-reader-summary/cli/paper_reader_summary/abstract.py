from __future__ import annotations

import re
from dataclasses import dataclass


_SECTION_STOP = re.compile(
    r"^\s*(?:"
    r"introduction|keywords|key\s*words|background|materials\s+and\s+methods|"
    r"methods|experimental|results|discussion|conclusion|references|acknowledg"
    r"|1\s*[\.\)]\s|i\s*[\.\)]\s"
    r")",
    re.IGNORECASE | re.MULTILINE,
)


@dataclass(frozen=True)
class AbstractExtraction:
    text: str
    extracted: bool
    char_count: int
    warnings: list[str]


def extract_abstract_from_paper_text(full_text: str) -> AbstractExtraction:
    warnings: list[str] = []
    normalized = full_text.replace("\r\n", "\n").strip()
    if not normalized:
        return AbstractExtraction(
            text="Abstract not found in extracted text.",
            extracted=False,
            char_count=0,
            warnings=["No text available for abstract extraction."],
        )

    match = re.search(r"\babstract\b", normalized, re.IGNORECASE)
    if not match:
        fallback = _first_substantive_paragraph(normalized)
        if fallback:
            warnings.append("No Abstract heading found; using first substantive paragraph as fallback.")
            return AbstractExtraction(
                text=fallback,
                extracted=False,
                char_count=len(fallback),
                warnings=warnings,
            )
        return AbstractExtraction(
            text="Abstract not found in extracted text.",
            extracted=False,
            char_count=0,
            warnings=["No Abstract heading found in extracted text."],
        )

    start = match.end()
    remainder = normalized[start:].lstrip(" :\n\t")
    stop_match = _SECTION_STOP.search(remainder)
    body = remainder[: stop_match.start()] if stop_match else remainder
    body = re.sub(r"\n{3,}", "\n\n", body).strip()

    if len(body) < 40:
        fallback = _first_substantive_paragraph(normalized)
        if fallback and len(fallback) > len(body):
            warnings.append("Abstract section was very short; supplemented with first substantive paragraph.")
            body = fallback
        else:
            warnings.append("Abstract section was very short or empty.")
            return AbstractExtraction(
                text=body or "Abstract not found in extracted text.",
                extracted=False,
                char_count=len(body),
                warnings=warnings,
            )

    return AbstractExtraction(
        text=body,
        extracted=True,
        char_count=len(body),
        warnings=warnings,
    )


def _first_substantive_paragraph(text: str) -> str:
    for block in re.split(r"\n\s*\n", text):
        cleaned = re.sub(r"\s+", " ", block).strip()
        if len(cleaned) >= 80 and not cleaned.lower().startswith(("doi:", "http", "www.")):
            return cleaned
    return ""
