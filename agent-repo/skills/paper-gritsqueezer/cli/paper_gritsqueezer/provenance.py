"""Standalone provenance helpers for paper-gritsqueezer.

Duplicated (intentionally, no shared package) from the paper-reader-summary
runner: source-span building, hashing, and LLM call audit logging.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

PAGE_MARKER_PATTERN = re.compile(r"\[Page (\d+)\]")


def sha256_hex(value: str | bytes) -> str:
    data = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(data).hexdigest()


def source_hash_from_pdf(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).expanduser().open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def span_id_for(source_hash: str, chunk_index: int, char_start: int, char_end: int) -> str:
    payload = f"{source_hash}:{chunk_index}:{char_start}:{char_end}"
    return f"span:{sha256_hex(payload)[:16]}"


def build_source_spans(full_text: str, source_hash: str) -> list[dict[str, Any]]:
    """Build page-level spans with char offsets into the extracted text."""
    spans: list[dict[str, Any]] = []
    markers = list(PAGE_MARKER_PATTERN.finditer(full_text))
    if not markers:
        if full_text.strip():
            spans.append(
                _span_record(
                    source_hash=source_hash,
                    chunk_index=0,
                    char_start=0,
                    char_end=len(full_text),
                    page=None,
                    text=full_text,
                )
            )
        return spans

    for index, match in enumerate(markers):
        char_start = match.start()
        char_end = markers[index + 1].start() if index + 1 < len(markers) else len(full_text)
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
    Path(path).write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


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


def write_llm_calls_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    lines = [json.dumps(record, ensure_ascii=False, sort_keys=True) for record in records]
    Path(path).write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
