import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractClaims, verifyClaimRoundTrip } from './extractClaims.mjs';
import { validateClaim } from '../provenance/claimSchema.mjs';

test('verifyClaimRoundTrip passes when claim text matches span', () => {
  const extractedText = '\n\n[Page 1]\nRadiation alters diffraction signals.\n';
  const spansById = new Map([
    [
      'span1',
      {
        span_id: 'span1',
        char_start: 0,
        char_end: extractedText.length,
      },
    ],
  ]);
  const result = verifyClaimRoundTrip(
    {
      text: 'Radiation alters diffraction signals.',
      source_span_id: { span_id: 'span1' },
      provenance_kind: 'llm-tier-a',
    },
    { extractedText, spansById },
  );
  assert.equal(result.ok, true);
});

test('extractClaims heuristic fallback from knowledge graph', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'aissistaint-claims-'));
  const outputDir = join(workDir, 'output');
  await mkdir(outputDir, { recursive: true });
  const sourceHash = 'abc';
  const span = {
    source_hash: sourceHash,
    span_id: 'span1',
    chunk_index: 0,
    char_start: 0,
    char_end: 40,
    page: 1,
    text_preview: 'Sample',
  };
  await writeFile(join(outputDir, 'source_spans.jsonl'), `${JSON.stringify(span)}\n`, 'utf8');
  await writeFile(join(outputDir, 'extracted.txt'), '[Page 1]\nSample claim text here.\n', 'utf8');
  await writeFile(join(outputDir, 'summary.md'), '# Summary\n\nShort.', 'utf8');
  await writeFile(
    join(outputDir, 'knowledge_graph.json'),
    `${JSON.stringify({
      claims: [{ id: 'claim_1', statement: 'Sample claim text here.' }],
    })}\n`,
    'utf8',
  );
  await writeFile(
    join(outputDir, 'paperqa_evidence.json'),
    `${JSON.stringify({ version: 1, passes: [] })}\n`,
    'utf8',
  );

  const { claims } = await extractClaims({
    outputDir,
    sourceHash,
    ingestId: 'ingest-test',
    tier: 'a',
  });
  assert.ok(claims.length >= 1);
  for (const claim of claims) {
    assert.equal(validateClaim(claim).ok, true);
    assert.equal(claim.provenance_kind, 'heuristic');
    assert.equal(claim.confidence, null);
  }
  await rm(workDir, { recursive: true, force: true });
});
