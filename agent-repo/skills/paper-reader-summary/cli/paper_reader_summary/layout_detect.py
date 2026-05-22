from __future__ import annotations

import json
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image

from .layout_config import layout_enabled, layout_model_id
from .layout_runtime import get_layout_model
from .page_render import PageImage


LAYOUT_FILENAME = "layout.json"

# PubLayNet label -> internal type
PUBLAYNET_LABEL_MAP: dict[str, str] = {
    "Text": "paragraph",
    "Title": "title",
    "List": "paragraph",
    "Table": "table",
    "Figure": "figure",
    "Caption": "caption",
}


@dataclass(frozen=True)
class LayoutRegion:
    page: int
    type: str
    bbox: tuple[int, int, int, int]
    score: float
    text: str = ""
    region_index: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "page": self.page,
            "type": self.type,
            "bbox": list(self.bbox),
            "score": round(self.score, 4),
            "text": self.text,
            "region_index": self.region_index,
        }


def _map_label(label: str) -> str:
    normalized = str(label or "").strip()
    return PUBLAYNET_LABEL_MAP.get(normalized, normalized.lower() if normalized else "paragraph")


def _load_page_rgb_image(page_path: Path) -> Image.Image:
    """Paddle layout models require PIL/ndarray input, not filesystem paths."""
    with Image.open(page_path) as image:
        return image.convert("RGB")


def _maybe_equation(region: LayoutRegion) -> LayoutRegion:
    """Heuristic: wide short strips classified as figure may be equations."""
    x0, y0, x1, y1 = region.bbox
    width = x1 - x0
    height = y1 - y0
    if region.type != "figure" or height <= 0:
        return region
    aspect = width / height
    if height <= 48 and aspect >= 2.5:
        return LayoutRegion(
            page=region.page,
            type="equation",
            bbox=region.bbox,
            score=region.score,
            text=region.text,
            region_index=region.region_index,
        )
    return region


def detect_layout(
    pages: list[PageImage],
    *,
    enabled: bool | None = None,
) -> tuple[list[LayoutRegion], list[str], str]:
    """Run PubLayNet layout detection on rendered page images.

    Returns (regions, warnings, model_id) where model_id is LAYOUT_MODEL_ID when active,
    or \"disabled\" when layout inference is off or unavailable.
    """
    warnings: list[str] = []
    if enabled is None:
        enabled = layout_enabled()
    if not enabled:
        warnings.append("Layout detection disabled (PAPER_LAYOUT_ENABLED=false).")
        return [], warnings, "disabled"
    if not pages:
        warnings.append("No rendered pages available for layout detection.")
        return [], warnings, "disabled"

    model_id = layout_model_id()
    model, load_error = get_layout_model(model_id=model_id)
    if model is None:
        detail = load_error or "unknown error"
        warnings.append(f"Could not load layout model: {detail}")
        return [], warnings, "disabled"

    regions: list[LayoutRegion] = []
    region_counter = 0
    for page_image in pages:
        try:
            page_rgb = _load_page_rgb_image(page_image.path)
            layout = model.detect(page_rgb)
        except Exception as error:  # pragma: no cover
            warnings.append(f"Layout detection failed on page {page_image.page}: {error}")
            continue
        for block in layout:
            label = getattr(block, "type", None) or getattr(block, "category", None)
            internal_type = _map_label(str(label) if label is not None else "Text")
            block_bbox = block.block
            x0 = int(block_bbox.x_1)
            y0 = int(block_bbox.y_1)
            x1 = int(block_bbox.x_2)
            y1 = int(block_bbox.y_2)
            score = float(getattr(block, "score", 0.0) or 0.0)
            region = LayoutRegion(
                page=page_image.page,
                type=internal_type,
                bbox=(x0, y0, x1, y1),
                score=score,
                region_index=region_counter,
            )
            region_counter += 1
            regions.append(_maybe_equation(region))

    if regions:
        type_counts = Counter(region.type for region in regions)
        print(
            f"[multimodal] layout regions={len(regions)} by_type={dict(type_counts)}",
            file=sys.stderr,
            flush=True,
        )
    elif pages:
        print(
            "[multimodal] layout regions=0 (no blocks detected on rendered pages)",
            file=sys.stderr,
            flush=True,
        )

    return regions, warnings, model_id


def write_layout_json(path: Path, regions: list[LayoutRegion], *, model: str | None = None) -> None:
    resolved_model = model if model is not None else layout_model_id()
    payload = {
        "version": 1,
        "model": resolved_model,
        "regions": [region.to_dict() for region in regions],
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def regions_as_dicts(regions: list[LayoutRegion]) -> list[dict[str, Any]]:
    return [region.to_dict() for region in regions]
