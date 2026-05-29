"""
paper-gritsqueezer: extracts pygrits-schema-valid bundles from scientific PDFs.

Standalone (no dependency on paper_reader_summary). Uses PaperQA2 only as the
PDF parser and as a retrieval-backed verifier. Extraction itself is exhaustive,
char-grounded, and gated by Pydantic schema validation.

Stages:
  1. metadata pass  — abstract/title segments -> paper-level EvidenceRecord grits
  2. results pass   — results/discussion/methods segments -> measurement/claim grits
  3. negative pass  — full text, single call -> NegativeEvidenceRecord grits
  4. validate+repair — Pydantic gate, deterministic + LLM repair
  5. verification    — PaperQA2 Docs index double-checks each grit against the paper

The bundle is only written if the final validation gate passes.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from pygrits.core import (
    Activity,
    ActivityType,
    CharRangeLocator,
    Confidence,
    ContentReference,
    EvidenceRecord,
    HashMode,
    NegativeEvidenceRecord,
    Object,
)

from paper_gritsqueezer.extract import ExtractionResult, extract_paper, source_hash_from_pdf
from paper_gritsqueezer.llm import _call_summary_llm_direct
from paper_gritsqueezer.provenance import (
    append_llm_call_record,
    build_source_spans,
    sha256_hex,
    write_llm_calls_jsonl,
)
from paper_gritsqueezer.settings import (
    RuntimeSettings,
    build_paperqa_settings,
    settings_with_evidence_k,
)

# ── constants ────────────────────────────────────────────────────────────────

GRIT_SCHEMA_VERSION = "pygrits_v0.4.0"
DEFAULT_VIEWPOINT_ID = "vpt:paper-extraction-v1"
MAX_REPAIR_RETRIES = 2
DEFAULT_MAX_SEGMENT_CHARS = 6000
DEFAULT_NEGATIVE_TEXT_CAP = 12000

SECTION_HEADING_PATTERN = re.compile(
    r"^\s*(?:\d+\.?\s+)?"
    r"(abstract|introduction|background|methods?|methodology|"
    r"experimental|results?|findings?|discussion|conclusions?|"
    r"limitations?|caveats?|acknowledgements?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)

NEGATIVE_RESULT_VALUES = {"absent", "weak_signal", "excluded", "inconclusive"}


# ── data structures ────────────────────────────────────────────────────────────

@dataclass
class GritSegment:
    """A text chunk with provenance ready for grit extraction."""

    text: str
    char_start: int
    char_end: int
    page: int | None
    section: str | None
    segment_type: str
    span_id: str | None = None


@dataclass
class ExtractionCandidate:
    """Raw LLM output before Pydantic validation."""

    raw_dict: dict[str, Any]
    segment: GritSegment
    pass_name: str
    is_negative: bool = False


@dataclass
class ValidationResult:
    candidates_attempted: int = 0
    passed: int = 0
    repaired: int = 0
    rejected: int = 0
    errors: list[str] = field(default_factory=list)
    valid_grits: list[EvidenceRecord | NegativeEvidenceRecord] = field(default_factory=list)


@dataclass
class GritSqueezerResult:
    bundle_path: Path | None
    validation_report: ValidationResult
    warnings: list[str]
    verification_report: list[dict[str, Any]] = field(default_factory=list)
    outputs: dict[str, str] = field(default_factory=dict)


# ── segmentation ───────────────────────────────────────────────────────────────

def segment_paper(
    extraction: ExtractionResult,
    spans: list[dict[str, Any]],
    *,
    max_segment_chars: int = DEFAULT_MAX_SEGMENT_CHARS,
) -> list[GritSegment]:
    """Partition extracted text into segments for grit extraction."""
    segments: list[GritSegment] = []
    full_text = extraction.text

    heading_map: dict[int, str] = {}
    for match in SECTION_HEADING_PATTERN.finditer(full_text):
        heading_map[match.start()] = match.group(1).strip().lower()

    def nearest_section(char_pos: int) -> str | None:
        candidates = [pos for pos in heading_map if pos <= char_pos]
        if not candidates:
            return None
        return heading_map[max(candidates)]

    def section_type(section_name: str | None) -> str:
        if section_name is None:
            return "other"
        if section_name in ("abstract",):
            return "abstract"
        if section_name in ("methods", "method", "methodology", "experimental"):
            return "methods"
        if section_name in ("results", "result", "findings", "finding"):
            return "results"
        if section_name in ("discussion",):
            return "results"
        if section_name in ("limitations", "limitation", "caveats", "caveat"):
            return "negative"
        return "other"

    for span in spans:
        char_start = int(span["char_start"])
        char_end = int(span["char_end"])
        page = span.get("page")
        text = full_text[char_start:char_end]
        if len(text) > max_segment_chars:
            cutoff = text.rfind(". ", 0, max_segment_chars)
            if cutoff < max_segment_chars // 2:
                cutoff = max_segment_chars
            text = text[: cutoff + 1]
            char_end = char_start + len(text)

        section = nearest_section(char_start)
        segments.append(
            GritSegment(
                text=text,
                char_start=char_start,
                char_end=char_end,
                page=page,
                section=section,
                segment_type=section_type(section),
                span_id=span.get("span_id"),
            )
        )

    return segments


# ── prompt construction ────────────────────────────────────────────────────────

def _evidence_record_schema() -> str:
    return json.dumps(EvidenceRecord.model_json_schema(), indent=2)


def _negative_record_schema() -> str:
    return json.dumps(NegativeEvidenceRecord.model_json_schema(), indent=2)


def _build_metadata_prompt(
    segment: GritSegment,
    source_uri: str,
    sha256: str,
    viewpoint_should_not_claim: list[str],
    viewpoint_id: str,
) -> str:
    snc = "\n".join(f"- {rule}" for rule in viewpoint_should_not_claim)
    return f"""You are extracting evidence records from the abstract and title block
of a scientific paper.

VIEWPOINT RULES — you must not claim:
{snc}

SOURCE URI: {source_uri}
SOURCE SHA256: {sha256}
SEGMENT (chars {segment.char_start}-{segment.char_end}, page {segment.page}):

{segment.text}

Extract evidence records from this segment. For each record:
- Set source_artifact_ref.uri = "{source_uri}"
- Set source_artifact_ref.sha256 = "{sha256}"
- Set source_artifact_ref.hash_mode = "raw_bytes"
- Set source_artifact_ref.media_type = "application/pdf"
- Set locator.locator_type = "CharRangeLocator"
- Set locator.char_start and char_end to the exact range within the segment
- Set locator.page = {segment.page or 1}
- Set should_not_claim to at least one rule from the VIEWPOINT RULES above
- Set generation_mode = "extracted_with_llm_v1"
- Set review_state = "machine_generated"
- Set lifecycle_state = "evidence_extracted"
- Set evidence_type to one of: pp:claim, pp:measurement, pp:extraction_provenance
- Set viewpoint_directive_id = "{viewpoint_id}"
- Set provenance to a one-sentence description of what was extracted and from where

Extract: paper purpose, research question, epistemic scope statements
(qualitative only, no replicates, etc), and key method names.

Return a JSON array of evidence record objects matching this schema:
{_evidence_record_schema()}

Return [] if nothing is extractable. Return ONLY the JSON array.
"""


def _build_results_prompt(
    segment: GritSegment,
    source_uri: str,
    sha256: str,
    viewpoint_should_not_claim: list[str],
    viewpoint_id: str,
) -> str:
    snc = "\n".join(f"- {rule}" for rule in viewpoint_should_not_claim)
    return f"""You are extracting evidence records from a results or discussion
section of a scientific paper.

VIEWPOINT RULES — you must not claim:
{snc}

SOURCE URI: {source_uri}
SOURCE SHA256: {sha256}
SEGMENT (chars {segment.char_start}-{segment.char_end}, page {segment.page},
section: {segment.section or "unknown"}):

{segment.text}

Extract measurement and claim evidence records from this segment.
For each record:
- Set source_artifact_ref.uri = "{source_uri}"
- Set source_artifact_ref.sha256 = "{sha256}"
- Set source_artifact_ref.hash_mode = "raw_bytes"
- Set source_artifact_ref.media_type = "application/pdf"
- Set locator.locator_type = "CharRangeLocator"
- Set locator.char_start and char_end to the EXACT span of the supporting text
- Set locator.page = {segment.page or 1}
- Set should_not_claim to at least one specific rule (e.g. "Do not assert
  quantitative values beyond what is stated in this span")
- Set generation_mode = "extracted_with_llm_v1"
- Set review_state = "machine_generated"
- Set lifecycle_state = "evidence_extracted"
- Set evidence_type to: pp:measurement (quantitative results) or pp:claim
  (qualitative assertions)
- Set normalized_payload to a compact JSON string with the key measurements
  or claim elements (e.g. "{{\\"peak_cm-1\\": 1655, \\"condition\\": \\"TCEP\\"}}")
- Set viewpoint_directive_id = "{viewpoint_id}"

Extract: measurements with values and units, qualitative claims with explicit
uncertainty language, method comparisons, and quantitative results.
Do NOT extract figure captions — text only.

Return a JSON array. Return [] if nothing extractable. Return ONLY the JSON array.

Schema:
{_evidence_record_schema()}
"""


def _build_negative_prompt(
    full_text_truncated: str,
    source_uri: str,
    sha256: str,
    viewpoint_should_not_claim: list[str],
    viewpoint_id: str,
) -> str:
    snc = "\n".join(f"- {rule}" for rule in viewpoint_should_not_claim)
    return f"""You are extracting negative evidence records from a scientific paper.
A negative evidence record captures what the authors explicitly could NOT do,
did NOT observe, excluded from analysis, or found to be inconclusive or irreproducible.

VIEWPOINT RULES — you must not claim:
{snc}

SOURCE URI: {source_uri}
SOURCE SHA256: {sha256}
FULL PAPER TEXT (truncated to {len(full_text_truncated)} chars):

{full_text_truncated}

For each negative finding, extract a NegativeEvidenceRecord:
- Set source_artifact_ref.uri = "{source_uri}"
- Set source_artifact_ref.sha256 = "{sha256}"
- Set source_artifact_ref.hash_mode = "raw_bytes"
- Set source_artifact_ref.media_type = "application/pdf"
- Set locator.locator_type = "CharRangeLocator"
- Set locator.char_start and char_end to the span containing the negative statement
- Set should_not_claim to at least one rule
- Set generation_mode = "extracted_with_llm_v1"
- Set review_state = "machine_generated"
- Set lifecycle_state = "evidence_extracted"
- Set evidence_type = "pp:measurement"
- Set viewpoint_directive_id = "{viewpoint_id}"
- Set search_method to a string describing the method that was attempted
  (e.g. "spontaneous_raman_785nm", "cell_imaging_SRS")
- Set search_scope to a string describing what sample/condition was searched
- Set result to EXACTLY ONE of: absent, weak_signal, excluded, inconclusive
  - absent: searched and not found
  - weak_signal: found but too weak to interpret
  - excluded: present but excluded because of a confound or technical failure
  - inconclusive: found but irreproducible or uninterpretable

Look for: fluorescence saturation, irreproducibility, reagent overlap,
instrument limitations, conditions explicitly excluded from analysis,
stated inability to draw conclusions, null results.

Return a JSON array of NegativeEvidenceRecord objects. Return [] if none found.
Return ONLY the JSON array.

Schema:
{_negative_record_schema()}
"""


def _build_repair_prompt(
    candidate_dict: dict[str, Any],
    validation_error: str,
    is_negative: bool,
) -> str:
    schema = _negative_record_schema() if is_negative else _evidence_record_schema()
    return f"""A pygrits evidence record failed schema validation.
Fix ONLY the failing fields. Return the corrected record as a JSON object.

VALIDATION ERROR:
{validation_error}

ORIGINAL RECORD:
{json.dumps(candidate_dict, indent=2)}

Fix the specific field(s) named in the error. Do not change other fields.
Return ONLY the corrected JSON object (not an array).

Schema:
{schema}
"""


def _build_verification_prompt(claim: str, is_negative: bool) -> str:
    kind = "negative finding (something not observed / excluded / inconclusive)" if is_negative else "claim or measurement"
    return f"""You are verifying whether a {kind} extracted from a scientific paper
is actually supported by the paper's text.

STATEMENT TO VERIFY:
{claim}

Decide whether the paper supports this statement. Reply with ONLY a JSON object:
{{"verdict": "SUPPORTED" | "PARTIAL" | "UNSUPPORTED",
  "evidence_quote": "<short exact quote from the paper, or empty string>",
  "page": <page number as an integer, or null>}}

- SUPPORTED: the paper clearly states or directly entails the statement.
- PARTIAL: the paper partly supports it, or supports a weaker version.
- UNSUPPORTED: the paper does not support it (or contradicts it).

Return ONLY the JSON object.
"""


# ── parsing ────────────────────────────────────────────────────────────────────

def _parse_llm_json_array(raw: str, warnings: list[str]) -> list[dict[str, Any]]:
    """Parse an LLM response that should be a JSON array (markdown-fence tolerant)."""
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE)
    text = text.strip()
    start = text.find("[")
    if start < 0:
        if text.startswith("{"):
            text = f"[{text}]"
            start = 0
        else:
            warnings.append("LLM response contained no JSON array.")
            return []
    text = text[start:]
    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\[[\s\S]*\]", text)
        if not match:
            warnings.append("LLM response was not valid JSON.")
            return []
        try:
            result = json.loads(match.group(0))
        except json.JSONDecodeError:
            warnings.append("LLM response JSON could not be parsed.")
            return []
    if not isinstance(result, list):
        if isinstance(result, dict):
            return [result]
        warnings.append("LLM response was not a JSON array.")
        return []
    return [item for item in result if isinstance(item, dict)]


def _parse_verification_verdict(raw: str) -> dict[str, Any]:
    """Parse a verification reply into {verdict, evidence_quote, page}."""
    fallback = {"verdict": "UNKNOWN", "evidence_quote": "", "page": None}
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE)
    text = text.strip()
    start = text.find("{")
    payload: Any = None
    if start >= 0:
        try:
            payload = json.loads(text[start:])
        except json.JSONDecodeError:
            match = re.search(r"\{[\s\S]*\}", text[start:])
            if match:
                try:
                    payload = json.loads(match.group(0))
                except json.JSONDecodeError:
                    payload = None
    if not isinstance(payload, dict):
        upper = text.upper()
        for verdict in ("UNSUPPORTED", "PARTIAL", "SUPPORTED"):
            if verdict in upper:
                return {**fallback, "verdict": verdict}
        return fallback

    verdict = str(payload.get("verdict") or "").strip().upper()
    if verdict not in {"SUPPORTED", "PARTIAL", "UNSUPPORTED"}:
        verdict = "UNKNOWN"
    page = payload.get("page")
    try:
        page = int(page) if page is not None else None
    except (TypeError, ValueError):
        page = None
    return {
        "verdict": verdict,
        "evidence_quote": str(payload.get("evidence_quote") or "")[:500],
        "page": page,
    }


# ── deterministic field injection ───────────────────────────────────────────────

def _inject_required_fields(
    candidate: dict[str, Any],
    segment: GritSegment,
    source_uri: str,
    sha256: str,
    viewpoint_should_not_claim: list[str],
    viewpoint_id: str,
    *,
    is_negative: bool = False,
) -> dict[str, Any]:
    """Deterministically inject fields the LLM commonly omits (no extra LLM call)."""
    c = dict(candidate)

    if not c.get("source_artifact_ref") or not isinstance(c.get("source_artifact_ref"), dict):
        c["source_artifact_ref"] = {
            "uri": source_uri,
            "sha256": sha256,
            "hash_mode": "raw_bytes",
            "media_type": "application/pdf",
        }
    else:
        sar = dict(c["source_artifact_ref"])
        sar.setdefault("uri", source_uri)
        sar.setdefault("sha256", sha256)
        sar.setdefault("hash_mode", "raw_bytes")
        sar.setdefault("media_type", "application/pdf")
        c["source_artifact_ref"] = sar

    if not c.get("locator") or not isinstance(c.get("locator"), dict):
        c["locator"] = {
            "locator_type": "CharRangeLocator",
            "char_start": segment.char_start,
            "char_end": segment.char_end,
            "page": segment.page or 1,
        }
    else:
        loc = dict(c["locator"])
        loc.setdefault("locator_type", "CharRangeLocator")
        loc.setdefault("char_start", segment.char_start)
        loc.setdefault("char_end", segment.char_end)
        loc.setdefault("page", segment.page or 1)
        c["locator"] = loc

    snc = c.get("should_not_claim")
    if not snc or not isinstance(snc, list) or not all(isinstance(s, str) for s in snc):
        c["should_not_claim"] = viewpoint_should_not_claim[:1] or [
            "Do not assert claims not grounded in source text."
        ]

    # normalized_payload must serialize as a JSON string in v1.
    payload = c.get("normalized_payload")
    if isinstance(payload, (dict, list)):
        c["normalized_payload"] = json.dumps(payload)

    c.setdefault("viewpoint_directive_id", viewpoint_id)
    c.setdefault("generation_mode", "extracted_with_llm_v1")
    c.setdefault("review_state", "machine_generated")
    c.setdefault("lifecycle_state", "evidence_extracted")

    if not c.get("id"):
        anchor = f"{source_uri}:{segment.char_start}:{segment.char_end}:{c.get('evidence_type', '?')}"
        c["id"] = f"evi:{sha256_hex(anchor)[:16]}-v1"

    c.setdefault("type", "pp:claim")

    if not c.get("provenance") or not str(c.get("provenance")).strip():
        c["provenance"] = (
            f"LLM extraction from {source_uri}, "
            f"chars {segment.char_start}-{segment.char_end}, "
            f"section: {segment.section or 'unknown'}."
        )

    if is_negative:
        if not c.get("search_method") or not str(c.get("search_method")).strip():
            c["search_method"] = "llm_extraction_negative"
        if str(c.get("result") or "").strip() not in NEGATIVE_RESULT_VALUES:
            c["result"] = "inconclusive"

    return c


# ── validation + repair ──────────────────────────────────────────────────────

def _try_validate(d: dict[str, Any], model_cls: type) -> EvidenceRecord | NegativeEvidenceRecord | None:
    try:
        return model_cls(**d)
    except Exception:
        return None


def _validation_error_str(d: dict[str, Any], model_cls: type) -> str:
    try:
        model_cls(**d)
        return ""
    except Exception as err:
        return str(err)


async def validate_and_repair(
    candidates: list[ExtractionCandidate],
    source_uri: str,
    sha256: str,
    viewpoint_should_not_claim: list[str],
    viewpoint_id: str,
    settings: Any,
    llm_call_records: list[dict[str, Any]],
    warnings: list[str],
) -> ValidationResult:
    """Gate every candidate through Pydantic; deterministic repair first, then LLM repair."""
    result = ValidationResult()

    for cand in candidates:
        result.candidates_attempted += 1
        is_negative = cand.is_negative
        model_cls = NegativeEvidenceRecord if is_negative else EvidenceRecord

        patched = _inject_required_fields(
            cand.raw_dict,
            cand.segment,
            source_uri,
            sha256,
            viewpoint_should_not_claim,
            viewpoint_id,
            is_negative=is_negative,
        )

        validated = _try_validate(patched, model_cls)
        if validated is not None:
            result.passed += 1
            result.valid_grits.append(validated)
            continue

        repaired = None
        if settings is not None:
            for attempt in range(MAX_REPAIR_RETRIES):
                error_msg = _validation_error_str(patched, model_cls)
                repair_prompt = _build_repair_prompt(patched, error_msg, is_negative)
                try:
                    raw_repair = await _call_summary_llm_direct(
                        settings, repair_prompt, name=f"grit_repair_{attempt}"
                    )
                    append_llm_call_record(
                        llm_call_records,
                        extraction_step_id=f"grit_repair_{cand.segment.char_start}",
                        model_alias="summary_llm",
                        prompt=repair_prompt,
                        response=raw_repair,
                    )
                except Exception as err:
                    warnings.append(f"Repair LLM call failed: {err}")
                    break

                text = raw_repair.strip()
                text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
                text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE).strip()
                start = text.find("{")
                if start >= 0:
                    try:
                        reparsed = json.loads(text[start:])
                    except json.JSONDecodeError:
                        continue
                    patched = _inject_required_fields(
                        reparsed,
                        cand.segment,
                        source_uri,
                        sha256,
                        viewpoint_should_not_claim,
                        viewpoint_id,
                        is_negative=is_negative,
                    )

                validated = _try_validate(patched, model_cls)
                if validated is not None:
                    repaired = validated
                    break

        if repaired is not None:
            repaired_dict = json.loads(repaired.model_dump_json(exclude_none=True))
            repaired_dict["generation_mode"] = "extracted_with_repair_v1"
            final = _try_validate(repaired_dict, model_cls)
            result.repaired += 1
            result.valid_grits.append(final or repaired)
            continue

        result.rejected += 1
        error_msg = _validation_error_str(patched, model_cls)
        result.errors.append(
            f"Rejected candidate at chars {cand.segment.char_start}-"
            f"{cand.segment.char_end}: {error_msg[:200]}"
        )
        warnings.append(
            f"Grit extraction candidate rejected after {MAX_REPAIR_RETRIES} "
            f"repair attempts: {error_msg[:100]}"
        )

        rejection_grit = _build_rejection_record(
            cand, source_uri, sha256, viewpoint_id, error_msg
        )
        if rejection_grit is not None:
            result.valid_grits.append(rejection_grit)

    return result


def _build_rejection_record(
    cand: ExtractionCandidate,
    source_uri: str,
    sha256: str,
    viewpoint_id: str,
    error_msg: str,
) -> NegativeEvidenceRecord | None:
    """Record a failed extraction as a NegativeEvidenceRecord with result=excluded."""
    try:
        payload_id = sha256_hex(
            f"rejected:{source_uri}:{cand.segment.char_start}:{cand.segment.char_end}"
        )
        return NegativeEvidenceRecord(
            id=f"evi:rejected-{payload_id[:12]}-v1",
            type="pp:extraction_failure",
            viewpoint_directive_id=viewpoint_id,
            provenance=(
                f"Extraction candidate rejected after {MAX_REPAIR_RETRIES} repair "
                f"attempts. Validation error: {error_msg[:200]}"
            ),
            should_not_claim=[
                "This record documents an extraction failure, not a scientific claim."
            ],
            source_artifact_ref=ContentReference(
                uri=source_uri,
                sha256=sha256,
                hash_mode=HashMode.raw_bytes,
                media_type="application/pdf",
            ),
            locator=CharRangeLocator(
                locator_type="CharRangeLocator",
                char_start=cand.segment.char_start,
                char_end=cand.segment.char_end,
                page=cand.segment.page or 1,
            ),
            generation_mode="extracted_with_llm_v1",
            review_state="machine_generated",
            lifecycle_state="evidence_extracted",
            search_method=f"llm_extraction_{cand.pass_name}",
            search_scope=f"chars {cand.segment.char_start}-{cand.segment.char_end}",
            result="excluded",
        )
    except Exception:
        return None


# ── verification (PaperQA2) ──────────────────────────────────────────────────

def _grit_claim_text(grit: EvidenceRecord | NegativeEvidenceRecord) -> str:
    parts: list[str] = []
    extracted = getattr(grit, "extracted_content", None)
    if extracted:
        parts.append(str(extracted))
    payload = getattr(grit, "normalized_payload", None)
    if payload:
        parts.append(f"payload: {payload}")
    if not parts:
        parts.append(str(getattr(grit, "provenance", "")))
    if isinstance(grit, NegativeEvidenceRecord):
        parts.append(f"(negative finding, result={getattr(grit, 'result', '?')})")
    return " ".join(p for p in parts if p).strip() or str(getattr(grit, "id", ""))


def _session_answer_text(session: object) -> str:
    for attribute in ("answer", "raw_answer", "formatted_answer", "text"):
        value = getattr(session, attribute, None)
        if value:
            return str(value).strip()
    return ""


def _build_validation_activity(
    verified_ids: list[str],
    viewpoint_id: str,
    counts: dict[str, int],
) -> Activity | None:
    if not verified_ids:
        return None
    try:
        activity_id = f"act:verification-{sha256_hex(''.join(verified_ids))[:12]}-v1"
        return Activity(
            id=activity_id,
            type="grits:activity_type/validation_edge",
            viewpoint_directive_id=viewpoint_id,
            provenance="PaperQA2 retrieval-backed verification of self-extracted grits.",
            should_not_claim=[
                "This activity records automated verification; a non-SUPPORTED verdict "
                "does not by itself refute a grit, and SUPPORTED does not replace human review.",
            ],
            review_state="machine_generated",
            lifecycle_state="synthesized",
            generation_mode="verified_with_paperqa_v1",
            activity_type=ActivityType.VALIDATION_EDGE,
            inputs=list(verified_ids),
            outputs=None,
            assumptions=[
                "Verification uses PaperQA2 retrieval over the same source PDF.",
                f"Verdict counts: {json.dumps(counts, sort_keys=True)}.",
            ],
            admissibility_rationale=(
                "Each extracted grit was posed as a support question against a PaperQA2 "
                "Docs index built from the source PDF. Verdicts are recorded per-grit as "
                "extraction_confidence and in grit_verification_report.json."
            ),
        )
    except Exception:
        return None


async def verify_grits(
    grits: list[EvidenceRecord | NegativeEvidenceRecord],
    input_pdf: Path,
    settings: Any,
    *,
    viewpoint_id: str,
    llm_call_records: list[dict[str, Any]],
    warnings: list[str],
    evidence_k: int | None = None,
    max_grits: int | None = None,
) -> tuple[list[dict[str, Any]], Activity | None]:
    """Double-check each grit against the paper using a PaperQA2 Docs index."""
    report: list[dict[str, Any]] = []
    if settings is None:
        warnings.append("Verification skipped: PaperQA settings unavailable.")
        return report, None

    try:
        from paperqa import Docs
    except ImportError as err:
        warnings.append(f"Verification skipped: PaperQA2 unavailable ({err}).")
        return report, None

    query_settings = settings_with_evidence_k(settings, evidence_k)

    try:
        docs = Docs()
        await docs.aadd(str(input_pdf), docname=input_pdf.name, settings=settings)
    except Exception as err:  # pragma: no cover - depends on PaperQA2 runtime
        warnings.append(f"Verification skipped: building PaperQA index failed ({err}).")
        return report, None

    counts: dict[str, int] = {}
    verified_ids: list[str] = []
    to_verify = grits if max_grits is None else grits[:max_grits]

    for grit in to_verify:
        claim = _grit_claim_text(grit)
        is_negative = isinstance(grit, NegativeEvidenceRecord)
        prompt = _build_verification_prompt(claim, is_negative)
        try:
            session = await docs.aquery(prompt, settings=query_settings)
            answer_text = _session_answer_text(session)
            append_llm_call_record(
                llm_call_records,
                extraction_step_id=f"grit_verify_{grit.id}",
                model_alias="summary_llm",
                prompt=prompt,
                response=answer_text,
            )
            context_count = None
            contexts = getattr(session, "contexts", None) or getattr(session, "context", None)
            if contexts is not None:
                try:
                    context_count = len(contexts)
                except TypeError:
                    context_count = None
        except Exception as err:  # pragma: no cover - depends on PaperQA2 runtime
            warnings.append(f"Verification query failed for {grit.id}: {err}")
            report.append({"id": grit.id, "verdict": "ERROR", "error": str(err)[:200]})
            continue

        verdict = _parse_verification_verdict(answer_text)
        counts[verdict["verdict"]] = counts.get(verdict["verdict"], 0) + 1
        verified_ids.append(grit.id)
        report.append(
            {
                "id": grit.id,
                "verdict": verdict["verdict"],
                "evidence_quote": verdict["evidence_quote"],
                "page": verdict["page"],
                "paperqa_context_count": context_count,
            }
        )
        _annotate_grit(grit, verdict)

    activity = _build_validation_activity(verified_ids, viewpoint_id, counts)
    return report, activity


def _annotate_grit(grit: EvidenceRecord | NegativeEvidenceRecord, verdict: dict[str, Any]) -> None:
    """Attach the verification verdict to the grit in a schema-valid way."""
    value_map = {"SUPPORTED": 1.0, "PARTIAL": 0.5, "UNSUPPORTED": 0.0}
    value = value_map.get(verdict["verdict"])
    scope = f"PaperQA2 verification: {verdict['verdict']}"
    if verdict.get("page") is not None:
        scope += f"; page {verdict['page']}"
    if verdict.get("evidence_quote"):
        scope += f"; quote: {verdict['evidence_quote'][:200]}"
    try:
        grit.extraction_confidence = Confidence(
            value=value,
            confidence_basis="heuristic",
            calibration_scope=scope[:500],
        )
    except Exception:
        return

    if verdict["verdict"] == "UNSUPPORTED":
        try:
            grit.review_state = "disputed"
            note = "PaperQA2 retrieval found no support for this statement; treat as unverified."
            existing = list(grit.should_not_claim or [])
            if note not in existing:
                existing.append(note)
                grit.should_not_claim = existing
        except Exception:
            pass


# ── bundle assembly ────────────────────────────────────────────────────────────

def _build_paper_object(
    extraction: ExtractionResult,
    source_uri: str,
    sha256: str,
    evidence_ids: list[str],
    viewpoint_id: str,
) -> Object:
    features = json.dumps(
        {
            "title": extraction.title,
            "authors": extraction.authors,
            "year": extraction.year,
            "doi": extraction.doi,
            "doi_candidates": extraction.doi_candidates,
            "page_count": extraction.page_count,
            "source_name": extraction.source_name,
            "character_count": len(extraction.text),
        }
    )
    paper_id = sha256_hex(source_uri)[:16]
    return Object(
        id=f"obj:paper-{paper_id}-v1",
        type="schema:ScholarlyArticle",
        viewpoint_directive_id=viewpoint_id,
        provenance=(
            f"Paper object extracted from {source_uri} "
            f"(SHA256: {sha256[:16]}...). "
            f"Title: {extraction.title or 'unknown'}."
        ),
        should_not_claim=[
            "This object represents the paper as a whole; "
            "do not assert findings from evidence records as paper-level facts.",
        ],
        source_artifact_refs=[
            ContentReference(
                uri=source_uri,
                sha256=sha256,
                hash_mode=HashMode.raw_bytes,
                media_type="application/pdf",
            )
        ],
        evidence_record_ids=evidence_ids,
        features=features,
        review_state="machine_generated",
        lifecycle_state="evidence_extracted",
        generation_mode="extracted_with_llm_v1",
    )


def _build_extraction_activity(
    paper_obj_id: str,
    evidence_ids: list[str],
    viewpoint_id: str,
    pass_names: list[str],
) -> Activity:
    return Activity(
        id=f"act:extraction-{sha256_hex(paper_obj_id)[:12]}-v1",
        type="grits:activity_type/action_edge",
        viewpoint_directive_id=viewpoint_id,
        provenance="Automated grit extraction via paper-gritsqueezer skill.",
        should_not_claim=[
            "This activity records automated LLM extraction; "
            "all grits require human review before use in downstream reasoning.",
        ],
        review_state="machine_generated",
        lifecycle_state="synthesized",
        generation_mode="extracted_with_llm_v1",
        activity_type=ActivityType.ACTION_EDGE,
        inputs=[paper_obj_id],
        outputs=evidence_ids,
        assumptions=[
            f"Extraction passes run: {', '.join(pass_names)}.",
            "Char offsets are page-level estimates from the span builder.",
            "SHA256 is of raw PDF bytes.",
        ],
        admissibility_rationale=(
            "Automated extraction under the paper-extraction viewpoint. "
            "All grits validated against pygrits v0.4.0 Pydantic schema. "
            "Rejected candidates recorded as NegativeEvidenceRecord grits."
        ),
    )


def assemble_bundle(
    extraction: ExtractionResult,
    source_uri: str,
    sha256: str,
    valid_grits: list[EvidenceRecord | NegativeEvidenceRecord],
    viewpoint_id: str,
    passes_run: list[str],
    extra_activities: list[Activity] | None = None,
) -> dict[str, Any]:
    """Assemble the full bundle dict from validated grits."""
    evidence_ids = [g.id for g in valid_grits]
    paper_obj = _build_paper_object(extraction, source_uri, sha256, evidence_ids, viewpoint_id)
    activity = _build_extraction_activity(paper_obj.id, evidence_ids, viewpoint_id, passes_run)

    activities = [activity] + list(extra_activities or [])

    evidence_records: list[dict[str, Any]] = []
    negative_records: list[dict[str, Any]] = []
    for grit in valid_grits:
        d = json.loads(grit.model_dump_json(exclude_none=True))
        if isinstance(grit, NegativeEvidenceRecord):
            negative_records.append(d)
        else:
            evidence_records.append(d)

    return {
        "bundle_version": GRIT_SCHEMA_VERSION,
        "bundle_type": "normalized_epistemic_bundle",
        "objects": [json.loads(paper_obj.model_dump_json(exclude_none=True))],
        "activities": [json.loads(a.model_dump_json(exclude_none=True)) for a in activities],
        "evidence_records": evidence_records + negative_records,
    }


def validate_bundle(bundle_dict: dict[str, Any]) -> tuple[dict[str, int], list[str]]:
    """Full bundle validation pass. Returns (counts_by_class, errors)."""
    errors: list[str] = []
    ok: dict[str, int] = {}

    for i, item in enumerate(bundle_dict.get("objects", [])):
        try:
            Object(**item)
            ok["Object"] = ok.get("Object", 0) + 1
        except Exception as e:
            errors.append(f"objects[{i}] ({item.get('id', '?')}): {e}")

    for i, item in enumerate(bundle_dict.get("activities", [])):
        try:
            Activity(**item)
            ok["Activity"] = ok.get("Activity", 0) + 1
        except Exception as e:
            errors.append(f"activities[{i}] ({item.get('id', '?')}): {e}")

    for i, item in enumerate(bundle_dict.get("evidence_records", [])):
        cls = NegativeEvidenceRecord if "result" in item else EvidenceRecord
        try:
            cls(**item)
            ok[cls.__name__] = ok.get(cls.__name__, 0) + 1
        except Exception as e:
            errors.append(f"evidence_records[{i}] ({item.get('id', '?')}): {e}")

    return ok, errors


# ── main entry point ───────────────────────────────────────────────────────────

async def run_grit_squeezer(
    input_path: Path,
    output_dir: Path,
    runtime: RuntimeSettings,
    *,
    viewpoint_id: str = DEFAULT_VIEWPOINT_ID,
    viewpoint_should_not_claim: list[str] | None = None,
    passes: list[str] | None = None,
    source_hash: str = "",
    max_segment_chars: int = DEFAULT_MAX_SEGMENT_CHARS,
    negative_text_cap: int = DEFAULT_NEGATIVE_TEXT_CAP,
    verify: bool = True,
    verify_evidence_k: int | None = None,
    verify_max_grits: int | None = None,
) -> GritSqueezerResult:
    """Extract a validated grit bundle from a PDF, then verify it against the paper."""
    warnings: list[str] = []
    llm_call_records: list[dict[str, Any]] = []
    passes_to_run = passes or ["metadata", "results", "negative"]

    snc = viewpoint_should_not_claim or [
        "Do not assert claims not grounded in source text.",
        "Do not interpret figure panels or image-derived data.",
        "Do not fabricate quantitative values not stated in text.",
        "Char offsets are page-level estimates; do not assert precision beyond the page.",
    ]

    input_pdf = input_path.expanduser().resolve()
    if not input_pdf.exists() or not input_pdf.is_file():
        return GritSqueezerResult(
            bundle_path=None,
            validation_report=ValidationResult(errors=[f"File not found: {input_pdf}"]),
            warnings=warnings,
        )

    output_dir.mkdir(parents=True, exist_ok=True)

    # ── Stage 1: extract text + spans ────────────────────────────────────────
    try:
        extraction = extract_paper(input_pdf, output_dir=output_dir)
    except Exception as err:
        return GritSqueezerResult(
            bundle_path=None,
            validation_report=ValidationResult(errors=[f"PDF extraction failed: {err}"]),
            warnings=warnings,
        )

    resolved_sha256 = source_hash.strip() or source_hash_from_pdf(input_pdf)
    source_uri = str(input_pdf)

    spans = build_source_spans(extraction.text, resolved_sha256)
    segments = segment_paper(extraction, spans, max_segment_chars=max_segment_chars)

    # ── Stage 2: PaperQA settings ────────────────────────────────────────────
    try:
        settings = build_paperqa_settings(runtime)
        runtime.apply_environment()
    except Exception as err:
        warnings.append(f"Failed to build PaperQA settings: {err}")
        settings = None

    # ── Stage 3: extraction passes ───────────────────────────────────────────
    all_candidates: list[ExtractionCandidate] = []

    if "metadata" in passes_to_run and settings is not None:
        meta_segments = [s for s in segments if s.segment_type in ("abstract", "other")][:3]
        for seg in meta_segments:
            prompt = _build_metadata_prompt(seg, source_uri, resolved_sha256, snc, viewpoint_id)
            try:
                raw = await _call_summary_llm_direct(settings, prompt, name="grit_metadata")
                append_llm_call_record(
                    llm_call_records,
                    extraction_step_id=f"grit_metadata_{seg.char_start}",
                    model_alias=runtime.llm_model,
                    prompt=prompt,
                    response=raw,
                )
            except Exception as err:
                warnings.append(f"Metadata pass LLM call failed: {err}")
                continue
            for c in _parse_llm_json_array(raw, warnings):
                all_candidates.append(
                    ExtractionCandidate(raw_dict=c, segment=seg, pass_name="metadata", is_negative=False)
                )

    if "results" in passes_to_run and settings is not None:
        result_segments = [s for s in segments if s.segment_type in ("results", "methods")]
        for seg in result_segments:
            prompt = _build_results_prompt(seg, source_uri, resolved_sha256, snc, viewpoint_id)
            try:
                raw = await _call_summary_llm_direct(settings, prompt, name="grit_results")
                append_llm_call_record(
                    llm_call_records,
                    extraction_step_id=f"grit_results_{seg.char_start}",
                    model_alias=runtime.llm_model,
                    prompt=prompt,
                    response=raw,
                )
            except Exception as err:
                warnings.append(f"Results pass LLM call failed at segment {seg.char_start}: {err}")
                continue
            for c in _parse_llm_json_array(raw, warnings):
                all_candidates.append(
                    ExtractionCandidate(raw_dict=c, segment=seg, pass_name="results", is_negative=False)
                )

    if "negative" in passes_to_run and settings is not None:
        negative_text = extraction.text[:negative_text_cap]
        neg_segment = segments[0] if segments else GritSegment(
            text=negative_text,
            char_start=0,
            char_end=len(negative_text),
            page=1,
            section=None,
            segment_type="other",
        )
        prompt = _build_negative_prompt(negative_text, source_uri, resolved_sha256, snc, viewpoint_id)
        try:
            raw = await _call_summary_llm_direct(settings, prompt, name="grit_negative")
            append_llm_call_record(
                llm_call_records,
                extraction_step_id="grit_negative",
                model_alias=runtime.llm_model,
                prompt=prompt,
                response=raw,
            )
        except Exception as err:
            warnings.append(f"Negative pass LLM call failed: {err}")
            raw = "[]"
        for c in _parse_llm_json_array(raw, warnings):
            all_candidates.append(
                ExtractionCandidate(raw_dict=c, segment=neg_segment, pass_name="negative", is_negative=True)
            )

    # ── Stage 4: validate + repair ───────────────────────────────────────────
    validation = await validate_and_repair(
        all_candidates,
        source_uri=source_uri,
        sha256=resolved_sha256,
        viewpoint_should_not_claim=snc,
        viewpoint_id=viewpoint_id,
        settings=settings,
        llm_call_records=llm_call_records,
        warnings=warnings,
    )

    if not validation.valid_grits:
        warnings.append("No valid grits extracted. Bundle not written.")
        write_llm_calls_jsonl(output_dir / "grit_llm_calls.jsonl", llm_call_records)
        return GritSqueezerResult(
            bundle_path=None,
            validation_report=validation,
            warnings=warnings,
        )

    # ── Stage 5: verification (PaperQA2) ─────────────────────────────────────
    verification_report: list[dict[str, Any]] = []
    verification_activity: Activity | None = None
    if verify:
        try:
            verification_report, verification_activity = await verify_grits(
                validation.valid_grits,
                input_pdf,
                settings,
                viewpoint_id=viewpoint_id,
                llm_call_records=llm_call_records,
                warnings=warnings,
                evidence_k=verify_evidence_k,
                max_grits=verify_max_grits,
            )
        except Exception as err:  # pragma: no cover - verification never blocks output
            warnings.append(f"Verification pass failed: {err}")

    # ── Stage 6: assemble bundle ─────────────────────────────────────────────
    extra_activities = [verification_activity] if verification_activity is not None else []
    bundle_dict = assemble_bundle(
        extraction,
        source_uri,
        resolved_sha256,
        validation.valid_grits,
        viewpoint_id,
        passes_to_run,
        extra_activities=extra_activities,
    )

    # ── Stage 7: final validation gate ───────────────────────────────────────
    counts, final_errors = validate_bundle(bundle_dict)
    if final_errors:
        warnings.extend(final_errors)
        warnings.append(
            f"Bundle failed final validation with {len(final_errors)} errors. Bundle not written."
        )
        write_llm_calls_jsonl(output_dir / "grit_llm_calls.jsonl", llm_call_records)
        return GritSqueezerResult(
            bundle_path=None,
            validation_report=validation,
            warnings=warnings,
            verification_report=verification_report,
        )

    # ── Stage 8: write outputs ───────────────────────────────────────────────
    bundle_path = output_dir / "grit_bundle.yaml"
    bundle_path.write_text(
        yaml.dump(bundle_dict, allow_unicode=True, sort_keys=False, default_flow_style=False),
        encoding="utf-8",
    )

    report_path = output_dir / "grit_validation_report.json"
    report_path.write_text(
        json.dumps(
            {
                "candidates_attempted": validation.candidates_attempted,
                "passed": validation.passed,
                "repaired": validation.repaired,
                "rejected": validation.rejected,
                "grit_counts": counts,
                "total_grits": sum(counts.values()),
                "errors": validation.errors,
                "warnings": warnings,
            },
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )

    verification_path = output_dir / "grit_verification_report.json"
    verification_path.write_text(
        json.dumps(
            {"verified": len(verification_report), "results": verification_report},
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )

    write_llm_calls_jsonl(output_dir / "grit_llm_calls.jsonl", llm_call_records)

    outputs = {
        "grit_bundle_yaml": str(bundle_path),
        "grit_validation_report_json": str(report_path),
        "grit_verification_report_json": str(verification_path),
        "grit_llm_calls_jsonl": str(output_dir / "grit_llm_calls.jsonl"),
    }

    return GritSqueezerResult(
        bundle_path=bundle_path,
        validation_report=validation,
        warnings=warnings,
        verification_report=verification_report,
        outputs=outputs,
    )
