import assert from 'node:assert/strict';
import test from 'node:test';
import {
  combineConfidences,
  poison,
  sharedAncestors,
  unionRootSources,
} from './aggregate.mjs';

const claim = (id, confidence, rootSources, parents = []) => ({
  claim_id: id,
  confidence,
  root_sources: rootSources,
  parent_claim_ids: parents,
});

test('unionRootSources merges sets', () => {
  const roots = unionRootSources([
    claim('a', 0.5, ['S1']),
    claim('b', 0.6, ['S2']),
  ]);
  assert.deepEqual([...roots].sort(), ['S1', 'S2']);
});

test('sharedAncestors returns intersection', () => {
  const shared = sharedAncestors(
    claim('a', 0.5, ['S1', 'S2']),
    claim('b', 0.6, ['S2', 'S3']),
  );
  assert.deepEqual([...shared], ['S2']);
});

test('combineConfidences lower_bound caps shared ancestry', () => {
  const source = 'S';
  const a = claim('A', 0.9, [source]);
  const b = claim('B', 0.9, [source], ['A']);
  const c = claim('C', 0.9, [source], ['A']);
  const combined = combineConfidences([b, c], 'lower_bound');
  assert.ok(combined.confidence <= 0.9);
  assert.ok(combined.audit.shared_root_sources.includes(source));
});

test('combineConfidences disjoint roots multiply under lower_bound', () => {
  const combined = combineConfidences(
    [claim('a', 0.5, ['S1']), claim('b', 0.5, ['S2'])],
    'lower_bound',
  );
  assert.equal(combined.confidence, 0.25);
});

test('poison returns derived claims at any depth', () => {
  const source = 'S';
  const all = [
    claim('A', null, [source]),
    claim('B', 0.8, [source], ['A']),
    claim('C', 0.7, [source], ['A']),
  ];
  const affected = poison(source, all);
  assert.equal(affected.length, 3);
});
