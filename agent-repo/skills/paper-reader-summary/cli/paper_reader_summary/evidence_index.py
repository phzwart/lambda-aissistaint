from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .evidence_schema import EvidenceObject


@dataclass
class EvidenceIndex:
    """Lookup evidence objects by id and page for retrieval augmentation."""

    objects: list[EvidenceObject] = field(default_factory=list)
    by_id: dict[str, EvidenceObject] = field(default_factory=dict)
    by_page: dict[int, list[EvidenceObject]] = field(default_factory=dict)

    @classmethod
    def from_objects(cls, objects: list[EvidenceObject]) -> "EvidenceIndex":
        index = cls(objects=list(objects))
        for obj in objects:
            index.by_id[obj.id] = obj
            index.by_page.setdefault(obj.page, []).append(obj)
        return index

    def ids_for_page(self, page: int | None) -> list[str]:
        if page is None:
            return []
        return [obj.id for obj in self.by_page.get(int(page), [])]

    def linked_ids_for_span(self, span: dict[str, Any]) -> list[str]:
        explicit = span.get("linked_evidence_ids")
        if isinstance(explicit, list) and explicit:
            return [str(value) for value in explicit]
        page = span.get("page")
        return self.ids_for_page(int(page) if page is not None else None)

    def linked_ids_for_context(
        self,
        *,
        matched_span_id: str | None,
        spans: list[dict[str, Any]],
        citation: str | None = None,
    ) -> list[str]:
        if matched_span_id:
            for span in spans:
                if span.get("span_id") == matched_span_id:
                    return self.linked_ids_for_span(span)
        if citation:
            from .provenance_substrate import CITATION_PAGE_PATTERN

            match = CITATION_PAGE_PATTERN.search(citation)
            if match:
                try:
                    page = int(match.group(1))
                    return self.ids_for_page(page)
                except (TypeError, ValueError):
                    pass
        return []
