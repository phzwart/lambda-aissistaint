from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from PIL import Image

from .evidence_schema import EVIDENCE_FILENAME, EvidenceObject, empty_links, evidence_id_for, write_evidence_json
from .layout_detect import LayoutRegion, regions_as_dicts
from .page_render import PageImage
from .spatial_link import nearest_region, regions_near_bbox


FIGURES_DIR_NAME = "figures"
EQUATIONS_DIR_NAME = "equations"
FIGURES_MANIFEST_NAME = "figures_manifest.json"

INLINE_EQUATION_MAX_HEIGHT_PT = 40
INLINE_EQUATION_MIN_ASPECT_RATIO = 2.5


def equation_ocr_enabled() -> bool:
    return os.environ.get("PAPER_EQUATION_OCR", "").strip().lower() in {"1", "true", "yes", "on"}


def run_equation_ocr(_image_path: Path) -> str | None:
    """Stub for optional LaTeX OCR; returns None until a backend is wired."""
    if not equation_ocr_enabled():
        return None
    return None


def _crop_region(page_path: Path, bbox: tuple[int, int, int, int], target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(page_path) as image:
        cropped = image.crop(bbox)
        cropped.save(target, format="PNG")


def _figure_filename(page: int, index: int) -> str:
    return f"fig_p{page:03d}_{index:02d}.png"


def _equation_filename(page: int, index: int) -> str:
    return f"eq_p{page:03d}_{index:02d}.png"


def extract_evidence_from_layout(
    pages: list[PageImage],
    regions: list[LayoutRegion],
    output_dir: Path,
    *,
    paper_id: str,
    source_hash: str,
    legacy_figures: list[dict[str, Any]] | None = None,
) -> tuple[list[EvidenceObject], dict[str, Any], list[str]]:
    """Crop figures/equations from rendered pages and build evidence objects."""
    warnings: list[str] = []
    page_by_number = {page.page: page for page in pages}
    region_dicts = regions_as_dicts(regions)
    objects: list[EvidenceObject] = []
    manifest_figures: list[dict[str, Any]] = []
    figure_counts: dict[int, int] = {}
    equation_counts: dict[int, int] = {}

    for region in regions:
        if region.type not in {"figure", "equation", "table"}:
            continue
        page_image = page_by_number.get(region.page)
        if page_image is None:
            warnings.append(f"No rendered page for evidence on page {region.page}.")
            continue
        bbox = region.bbox
        if region.type == "figure":
            figure_counts[region.page] = figure_counts.get(region.page, 0) + 1
            idx = figure_counts[region.page]
            filename = _figure_filename(region.page, idx)
            artifact_name = f"{FIGURES_DIR_NAME}/{filename}"
            evidence_id = evidence_id_for("figure", region.page, idx)
        elif region.type == "equation":
            equation_counts[region.page] = equation_counts.get(region.page, 0) + 1
            idx = equation_counts[region.page]
            filename = _equation_filename(region.page, idx)
            artifact_name = f"{EQUATIONS_DIR_NAME}/{filename}"
            evidence_id = evidence_id_for("equation", region.page, idx)
        else:
            tbl_counts = figure_counts  # reuse counter namespace per page for tables
            tbl_counts[region.page] = tbl_counts.get(region.page, 0) + 1
            idx = tbl_counts[region.page]
            filename = f"tbl_p{region.page:03d}_{idx:02d}.png"
            artifact_name = f"{FIGURES_DIR_NAME}/{filename}"
            evidence_id = evidence_id_for("table", region.page, idx)

        target_path = output_dir / artifact_name
        try:
            _crop_region(page_image.path, bbox, target_path)
        except Exception as error:
            warnings.append(f"Failed to crop {evidence_id}: {error}")
            continue

        caption_text = ""
        caption_region = nearest_region(
            region.to_dict(),
            region_dicts,
            type_filter="caption",
            prefer_below=True,
        )
        if caption_region:
            caption_text = str(caption_region.get("text") or "").strip()
        nearby_text = regions_near_bbox(bbox, region_dicts, page=region.page)
        combined_text = caption_text
        if nearby_text and nearby_text not in combined_text:
            combined_text = f"{combined_text}\n{nearby_text}".strip() if combined_text else nearby_text

        links = empty_links()
        if caption_region:
            cap_id = f"cap_p{region.page:03d}_{caption_region.get('region_index', 0):02d}"
            links["has_caption"] = [cap_id]
            links["caption_of"] = []

        latex = None
        if region.type == "equation":
            latex = run_equation_ocr(target_path)

        obj = EvidenceObject(
            id=evidence_id,
            paper_id=paper_id,
            source_hash=source_hash,
            page=region.page,
            bbox=list(bbox),
            type=region.type,
            text=combined_text or caption_text,
            image_path=artifact_name,
            links=links,
            metadata={"score": region.score, "layout_region_index": region.region_index},
            latex=latex,
        )
        objects.append(obj)

        if region.type == "figure":
            manifest_figures.append(
                {
                    "id": evidence_id,
                    "artifact_name": artifact_name,
                    "page": region.page,
                    "index": idx,
                    "bbox": list(bbox),
                    "caption": caption_text or None,
                    "nearby_text": nearby_text or None,
                    "extraction_method": "layout_crop",
                    "media_type": "figure",
                    "width": bbox[2] - bbox[0],
                    "height": bbox[3] - bbox[1],
                }
            )

    write_evidence_json(output_dir / EVIDENCE_FILENAME, paper_id=paper_id, source_hash=source_hash, objects=objects)
    manifest_payload = build_extended_figures_manifest(manifest_figures, legacy_figures or [])
    manifest_path = output_dir / FIGURES_MANIFEST_NAME
    manifest_path.write_text(json.dumps(manifest_payload, indent=2, sort_keys=True), encoding="utf-8")
    return objects, manifest_payload, warnings


def build_extended_figures_manifest(
    layout_figures: list[dict[str, Any]],
    legacy_figures: list[dict[str, Any]],
) -> dict[str, Any]:
    """Non-breaking figures_manifest: layout crops primary, embedded media under legacy_embedded."""
    legacy_entries = []
    for entry in legacy_figures:
        normalized = dict(entry)
        normalized.setdefault("extraction_method", "embedded_pdf")
        legacy_entries.append(normalized)
    combined = list(layout_figures)
    if not combined and legacy_entries:
        combined = legacy_entries
    return {
        "figures": combined,
        "count": len(combined),
        "legacy_embedded": legacy_entries if layout_figures else [],
        "legacy_embedded_count": len(legacy_entries) if layout_figures else 0,
        "skipped": [],
        "skipped_count": 0,
    }


def load_legacy_figures_from_manifest(output_dir: Path) -> list[dict[str, Any]]:
    path = output_dir / FIGURES_MANIFEST_NAME
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    if isinstance(payload.get("legacy_embedded"), list):
        return payload["legacy_embedded"]
    figures = payload.get("figures")
    if not isinstance(figures, list):
        return []
    legacy: list[dict[str, Any]] = []
    for entry in figures:
        method = str(entry.get("extraction_method") or "").strip()
        if method in {"", "embedded_pdf", "legacy_embedded"}:
            legacy.append(entry)
    return legacy
