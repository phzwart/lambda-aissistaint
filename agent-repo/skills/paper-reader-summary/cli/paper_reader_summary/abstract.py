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

_INTRODUCTION_HEADING = re.compile(
    r"(?m)^\s*(?:\d+[\.\)]\s+)?introduction\b",
    re.IGNORECASE,
)

_ABSTRACT_HEADING = re.compile(
    r"(?m)^\s*(?:#{1,6}\s*)?abstract\s*:?\s*$",
    re.IGNORECASE,
)

_KEYWORDS_LINE = re.compile(
    r"(?m)^\s*keywords?\s*:",
    re.IGNORECASE,
)

_PAGE_MARKER = re.compile(r"\[Page\s+(\d+)\]", re.IGNORECASE)

_FRONT_MATTER_MAX_CHARS = 25_000
_FRONT_MATTER_MAX_PAGE = 4


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

    front = _front_matter(normalized)
    body, method = _extract_abstract_body(front)
    if body and len(body) >= 40:
        extracted = method in {"heading", "keywords"}
        if method == "fallback":
            warnings.append(
                "No Abstract heading found; using best front-matter paragraph before Introduction."
            )
            extracted = len(body) >= 200
        elif method == "keywords":
            warnings.append("Abstract inferred from text after Keywords (heading not in extracted text).")
        return AbstractExtraction(
            text=body,
            extracted=extracted,
            char_count=len(body),
            warnings=warnings,
        )

    return AbstractExtraction(
        text=body or "Abstract not found in extracted text.",
        extracted=False,
        char_count=len(body),
        warnings=warnings
        or ["No Abstract heading found in extracted text.", "Could not infer abstract from front matter."],
    )


def _front_matter(text: str) -> str:
    """Limit search to early pages / text before Introduction."""
    intro = _INTRODUCTION_HEADING.search(text)
    end = intro.start() if intro is not None else len(text)
    end = min(end, _FRONT_MATTER_MAX_CHARS)

    page_cut = len(text)
    for match in _PAGE_MARKER.finditer(text):
        try:
            page_num = int(match.group(1))
        except ValueError:
            continue
        if page_num > _FRONT_MATTER_MAX_PAGE:
            page_cut = min(page_cut, match.start())
            break
    end = min(end, page_cut)
    return text[: max(end, 0)].strip()


def _extract_abstract_body(front: str) -> tuple[str, str]:
    heading_start = _find_abstract_heading_start(front)
    if heading_start is not None:
        body = _body_until_section_stop(front[heading_start:])
        if len(body) >= 40:
            return body, "heading"

    keywords_body = _body_after_keywords(front)
    if keywords_body and len(keywords_body) >= 120:
        return keywords_body, "keywords"

    fallback = _best_front_matter_paragraph(front)
    if fallback:
        return fallback, "fallback"
    return "", "none"


def _find_abstract_heading_start(front: str) -> int | None:
    for match in _ABSTRACT_HEADING.finditer(front):
        line_start = front.rfind("\n", 0, match.start()) + 1
        line_end = front.find("\n", match.end())
        if line_end < 0:
            line_end = len(front)
        line = front[line_start:line_end]
        if re.search(r"graphical\s+abstract", line, re.IGNORECASE):
            continue
        return match.end()
    return None


def _body_until_section_stop(remainder: str) -> str:
    cleaned = remainder.lstrip(" :\n\t")
    stop_match = _SECTION_STOP.search(cleaned)
    body = cleaned[: stop_match.start()] if stop_match else cleaned
    return re.sub(r"\n{3,}", "\n\n", body).strip()


def _looks_like_keyword_list(text: str) -> bool:
    if len(text) > 280:
        return False
    if text.count(",") >= 2 or text.count(";") >= 2:
        return True
    return bool(_KEYWORDS_LINE.match(text))


def _body_after_keywords(front: str) -> str:
    match = _KEYWORDS_LINE.search(front)
    if not match:
        return ""
    remainder = front[match.end() :].lstrip(" :\n\t")
    chunks = re.split(r"\n\s*\n", remainder)
    for index, chunk in enumerate(chunks):
        cleaned = re.sub(r"\s+", " ", chunk).strip()
        if not cleaned or _looks_like_keyword_list(cleaned):
            continue
        if _ABSTRACT_HEADING.match(cleaned):
            continue
        body = _body_until_section_stop("\n\n".join(chunks[index:]))
        if len(body) >= 120:
            return body
    return ""


def _best_front_matter_paragraph(front: str) -> str:
    best = ""
    for block in re.split(r"\n\s*\n", front):
        cleaned = re.sub(r"\s+", " ", block).strip()
        if len(cleaned) < 120:
            continue
        lower = cleaned.lower()
        if lower.startswith(("doi:", "http", "www.", "[page", "copyright", "received ", "accepted ")):
            continue
        if re.match(r"^[\w\s,\-.]+\d{4}\s*$", cleaned):
            continue
        if len(cleaned) > len(best):
            best = cleaned
    return best


def _first_substantive_paragraph(text: str) -> str:
    """Back-compat helper used by tests."""
    return _best_front_matter_paragraph(_front_matter(text)) or ""
