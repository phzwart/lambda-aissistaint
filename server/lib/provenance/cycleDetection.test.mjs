import assert from 'node:assert/strict';
import test from 'node:test';
import { detectParentCycle } from './cycleDetection.mjs';

test('detectParentCycle finds cycle', () => {
  const parentMap = new Map([
    ['A', ['B']],
    ['B', ['C']],
  ]);
  const error = detectParentCycle(parentMap, 'C', ['A']);
  assert.ok(error);
});

test('detectParentCycle accepts acyclic graph', () => {
  const parentMap = new Map([['B', ['A']]]);
  const error = detectParentCycle(parentMap, 'C', ['B']);
  assert.equal(error, null);
});
