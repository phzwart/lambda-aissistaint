import json

import pytest

from paper_gritsqueezer.extract import ExtractionResult
from paper_gritsqueezer.grit_squeezer import (
    GritSegment,
    _inject_required_fields,
    _parse_llm_json_array,
    _parse_verification_verdict,
    run_grit_squeezer,
    segment_paper,
    validate_bundle,
)
from paper_gritsqueezer.provenance import build_source_spans, sha256_hex
from paper_gritsqueezer.settings import RuntimeSettings
from pygrits.core import CharRangeLocator, ContentReference, EvidenceRecord, HashMode


def test_segment_paper_produces_segments():
    text = "[Page 1]\nAbstract text here.\n\n[Page 2]\nMethods section.\nWe used X.\n"
    extraction = ExtractionResult(
        source_path="test.pdf",
        source_name="test.pdf",
        input_type="pdf",
        text=text,
        page_count=2,
    )
    sha256 = sha256_hex(b"test")
    spans = build_source_spans(text, sha256)
    segments = segment_paper(extraction, spans)
    assert len(segments) >= 1
    for seg in segments:
        assert seg.char_start < seg.char_end
        assert seg.char_end <= len(text)
        assert seg.text == text[seg.char_start : seg.char_start + len(seg.text)]


def test_parse_llm_json_array_strips_fences():
    raw = '```json\n[{"id": "evi:test", "type": "pp:claim"}]\n```'
    warnings = []
    result = _parse_llm_json_array(raw, warnings)
    assert len(result) == 1
    assert result[0]["id"] == "evi:test"
    assert not warnings


def test_parse_llm_json_array_garbage():
    warnings = []
    result = _parse_llm_json_array("This is not JSON at all.", warnings)
    assert result == []
    assert warnings


def test_inject_required_fields_injects_sar():
    seg = GritSegment(
        text="test",
        char_start=0,
        char_end=4,
        page=1,
        section=None,
        segment_type="abstract",
    )
    result = _inject_required_fields(
        {}, seg, "file://test.pdf", "a" * 64, ["Do not claim X."], "vpt:paper-extraction-v1"
    )
    assert result["source_artifact_ref"]["uri"] == "file://test.pdf"
    assert result["source_artifact_ref"]["sha256"] == "a" * 64
    assert result["locator"]["locator_type"] == "CharRangeLocator"
    assert result["should_not_claim"] == ["Do not claim X."]


def test_validate_bundle_accepts_minimal_bundle():
    evi = EvidenceRecord(
        id="evi:test-v1",
        type="pp:claim",
        viewpoint_directive_id="vpt:paper-extraction-v1",
        provenance="test",
        should_not_claim=["test"],
        source_artifact_ref=ContentReference(
            uri="file://test.pdf",
            sha256="a" * 64,
            hash_mode=HashMode.raw_bytes,
        ),
        locator=CharRangeLocator(
            locator_type="CharRangeLocator", char_start=0, char_end=10, page=1
        ),
    )
    bundle = {
        "bundle_version": "pygrits_v0.4.0",
        "bundle_type": "normalized_epistemic_bundle",
        "objects": [],
        "activities": [],
        "evidence_records": [json.loads(evi.model_dump_json(exclude_none=True))],
    }
    counts, errors = validate_bundle(bundle)
    assert errors == []
    assert counts.get("EvidenceRecord", 0) == 1


def test_parse_verification_verdict():
    raw = '```json\n{"verdict": "SUPPORTED", "evidence_quote": "X = 5", "page": 3}\n```'
    verdict = _parse_verification_verdict(raw)
    assert verdict["verdict"] == "SUPPORTED"
    assert verdict["evidence_quote"] == "X = 5"
    assert verdict["page"] == 3

    fallback = _parse_verification_verdict("the paper does not support this; UNSUPPORTED")
    assert fallback["verdict"] == "UNSUPPORTED"


@pytest.mark.asyncio
async def test_run_grit_squeezer_missing_file(tmp_path):
    runtime = RuntimeSettings(
        llm_model="LLM_A",
        summary_llm_model="LLM_A",
        embedding_model="embed",
        litellm_url="http://localhost:4000",
        litellm_api_key="test",
        pqa_home=tmp_path / ".pqa",
    )
    result = await run_grit_squeezer(
        input_path=tmp_path / "nonexistent.pdf",
        output_dir=tmp_path / "out",
        runtime=runtime,
    )
    assert result.bundle_path is None
    assert result.validation_report.errors
