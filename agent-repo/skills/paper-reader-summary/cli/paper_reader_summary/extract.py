from __future__ import annotations

import inspect
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .schema import ExtractionResult


DOI_PATTERN = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b", re.IGNORECASE)
YEAR_PATTERN = re.compile(r"\b(19|20)\d{2}\b")
FIGURES_DIR_NAME = "figures"
FIGURES_MANIFEST_NAME = "figures_manifest.json"


class ExtractionError(RuntimeError):
    """Raised when local paper extraction cannot continue."""


@dataclass(frozen=True)
class ExtractedFigure:
    artifact_name: str
    page: int
    index: int
    media_type: str | None
    bbox: list[float] | None
    width: int | None
    height: int | None
    byte_size: int


def extract_paper(input_path: Path, *, output_dir: Path | None = None) -> ExtractionResult:
    path = input_path.expanduser().resolve()
    if not path.exists():
        raise ExtractionError(f"Input file does not exist: {path}")
    if not path.is_file():
        raise ExtractionError(f"Input path is not a file: {path}")

    suffix = path.suffix.lower()
    if suffix != ".pdf":
        raise ExtractionError("Unsupported input type. This CLI accepts PDF files only.")
    return _extract_pdf_with_paperqa2(path, output_dir=output_dir)


def _extract_pdf_with_paperqa2(path: Path, *, output_dir: Path | None) -> ExtractionResult:
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
    figure_count = 0
    if output_dir is not None:
        figures, figure_warnings = _write_figures_from_parsed(parsed_pages, output_dir)
        figure_count = len(figures)
        warnings.extend(figure_warnings)

    full_text = "".join(page_texts).strip()
    if not full_text:
        raise ExtractionError("PaperQA2 extracted no text from the PDF.")
    if len(full_text) < 1000:
        warnings.append("PaperQA2 extracted a short text body; the paper may be scanned or extraction quality may be low.")

    doi_candidates = _find_dois(full_text)
    title = _clean_metadata_value(parser_metadata.get("title")) or _guess_title_from_text(full_text)
    authors = _split_authors(_clean_metadata_value(parser_metadata.get("author") or parser_metadata.get("authors")))
    year = _guess_year(parser_metadata, full_text)
    result = ExtractionResult(
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
        figure_count=figure_count,
    )
    return result


def _parsed_content_map(parsed_pages: object) -> dict[str, object]:
    content = getattr(parsed_pages, "content", None)
    if isinstance(content, dict):
        return content
    if isinstance(parsed_pages, dict):
        nested = parsed_pages.get("content")
        if isinstance(nested, dict):
            return nested
    return {}


def _parsed_metadata_dict(parsed_pages: object) -> dict[str, object]:
    metadata = getattr(parsed_pages, "metadata", None)
    if metadata is not None:
        if hasattr(metadata, "model_dump"):
            dumped = metadata.model_dump()
            return dumped if isinstance(dumped, dict) else {}
        if isinstance(metadata, dict):
            return metadata
    if isinstance(parsed_pages, dict):
        nested = parsed_pages.get("metadata")
        if isinstance(nested, dict):
            return nested
        if nested is not None and hasattr(nested, "model_dump"):
            dumped = nested.model_dump()
            return dumped if isinstance(dumped, dict) else {}
    return {}


def _normalize_paperqa_pages(parsed_pages: object) -> tuple[list[str], dict[str, object], list[str]]:
    content = _parsed_content_map(parsed_pages)
    metadata = _parsed_metadata_dict(parsed_pages)
    warnings: list[str] = []
    page_texts: list[str] = []
    empty_pages = 0

    if not content:
        warnings.append("PaperQA2 returned no page records.")
        return page_texts, metadata, warnings

    def _page_sort_key(key: str) -> tuple[int, str]:
        try:
            return (0, f"{int(key):09d}")
        except ValueError:
            return (1, key)

    for page_key in sorted(content.keys(), key=_page_sort_key):
        page_value = content[page_key]
        text = _page_content_text(page_value)
        if not text:
            empty_pages += 1
        try:
            page_number = int(page_key)
        except (TypeError, ValueError):
            page_number = _page_number(page_value) or len(page_texts) + 1
        page_texts.append(f"\n\n[Page {page_number}]\n{text}\n")

    if empty_pages:
        warnings.append(f"PaperQA2 returned {empty_pages} page(s) with no text.")
    return page_texts, metadata, warnings


def _page_content_text(page_value: object) -> str:
    if isinstance(page_value, str):
        return page_value.strip()
    if isinstance(page_value, tuple) and page_value:
        head = page_value[0]
        return str(head or "").strip()
    if isinstance(page_value, dict):
        return str(page_value.get("text") or page_value.get("content") or page_value.get("page_text") or "").strip()
    for attribute in ("text", "content", "page_text"):
        value = getattr(page_value, attribute, None)
        if value and not isinstance(value, (list, tuple)):
            return str(value).strip()
    return ""


def _page_number(page: object) -> int | None:
    if isinstance(page, dict):
        value = page.get("page") or page.get("page_number") or page.get("number")
    else:
        value = getattr(page, "page", None) or getattr(page, "page_number", None) or getattr(page, "number", None)
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _iter_page_media(parsed_pages: object) -> list[tuple[int, object]]:
    collected: list[tuple[int, object]] = []
    for page_key, page_value in _parsed_content_map(parsed_pages).items():
        media_items: list[object] = []
        if isinstance(page_value, tuple) and len(page_value) > 1:
            tail = page_value[1]
            if isinstance(tail, list):
                media_items = tail
        try:
            page_number = int(page_key)
        except (TypeError, ValueError):
            page_number = len(collected) + 1
        for media in media_items:
            collected.append((page_number, media))
    return collected


def _media_png_bytes(media: object) -> bytes | None:
    data = getattr(media, "data", None)
    if isinstance(data, bytes) and data.startswith(b"\x89PNG\r\n\x1a\n"):
        return data
    if isinstance(data, bytes) and len(data) > 8:
        return data
    return None


def _media_info_dict(media: object) -> dict[str, Any]:
    info = getattr(media, "info", None)
    if isinstance(info, dict):
        return info
    return {}


def _write_figures_from_parsed(parsed_pages: object, output_dir: Path) -> tuple[list[ExtractedFigure], list[str]]:
    warnings: list[str] = []
    figures_dir = output_dir / FIGURES_DIR_NAME
    figures_dir.mkdir(parents=True, exist_ok=True)
    manifest_entries: list[dict[str, Any]] = []
    figures: list[ExtractedFigure] = []

    for page_number, media in _iter_page_media(parsed_pages):
        png_bytes = _media_png_bytes(media)
        if not png_bytes:
            continue
        media_index = int(getattr(media, "index", len(figures)) or len(figures))
        filename = f"page{page_number:03d}_fig{media_index + 1:02d}.png"
        artifact_name = f"{FIGURES_DIR_NAME}/{filename}"
        target_path = output_dir / artifact_name
        target_path.write_bytes(png_bytes)

        info = _media_info_dict(media)
        bbox_raw = info.get("bbox")
        bbox = [float(value) for value in bbox_raw] if isinstance(bbox_raw, (list, tuple)) else None
        media_type = str(info.get("type") or "").strip() or None
        width = info.get("width")
        height = info.get("height")
        try:
            width_int = int(width) if width is not None else None
        except (TypeError, ValueError):
            width_int = None
        try:
            height_int = int(height) if height is not None else None
        except (TypeError, ValueError):
            height_int = None

        caption = getattr(media, "text", None)
        caption_text = str(caption).strip() if caption else None

        figure = ExtractedFigure(
            artifact_name=artifact_name,
            page=page_number,
            index=media_index,
            media_type=media_type,
            bbox=bbox,
            width=width_int,
            height=height_int,
            byte_size=len(png_bytes),
        )
        figures.append(figure)
        manifest_entries.append(
            {
                "artifact_name": artifact_name,
                "page": page_number,
                "index": media_index,
                "media_type": media_type,
                "bbox": bbox,
                "width": width_int,
                "height": height_int,
                "byte_size": len(png_bytes),
                "caption": caption_text,
            }
        )

    manifest_path = output_dir / FIGURES_MANIFEST_NAME
    manifest_path.write_text(
        json.dumps({"figures": manifest_entries, "count": len(manifest_entries)}, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    if not manifest_entries:
        warnings.append("No embedded figures were extracted from the PDF.")
    return figures, warnings


def load_figures_manifest(output_dir: Path) -> list[dict[str, Any]]:
    manifest_path = output_dir / FIGURES_MANIFEST_NAME
    if not manifest_path.exists():
        return []
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    figures = payload.get("figures")
    return figures if isinstance(figures, list) else []


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
