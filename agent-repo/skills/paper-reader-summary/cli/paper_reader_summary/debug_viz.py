from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

from .evidence_schema import EvidenceObject
from .layout_detect import LayoutRegion
from .page_render import PageImage


DEBUG_DIR_NAME = "debug"

_TYPE_COLORS: dict[str, tuple[int, int, int]] = {
    "title": (255, 200, 0),
    "paragraph": (0, 180, 255),
    "figure": (0, 220, 100),
    "caption": (255, 120, 0),
    "table": (180, 0, 255),
    "equation": (255, 80, 80),
}


def debug_enabled() -> bool:
    raw = os.environ.get("PAPER_MULTIMODAL_DEBUG", "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def write_layout_overlays(
    pages: list[PageImage],
    regions: list[LayoutRegion],
    output_dir: Path,
    *,
    evidence_objects: list[EvidenceObject] | None = None,
) -> list[str]:
    if not debug_enabled():
        return []
    debug_dir = output_dir / DEBUG_DIR_NAME
    debug_dir.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    page_map = {page.page: page for page in pages}
    regions_by_page: dict[int, list[LayoutRegion]] = {}
    for region in regions:
        regions_by_page.setdefault(region.page, []).append(region)

    for page_num, page_image in page_map.items():
        overlay_name = f"layout_overlay_p{page_num:03d}.png"
        overlay_path = debug_dir / overlay_name
        try:
            with Image.open(page_image.path) as base:
                draw = ImageDraw.Draw(base)
                for region in regions_by_page.get(page_num, []):
                    color = _TYPE_COLORS.get(region.type, (200, 200, 200))
                    draw.rectangle(region.bbox, outline=color, width=3)
                    draw.text((region.bbox[0] + 2, region.bbox[1] + 2), region.type, fill=color)
                if evidence_objects:
                    for obj in evidence_objects:
                        if obj.page != page_num:
                            continue
                        bbox = tuple(obj.bbox)
                        if len(bbox) == 4:
                            draw.rectangle(bbox, outline=(255, 255, 0), width=2)
                base.save(overlay_path, format="PNG")
            written.append(f"{DEBUG_DIR_NAME}/{overlay_name}")
        except Exception:
            continue

    preview = {
        "pages": len(pages),
        "regions": len(regions),
        "evidence_count": len(evidence_objects or []),
        "overlays": written,
    }
    preview_path = debug_dir / "evidence_preview.json"
    preview_path.write_text(json.dumps(preview, indent=2, sort_keys=True), encoding="utf-8")
    written.append(f"{DEBUG_DIR_NAME}/evidence_preview.json")
    return written
