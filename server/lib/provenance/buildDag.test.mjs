import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProvenanceDag, provenanceForClaim } from './buildDag.mjs';

test('provenanceForClaim includes claim and span nodes', () => {
  const spans = [
    {
      source_hash: 'S',
      span_id: 'span1',
      chunk_index: 0,
      char_start: 0,
      char_end: 10,
      page: 1,
    },
  ];
  const claims = [
    {
      claim_id: 'claim1',
      text: 'Test',
      extraction_step_id: 'claim_extract_llm',
      provenance_kind: 'llm-tier-a',
      parent_claim_ids: [],
      source_span_id: { span_id: 'span1', source_hash: 'S' },
    },
  ];
  const dag = buildProvenanceDag({
    claims,
    spans,
    evidence: { passes: [] },
    sourceHash: 'S',
    ingestId: 'ingest-1',
  });
  const view = provenanceForClaim(dag, 'claim1');
  assert.ok(view.nodes.some((node) => node.id === 'claim:claim1'));
  assert.ok(view.nodes.some((node) => node.id === 'span:span1'));
});
