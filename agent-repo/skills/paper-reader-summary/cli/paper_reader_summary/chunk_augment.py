from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .evidence_schema import EvidenceObject


CHUNKS_FILENAME = "chunks.json"
MULTIMODAL_CONTEXT_FILENAME = "multimodal_context.json"


def _evidence_by_page(objects: list[EvidenceObject]) -> dict[int, list[EvidenceObject]]:
    by_page: dict[int, list[EvidenceObject]] = {}
    for obj in objects:
        by_page.setdefault(obj.page, []).append(obj)
    return by_page


def _ids_for_type(objects: list[EvidenceObject], type_name: str) -> list[str]:
    return [obj.id for obj in objects if obj.type == type_name]


def augment_spans_with_evidence(
    spans: list[dict[str, Any]],
    evidence_objects: list[EvidenceObject],
) -> list[dict[str, Any]]:
    """Add linked_evidence_ids to each source span based on page association."""
    by_page = _evidence_by_page(evidence_objects)
    augmented: list[dict[str, Any]] = []
    for span in spans:
        record = dict(span)
        page = record.get("page")
        linked: list[str] = []
        if page is not None:
            for obj in by_page.get(int(page), []):
                linked.append(obj.id)
        record["linked_evidence_ids"] = linked
        augmented.append(record)
    return augmented


def build_chunks_json(
    spans: list[dict[str, Any]],
    evidence_objects: list[EvidenceObject],
) -> dict[str, Any]:
    by_page = _evidence_by_page(evidence_objects)
    chunks: list[dict[str, Any]] = []
    for span in spans:
        page = span.get("page")
        page_refs = [int(page)] if page is not None else []
        page_evidence = by_page.get(int(page), []) if page is not None else []
        chunks.append(
            {
                "span_id": span.get("span_id"),
                "chunk_index": span.get("chunk_index"),
                "page_refs": page_refs,
                "text_preview": span.get("text_preview", ""),
                "linked_figures": _ids_for_type(page_evidence, "figure"),
                "linked_equations": _ids_for_type(page_evidence, "equation"),
                "linked_tables": _ids_for_type(page_evidence, "table"),
                "linked_evidence_ids": span.get("linked_evidence_ids", []),
            }
        )
    return {"version": 1, "chunks": chunks}


def build_multimodal_context(
    spans: list[dict[str, Any]],
    evidence_objects: list[EvidenceObject],
) -> dict[str, Any]:
    span_ids = [str(span["span_id"]) for span in spans if span.get("span_id")]
    return {
        "text_chunks": span_ids,
        "linked_figures": _ids_for_type(evidence_objects, "figure"),
        "linked_equations": _ids_for_type(evidence_objects, "equation"),
        "linked_tables": _ids_for_type(evidence_objects, "table"),
    }


def write_chunks_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def write_multimodal_context(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
