# Paper Processing — Observability and Poison-Robust Provenance

Design reference for the paper pipeline up to and including `parsed/` claim outputs. Wiki layer is out of scope.

## 1. Executive summary

The pipeline produces **content-addressable claim records** with `root_sources` (leaf PDF hashes), a **provenance DAG** per claim, **admin ingest traces**, and **aggregation primitives** that forbid treating shared-ancestor claims as independent evidence.

**Shared-ancestor invariant:** Any claim's confidence is meaningful only relative to its `root_sources`. Overlapping `root_sources` between claims are not independent for downstream combination.

## 2. Identifier glossary

| Identifier | Definition |
|------------|------------|
| `source_hash` | `sha256(pdf_bytes).hex` — stable across re-uploads |
| `span_id` | `sha256(source_hash + ":" + chunk_index + ":" + char_start + ":" + char_end).hex` |
| `ingest_id` | UUID per `processProjectFile` run |
| `extraction_step_id` | Stable stage name (`extract_pdf`, `paperqa_summary`, `claim_extract_llm`, …) |
| `claim_id` | Direct: hash of `{text, source_span_id, extraction_step_id}`; derived: hash of `{text, extraction_step_id, parent_claim_ids}` |

## 3. Artifact schemas

### `source_manifest.json`

```json
{
  "source_hash": "<sha256>",
  "file_id": "<32-char hex>",
  "object_key": "loaded/...",
  "stem": "<parsed folder stem>",
  "byte_size": 12345,
  "sha256_alg": "sha256"
}
```

### `source_spans.jsonl` (one JSON object per line)

```json
{
  "source_hash": "<sha256>",
  "span_id": "<hash>",
  "chunk_index": 0,
  "char_start": 0,
  "char_end": 1200,
  "page": 1,
  "text_preview": "..."
}
```

### `paperqa_evidence.json`

```json
{
  "version": 1,
  "passes": [
    {
      "extraction_step_id": "paperqa_summary",
      "contexts": [
        {
          "context_index": 0,
          "text": "...",
          "score": 0.82,
          "citation": "doc.pdf p. 4-5",
          "matched_span_id": null
        }
      ]
    }
  ]
}
```

### `claims.jsonl`

See `server/lib/provenance/claim.schema.json`.

### `ingest_manifest.json`

```json
{
  "ingest_id": "<uuid>",
  "source_hash": "<sha256>",
  "stem": "...",
  "started_at": "ISO-8601",
  "finished_at": "ISO-8601",
  "extraction_steps": ["extract_pdf", "paperqa_summary", "claim_extract_llm"]
}
```

## 4. Claim extraction

- **Placement:** separate skill boundary; **runtime:** Node in-process after PaperQA sync.
- **Module:** `server/lib/claims/extractClaims.mjs`
- **Tiers:** LLM primary (`llm-tier-*`); heuristic fallback from KG + summary anchors (`heuristic`, `confidence: null`).

## 5. Endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/projects/:id/claims/:claim_id/provenance` | owner, editor, viewer |
| GET | `/api/projects/:id/admin/ingest-trace/:source_hash` | `aissistaint-admin` |
| GET | `/api/projects/:id/admin/reingest-diff/:source_hash?from=&to=` | `aissistaint-admin` |

## 6. Ingest trace

- Storage: `parsed/_traces/{source_hash}/{ingest_id}.json`
- `INGEST_TRACE_RETAIN_CONTENT` (default `false`) — hashes only when false.

## 7. Aggregation

- Module: `server/lib/provenance/aggregate.mjs`
- Default policy `lower_bound`: shared roots cap combined confidence at max over shared-source paths.

## 8. Deletion manifest (separate sign-off)

| Item | Replacement |
|------|-------------|
| `uploadParsedArtifacts` | `syncParsedOutputDir` |
| `build_summary_prompt` | PaperQA structured summary |
| KG `claims[]` as canonical | `claims.jsonl` |

## 9. PR sequence

1. Design doc (this file)
2. Substrate + claims + schema
3. Provenance viewer API
4. Ingest trace
5. Aggregate + re-ingest diff
6. Dead code cleanup

## 10. Out of scope

Wiki ingest, `metadata/provenance.json`, SSBC calibration, TRACE, Agora integration.
