import assert from 'node:assert/strict';
import test from 'node:test';
import { validateClaim, provenanceKindForTier } from './claimSchema.mjs';

test('validateClaim accepts llm-tier-a with confidence', () => {
  const result = validateClaim({
    claim_id: 'c1',
    text: 'A claim',
    source_span_id: {
      source_hash: 'hash',
      span_id: 'span',
      chunk_index: 0,
      char_start: 0,
      char_end: 10,
    },
    extraction_step_id: 'claim_extract_llm',
    confidence: 0.8,
    provenance_kind: 'llm-tier-a',
    parent_claim_ids: [],
    root_sources: ['hash'],
    ingest_id: 'ingest-1',
  });
  assert.equal(result.ok, true);
});

test('validateClaim rejects heuristic with confidence', () => {
  const result = validateClaim({
    claim_id: 'c1',
    text: 'A claim',
    extraction_step_id: 'claim_extract_heuristic',
    confidence: 0.5,
    provenance_kind: 'heuristic',
    parent_claim_ids: [],
    root_sources: ['hash'],
    ingest_id: 'ingest-1',
  });
  assert.equal(result.ok, false);
});

test('validateClaim requires verified_by for human-edited', () => {
  const result = validateClaim({
    claim_id: 'c1',
    text: 'A claim',
    extraction_step_id: 'human',
    confidence: null,
    provenance_kind: 'human-edited',
    parent_claim_ids: [],
    root_sources: ['hash'],
    ingest_id: 'ingest-1',
  });
  assert.equal(result.ok, false);
});

test('provenanceKindForTier maps tiers', () => {
  assert.equal(provenanceKindForTier('b'), 'llm-tier-b');
  assert.equal(provenanceKindForTier('c'), 'llm-tier-c');
  assert.equal(provenanceKindForTier('a'), 'llm-tier-a');
});
