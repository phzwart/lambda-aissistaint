from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .chunk_augment import (
    CHUNKS_FILENAME,
    MULTIMODAL_CONTEXT_FILENAME,
    augment_spans_with_evidence,
    build_chunks_json,
    build_multimodal_context,
    write_chunks_json,
    write_multimodal_context,
)
from .debug_viz import write_layout_overlays
from .evidence_extract import FIGURES_MANIFEST_NAME, extract_evidence_from_layout, load_legacy_figures_from_manifest
from .evidence_index import EvidenceIndex
from .evidence_schema import EvidenceObject
from .layout_config import layout_enabled
from .layout_detect import LAYOUT_FILENAME, detect_layout, write_layout_json
from .layout_runtime import log_layout_runtime_status
from .page_render import PageImage, render_pdf_pages, resolve_render_dpi


@dataclass
class MultimodalPreprocessResult:
    pages: list[PageImage] = field(default_factory=list)
    evidence_objects: list[EvidenceObject] = field(default_factory=list)
    evidence_index: EvidenceIndex = field(default_factory=EvidenceIndex)
    warnings: list[str] = field(default_factory=list)
    layout_region_count: int = 0
    figure_count_layout: int = 0
    multimodal_metadata: dict[str, Any] = field(default_factory=dict)


def run_multimodal_preprocess(
    pdf_path: Path,
    output_dir: Path,
    *,
    paper_id: str,
    source_hash: str,
    full_text: str,
    render_dpi: int | None = None,
    legacy_figures: list[dict[str, Any]] | None = None,
) -> MultimodalPreprocessResult:
    """Additive multimodal band: render pages, layout, evidence crops, chunk sidecars."""
    del full_text  # reserved for future paragraph OCR overlap
    warnings: list[str] = []
    dpi = resolve_render_dpi(render_dpi)
    layout_runtime_status = log_layout_runtime_status()

    try:
        pages = render_pdf_pages(pdf_path, output_dir, dpi=dpi)
    except Exception as error:
        warnings.append(f"Page rendering failed: {error}")
        pages = []

    regions, layout_warnings, layout_model_id = detect_layout(pages, enabled=layout_enabled())
    warnings.extend(layout_warnings)
    write_layout_json(output_dir / LAYOUT_FILENAME, regions, model=layout_model_id)

    legacy = legacy_figures
    if legacy is None:
        legacy = load_legacy_figures_from_manifest(output_dir)

    evidence_objects: list[EvidenceObject] = []
    if regions and pages:
        evidence_objects, _manifest, extract_warnings = extract_evidence_from_layout(
            pages,
            regions,
            output_dir,
            paper_id=paper_id,
            source_hash=source_hash,
            legacy_figures=legacy,
        )
        warnings.extend(extract_warnings)
    elif legacy:
        from .evidence_extract import build_extended_figures_manifest

        manifest_payload = build_extended_figures_manifest([], legacy)
        (output_dir / FIGURES_MANIFEST_NAME).write_text(
            json.dumps(manifest_payload, indent=2, sort_keys=True),
            encoding="utf-8",
        )

    if not evidence_objects:
        from .evidence_schema import write_evidence_json

        write_evidence_json(
            output_dir / "evidence.json",
            paper_id=paper_id,
            source_hash=source_hash,
            objects=[],
        )

    figure_count = sum(1 for obj in evidence_objects if obj.type == "figure")
    debug_paths = write_layout_overlays(pages, regions, output_dir, evidence_objects=evidence_objects)

    index = EvidenceIndex.from_objects(evidence_objects)
    metadata = {
        "render_dpi": dpi,
        "page_count_rendered": len(pages),
        "layout_region_count": len(regions),
        "figure_count_layout": figure_count,
        "equation_count_layout": sum(1 for obj in evidence_objects if obj.type == "equation"),
        "layout_enabled": layout_enabled(),
        "layout_model": layout_model_id,
        "layout_runtime": layout_runtime_status,
        "debug_artifacts": debug_paths,
    }
    return MultimodalPreprocessResult(
        pages=pages,
        evidence_objects=evidence_objects,
        evidence_index=index,
        warnings=warnings,
        layout_region_count=len(regions),
        figure_count_layout=figure_count,
        multimodal_metadata=metadata,
    )


def finalize_multimodal_artifacts(
    output_dir: Path,
    *,
    spans: list[dict[str, Any]],
    result: MultimodalPreprocessResult,
) -> list[dict[str, Any]]:
    """Augment spans and write chunks.json + multimodal_context.json."""
    augmented = augment_spans_with_evidence(spans, result.evidence_objects)
    write_chunks_json(output_dir / CHUNKS_FILENAME, build_chunks_json(augmented, result.evidence_objects))
    write_multimodal_context(
        output_dir / MULTIMODAL_CONTEXT_FILENAME,
        build_multimodal_context(augmented, result.evidence_objects),
    )
    return augmented
