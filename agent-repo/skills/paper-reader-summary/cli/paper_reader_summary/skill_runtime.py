from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .schema import (
    DEFAULT_EXTENDED_ABSTRACT_INSTRUCTION,
    DEFAULT_FOLLOW_UP_QUESTIONS_INSTRUCTION,
    DEFAULT_STRUCTURED_SUMMARY_INSTRUCTION,
    load_default_follow_up_questions_instruction,
    load_default_knowledge_graph_instruction,
)


def load_skill_runtime(path: object) -> dict[str, Any]:
    if not path:
        return {}
    runtime_path = Path(str(path)).expanduser()
    if not runtime_path.is_file():
        return {}
    try:
        payload = json.loads(runtime_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def resolve_instructions(runtime: dict[str, Any]) -> dict[str, Any]:
    instructions = runtime.get("instructions") if isinstance(runtime.get("instructions"), dict) else {}
    extended = str(instructions.get("extendedAbstract") or "").strip()
    follow_up = str(instructions.get("followUpQuestions") or "").strip()
    knowledge_graph = str(instructions.get("knowledgeGraph") or "").strip()
    summary = str(instructions.get("structuredSummary") or "").strip()
    return {
        "file_id": str(runtime.get("fileId") or "").strip(),
        "citation_label": str(runtime.get("citationLabel") or "").strip(),
        "file_name": str(runtime.get("fileName") or "").strip(),
        "object_key": str(runtime.get("objectKey") or "").strip(),
        "structured_summary_instruction": summary or DEFAULT_STRUCTURED_SUMMARY_INSTRUCTION,
        "extended_abstract_instruction": extended or DEFAULT_EXTENDED_ABSTRACT_INSTRUCTION,
        "follow_up_questions_instruction": follow_up or load_default_follow_up_questions_instruction(),
        "knowledge_graph_instruction": knowledge_graph or load_default_knowledge_graph_instruction(),
        "extended_abstract_enabled": instructions.get("extendedAbstractEnabled") is not False,
        "follow_up_questions_enabled": instructions.get("followUpQuestionsEnabled") is not False,
        "knowledge_graph_enabled": instructions.get("knowledgeGraphEnabled") is not False,
    }
