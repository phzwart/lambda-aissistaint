from __future__ import annotations

import inspect
import re
from pathlib import Path

from .schema import ExtractionResult


DOI_PATTERN = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", re.IGNORECASE)
YEAR_PATTERN = re.compile(r"\b(19|20)\d{2}\b")


class ExtractionError(RuntimeError):
    """Raised when local paper extraction cannot continue."""


def extract_paper(input_path: Path) -> ExtractionResult:
    path = input_path.expanduser().resolve()
    if not path.exists():
        raise ExtractionError(f"Input file does not exist: {path}")
    if not path.is_file():
        raise ExtractionError(f"Input path is not a file: {path}")

    suffix = path.suffix.lower()
    if suffix != ".pdf":
        raise ExtractionError("Unsupported input type. This CLI accepts PDF files only.")
    return _extract_pdf_with_paperqa2(path)


def _extract_pdf_with_paperqa2(path: Path) -> ExtractionResult:
    try:
        import paperqa  # noqa: F401  # type: ignore[import-not-found]
        from paperqa_pymupdf import parse_pdf_to_pages  # type: ignore[import-not-found]
    except ImportError as error:
        raise ExtractionError(
            "PDF extraction requires PaperQA2 and paper-qa-pymupdf. Install the CLI dependencies from pyproject.toml."
        ) from error

    try:
        parsed_pages = parse_pdf_to_pages(path)
        if inspect.isawaitable(parsed_pages):
            raise ExtractionError("PaperQA2 PDF parser returned an async result; invoke it through a sync parser build.")
    except Exception as error:  # pragma: no cover - depends on PaperQA2 parser internals
        if isinstance(error, ExtractionError):
            raise
        raise ExtractionError(f"PaperQA2 could not parse PDF: {error}") from error

    page_texts, parser_metadata, warnings = _normalize_paperqa_pages(parsed_pages)
    full_text = "".join(page_texts).strip()
    if not full_text:
        raise ExtractionError("PaperQA2 extracted no text from the PDF.")
    if len(full_text) < 1000:
        warnings.append("PaperQA2 extracted a short text body; the paper may be scanned or extraction quality may be low.")

    doi_candidates = _find_dois(full_text)
    title = _clean_metadata_value(parser_metadata.get("title")) or _guess_title_from_text(full_text)
    authors = _split_authors(_clean_metadata_value(parser_metadata.get("author") or parser_metadata.get("authors")))
    year = _guess_year(parser_metadata, full_text)
    return ExtractionResult(
        source_path=str(path),
        source_name=path.name,
        input_type="pdf",
        text=full_text,
        page_count=len(page_texts),
        title=title,
        authors=authors,
        year=year,
        doi=doi_candidates[0] if doi_candidates else None,
        doi_candidates=doi_candidates,
        warnings=warnings,
    )


def _normalize_paperqa_pages(parsed_pages: object) -> tuple[list[str], dict[str, object], list[str]]:
    pages = list(parsed_pages) if not isinstance(parsed_pages, dict) else list(parsed_pages.get("pages", []))
    metadata = parsed_pages.get("metadata", {}) if isinstance(parsed_pages, dict) else {}
    warnings: list[str] = []
    page_texts: list[str] = []
    empty_pages = 0

    for index, page in enumerate(pages, start=1):
        text = _page_text(page)
        if not text:
            empty_pages += 1
        page_number = _page_number(page) or index
        page_texts.append(f"\n\n[Page {page_number}]\n{text}\n")

    if empty_pages:
        warnings.append(f"PaperQA2 returned {empty_pages} page(s) with no text.")
    if not pages:
        warnings.append("PaperQA2 returned no page records.")
    return page_texts, metadata if isinstance(metadata, dict) else {}, warnings


def _page_text(page: object) -> str:
    if isinstance(page, str):
        return page.strip()
    if isinstance(page, dict):
        return str(page.get("text") or page.get("content") or page.get("page_text") or "").strip()
    for attribute in ("text", "content", "page_text"):
        value = getattr(page, attribute, None)
        if value:
            return str(value).strip()
    return str(page or "").strip()


def _page_number(page: object) -> int | None:
    if isinstance(page, dict):
        value = page.get("page") or page.get("page_number") or page.get("number")
    else:
        value = getattr(page, "page", None) or getattr(page, "page_number", None) or getattr(page, "number", None)
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _clean_metadata_value(value: object) -> str | None:
    text = str(value or "").strip()
    if not text or text.lower() in {"none", "null", "untitled"}:
        return None
    return re.sub(r"\s+", " ", text)


def _split_authors(value: str | None) -> list[str]:
    if not value:
        return []
    parts = re.split(r";|\band\b|,(?=\s*[A-Z][A-Za-z.-]+\s+[A-Z])", value)
    return [re.sub(r"\s+", " ", part).strip() for part in parts if part.strip()]


def _find_dois(text: str) -> list[str]:
    seen: set[str] = set()
    dois: list[str] = []
    for match in DOI_PATTERN.findall(text):
        normalized = match.rstrip(".,;)").lower()
        if normalized not in seen:
            seen.add(normalized)
            dois.append(normalized)
    return dois[:10]


def _guess_title_from_text(text: str) -> str | None:
    for raw_line in text.splitlines()[:40]:
        line = re.sub(r"\s+", " ", raw_line).strip()
        if 12 <= len(line) <= 180 and not line.lower().startswith(("abstract", "doi:", "http")):
            return line
    return None


def _guess_year(metadata: dict[str, object], text: str) -> str | None:
    for key in ("creationDate", "modDate", "date"):
        value = _clean_metadata_value(metadata.get(key))
        if value:
            match = YEAR_PATTERN.search(value)
            if match:
                return match.group(0)
    match = YEAR_PATTERN.search(text[:3000])
    return match.group(0) if match else None
