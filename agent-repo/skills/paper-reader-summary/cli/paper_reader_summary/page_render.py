from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


PAGES_DIR_NAME = "pages"
DEFAULT_RENDER_DPI = 300


@dataclass(frozen=True)
class PageImage:
    page: int
    width: int
    height: int
    path: Path
    dpi: int


def resolve_render_dpi(cli_dpi: int | None = None) -> int:
    if cli_dpi is not None and cli_dpi > 0:
        return int(cli_dpi)
    raw = os.environ.get("PAPER_RENDER_DPI", "").strip()
    if raw:
        try:
            value = int(raw)
            if value > 0:
                return value
        except ValueError:
            pass
    return DEFAULT_RENDER_DPI


def page_image_filename(page: int) -> str:
    return f"page_{page:04d}.png"


def render_pdf_pages(
    pdf_path: Path,
    output_dir: Path,
    *,
    dpi: int = DEFAULT_RENDER_DPI,
) -> list[PageImage]:
    """Render each PDF page to PNG at the given DPI (additive; does not replace text extraction)."""
    try:
        import fitz  # PyMuPDF
    except ImportError as error:
        raise RuntimeError(
            "Page rendering requires PyMuPDF (fitz). Install paper-qa-pymupdf dependencies."
        ) from error

    pdf_path = pdf_path.expanduser().resolve()
    pages_dir = output_dir / PAGES_DIR_NAME
    pages_dir.mkdir(parents=True, exist_ok=True)

    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    results: list[PageImage] = []

    with fitz.open(pdf_path) as document:
        for page_index in range(document.page_count):
            page_number = page_index + 1
            target = pages_dir / page_image_filename(page_number)
            page = document.load_page(page_index)
            if target.exists():
                try:
                    pix = fitz.Pixmap(str(target))
                    width, height = pix.width, pix.height
                    pix = None
                except Exception:
                    pixmap = page.get_pixmap(matrix=matrix, alpha=False)
                    pixmap.save(str(target))
                    width, height = pixmap.width, pixmap.height
            else:
                pixmap = page.get_pixmap(matrix=matrix, alpha=False)
                pixmap.save(str(target))
                width, height = pixmap.width, pixmap.height
            results.append(
                PageImage(
                    page=page_number,
                    width=width,
                    height=height,
                    path=target,
                    dpi=dpi,
                )
            )
    return results
