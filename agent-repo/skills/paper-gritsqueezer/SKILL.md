---
name: paper-gritsqueezer
description: >
  Extracts a pygrits-schema-valid grit bundle from a scientific paper PDF.
  Runs three extraction passes (metadata, results, negative) over the paper
  using LLM extraction gated by Pydantic schema validation, then verifies each
  extracted grit against the paper using PaperQA2 retrieval. Produces a
  validated grit_bundle.yaml alongside PaperQA2 runner outputs.
  All grits are grounded to char-level source spans with real SHA256 hashes.
disable-model-invocation: false
---

## Purpose

Extract structured, epistemically disciplined evidence records from a scientific
paper. Each grit is grounded to a specific location in the source PDF via char
offsets, validated against the pygrits v0.4.0 schema, and annotated with
explicit should_not_claim rules. The bundle can be used to derive a knowledge
graph projection, identify evidence gaps, and support downstream reasoning.

PaperQA2 is used as the PDF parser and (in the verification stage) as a
retrieval-backed checker that double-checks every self-extracted grit against
the paper. Extraction itself is exhaustive and char-grounded; verification is
where retrieval/QA is applied.

## When to use

Use after the paper-reader-summary skill has run on the same paper, or
standalone when you need epistemically structured extraction rather than
(or in addition to) a summarization. Best results when the paper has a clear
methods/results/discussion structure.

## Inputs

- paper_path: str — path to the PDF file
- viewpoint_id: str — GritId of the pygrits ViewpointDirective to apply
  (default: "vpt:paper-extraction-v1")
- abstraction_level: str — optional CURIE for the ontology class this
  extraction operates at
- passes: list[str] — which passes to run; default ["metadata", "results", "negative"]
- max_segment_chars: int — max chars sent to the LLM per segment (default 6000)
- negative_text_cap: int — max chars sent to the negative pass (default 12000)
- verify: bool — run the PaperQA2 verification pass (default True)
- chunk_chars / chunk_overlap: int — PaperQA2 chunking knobs used by verification
- output_dir: str — directory to write outputs into

## Outputs

- grit_bundle_yaml: str — path to the validated grit_bundle.yaml
- validation_report_json: str — path to JSON with grit counts and errors
- verification_report_json: str — path to per-grit PaperQA2 verification verdicts
- llm_calls_jsonl: str — path to LLM call audit log

## Safety constraints

- Never write a bundle that fails pygrits Pydantic validation
- Never assert claims not grounded in source text
- Always record real char offsets from actual source spans
- Always run the negative pass; do not skip it
- Mark all extracted grits generation_mode: extracted_with_llm_v1
- Mark repaired grits generation_mode: extracted_with_repair_v1
- Flag grits that fail PaperQA2 verification; do not silently drop them
