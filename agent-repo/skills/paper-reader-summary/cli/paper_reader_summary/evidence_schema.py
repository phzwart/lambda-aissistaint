from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


EVIDENCE_VERSION = 1
EVIDENCE_FILENAME = "evidence.json"


def empty_links() -> dict[str, list[str]]:
    return {
        "nearby": [],
        "caption_of": [],
        "has_caption": [],
        "mentioned_by": [],
        "referenced_by": [],
    }


@dataclass
class EvidenceObject:
    id: str
    paper_id: str
    source_hash: str
    page: int
    bbox: list[int]
    type: str
    text: str = ""
    image_path: str | None = None
    links: dict[str, list[str]] = field(default_factory=empty_links)
    metadata: dict[str, Any] = field(default_factory=dict)
    embedding: Any = None
    latex: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": self.id,
            "paper_id": self.paper_id,
            "source_hash": self.source_hash,
            "page": self.page,
            "bbox": self.bbox,
            "type": self.type,
            "text": self.text,
            "image_path": self.image_path,
            "links": self.links,
            "metadata": self.metadata,
            "embedding": self.embedding,
        }
        if self.type == "equation" and self.latex is not None:
            payload["latex"] = self.latex
        elif self.type == "equation":
            payload["latex"] = None
        return payload


def evidence_id_for(type_name: str, page: int, index: int) -> str:
    prefix = {"figure": "fig", "equation": "eq", "table": "tbl", "text": "txt"}.get(type_name, type_name)
    return f"{prefix}_p{page:03d}_{index:02d}"


def write_evidence_json(path: Path, *, paper_id: str, source_hash: str, objects: list[EvidenceObject]) -> None:
    payload = {
        "version": EVIDENCE_VERSION,
        "paper_id": paper_id,
        "source_hash": source_hash,
        "objects": [obj.to_dict() for obj in objects],
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def load_evidence_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": EVIDENCE_VERSION, "objects": []}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"version": EVIDENCE_VERSION, "objects": []}
    return payload if isinstance(payload, dict) else {"version": EVIDENCE_VERSION, "objects": []}
