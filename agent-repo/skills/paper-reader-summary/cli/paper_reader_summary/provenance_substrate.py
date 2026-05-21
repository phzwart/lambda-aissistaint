from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

PAGE_MARKER_PATTERN = re.compile(r"\[Page\s+(\d+)\]", re.IGNORECASE)
CITATION_PAGE_PATTERN = re.compile(r"p(?:p|ages?)?\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?", re.IGNORECASE)


def sha256_hex(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def source_hash_from_pdf(path: Path) -> str:
    return sha256_hex(path.read_bytes())


def span_id_for(source_hash: str, chunk_index: int, char_start: int, char_end: int) -> str:
    payload = f"{source_hash}:{chunk_index}:{char_start}:{char_end}"
    return sha256_hex(payload)


def build_source_spans(full_text: str, source_hash: str) -> list[dict[str, Any]]:
    """Build page-level spans with char offsets into extracted.txt."""
    spans: list[dict[str, Any]] = []
    markers = list(PAGE_MARKER_PATTERN.finditer(full_text))
    if not markers:
        if full_text.strip():
            end = len(full_text)
            spans.append(
                _span_record(
                    source_hash=source_hash,
                    chunk_index=0,
                    char_start=0,
                    char_end=end,
                    page=None,
                    text=full_text,
                )
            )
        return spans

    for index, match in enumerate(markers):
        char_start = match.start()
        char_end = markers[index + 1].start() if index + 1 < len(markers) else len(full_text)
        page = None
        try:
            page = int(match.group(1))
        except (TypeError, ValueError):
            page = index + 1
        block_text = full_text[char_start:char_end]
        spans.append(
            _span_record(
                source_hash=source_hash,
                chunk_index=index,
                char_start=char_start,
                char_end=char_end,
                page=page,
                text=block_text,
            )
        )
    return spans


def write_source_spans_jsonl(path: Path, spans: list[dict[str, Any]]) -> None:
    lines = [json.dumps(span, ensure_ascii=False, sort_keys=True) for span in spans]
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def _span_record(
    *,
    source_hash: str,
    chunk_index: int,
    char_start: int,
    char_end: int,
    page: int | None,
    text: str,
) -> dict[str, Any]:
    preview = text.strip().replace("\n", " ")[:120]
    sid = span_id_for(source_hash, chunk_index, char_start, char_end)
    return {
        "source_hash": source_hash,
        "span_id": sid,
        "chunk_index": chunk_index,
        "char_start": char_start,
        "char_end": char_end,
        "page": page,
        "text_preview": preview,
    }


def _context_text(context: object) -> str:
    if isinstance(context, str):
        return context.strip()
    if isinstance(context, dict):
        for key in ("text", "context", "content", "raw_text"):
            value = context.get(key)
            if value:
                return str(value).strip()
    for attribute in ("text", "context", "content"):
        value = getattr(context, attribute, None)
        if value:
            return str(value).strip()
    return str(context).strip()


def _context_score(context: object) -> float | None:
    if isinstance(context, dict):
        score = context.get("score")
    else:
        score = getattr(context, "score", None)
    try:
        return float(score) if score is not None else None
    except (TypeError, ValueError):
        return None


def _context_citation(context: object) -> str | None:
    if isinstance(context, dict):
        for key in ("citation", "cite", "docname"):
            value = context.get(key)
            if value:
                return str(value).strip()
    for attribute in ("citation", "cite", "docname"):
        value = getattr(context, attribute, None)
        if value:
            return str(value).strip()
    return None


def match_span_for_context(
    context_text: str,
    citation: str | None,
    spans: list[dict[str, Any]],
    *,
    full_text: str,
) -> str | None:
    if not context_text.strip():
        return None
    page_hint: int | None = None
    if citation:
        match = CITATION_PAGE_PATTERN.search(citation)
        if match:
            try:
                page_hint = int(match.group(1))
            except (TypeError, ValueError):
                page_hint = None
    candidates = spans
    if page_hint is not None:
        page_matches = [span for span in spans if span.get("page") == page_hint]
        if page_matches:
            candidates = page_matches
    snippet = context_text[:200].strip()
    if not snippet:
        return None
    for span in candidates:
        start = int(span["char_start"])
        end = int(span["char_end"])
        block = full_text[start:end]
        if snippet in block or block[: len(snippet)] in context_text:
            return str(span["span_id"])
    return candidates[0]["span_id"] if len(candidates) == 1 else None


def serialize_paperqa_contexts(
    session: object,
    *,
    extraction_step_id: str,
    spans: list[dict[str, Any]],
    full_text: str,
) -> dict[str, Any]:
    contexts_raw = getattr(session, "contexts", None) or getattr(session, "context", None)
    serialized: list[dict[str, Any]] = []
    if contexts_raw is not None:
        try:
            items = list(contexts_raw)
        except TypeError:
            items = []
        for index, context in enumerate(items):
            text = _context_text(context)
            citation = _context_citation(context)
            serialized.append(
                {
                    "context_index": index,
                    "text": text[:4000],
                    "score": _context_score(context),
                    "citation": citation,
                    "matched_span_id": match_span_for_context(text, citation, spans, full_text=full_text),
                }
            )
    return {
        "extraction_step_id": extraction_step_id,
        "contexts": serialized,
    }


def append_llm_call_record(
    records: list[dict[str, Any]],
    *,
    extraction_step_id: str,
    model_alias: str,
    prompt: str,
    response: str,
    duration_ms: int | None = None,
) -> None:
    records.append(
        {
            "call_id": sha256_hex(f"{extraction_step_id}:{len(records)}:{prompt[:64]}"),
            "extraction_step_id": extraction_step_id,
            "model_alias": model_alias,
            "prompt_hash": sha256_hex(prompt),
            "response_hash": sha256_hex(response),
            "prompt_tokens": None,
            "completion_tokens": None,
            "duration_ms": duration_ms,
        }
    )


def write_paperqa_evidence(path: Path, passes: list[dict[str, Any]]) -> None:
    payload = {"version": 1, "passes": passes}
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def write_llm_calls_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    lines = [json.dumps(record, ensure_ascii=False, sort_keys=True) for record in records]
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
