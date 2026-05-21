from __future__ import annotations

from typing import Any


def bbox_tuple(raw: object) -> tuple[int, int, int, int] | None:
    if not isinstance(raw, (list, tuple)) or len(raw) < 4:
        return None
    try:
        x0, y0, x1, y1 = (int(raw[0]), int(raw[1]), int(raw[2]), int(raw[3]))
    except (TypeError, ValueError):
        return None
    if x1 <= x0 or y1 <= y0:
        return None
    return x0, y0, x1, y1


def bbox_center(bbox: tuple[int, int, int, int]) -> tuple[float, float]:
    x0, y0, x1, y1 = bbox
    return ((x0 + x1) / 2.0, (y0 + y1) / 2.0)


def horizontal_overlap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    ax0, _, ax1, _ = a
    bx0, _, bx1, _ = b
    overlap = min(ax1, bx1) - max(ax0, bx0)
    if overlap <= 0:
        return 0.0
    union = max(ax1, bx1) - min(ax0, bx0)
    return overlap / union if union > 0 else 0.0


def vertical_gap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    """Minimum vertical distance between two axis-aligned boxes."""
    _, ay0, _, ay1 = a
    _, by0, _, by1 = b
    if ay1 <= by0:
        return float(by0 - ay1)
    if by1 <= ay0:
        return float(ay0 - by1)
    return 0.0


def nearest_region(
    target: dict[str, Any],
    candidates: list[dict[str, Any]],
    *,
    type_filter: str | None = None,
    prefer_below: bool = True,
) -> dict[str, Any] | None:
    """Pick the closest candidate region on the same page (caption below figure, etc.)."""
    target_bbox = bbox_tuple(target.get("bbox"))
    if target_bbox is None:
        return None
    target_page = target.get("page")
    best: dict[str, Any] | None = None
    best_score = float("inf")

    for candidate in candidates:
        if candidate is target:
            continue
        if candidate.get("page") != target_page:
            continue
        if type_filter and candidate.get("type") != type_filter:
            continue
        cb = bbox_tuple(candidate.get("bbox"))
        if cb is None:
            continue
        gap = vertical_gap(target_bbox, cb)
        if prefer_below and cb[1] >= target_bbox[3]:
            gap = max(0.0, cb[1] - target_bbox[3])
        elif prefer_below:
            gap += 500.0
        overlap_penalty = 1.0 - horizontal_overlap(target_bbox, cb)
        score = gap + overlap_penalty * 50.0
        if score < best_score:
            best_score = score
            best = candidate
    return best


def regions_near_bbox(
    bbox: tuple[int, int, int, int],
    regions: list[dict[str, Any]],
    *,
    page: int,
    type_filter: str = "paragraph",
    margin_px: int = 40,
    max_chars: int = 2000,
) -> str:
    """Concatenate text from paragraph regions near a bbox on the same page."""
    x0, y0, x1, y1 = bbox
    expanded = (x0 - margin_px, y0 - margin_px, x1 + margin_px, y1 + margin_px)
    parts: list[str] = []
    total = 0
    for region in regions:
        if region.get("page") != page or region.get("type") != type_filter:
            continue
        rb = bbox_tuple(region.get("bbox"))
        if rb is None:
            continue
        cx, cy = bbox_center(rb)
        if not (expanded[0] <= cx <= expanded[2] and expanded[1] <= cy <= expanded[3]):
            continue
        text = str(region.get("text") or "").strip()
        if not text:
            continue
        if total + len(text) > max_chars:
            text = text[: max(0, max_chars - total)]
        parts.append(text)
        total += len(text)
        if total >= max_chars:
            break
    return "\n".join(parts).strip()
