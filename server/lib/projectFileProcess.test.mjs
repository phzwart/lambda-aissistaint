import assert from 'node:assert/strict';
import test from 'node:test';
import { parsedArtifactPrefix, parsedStemFromObjectKey, processLogObjectKey } from './projectParsedPaths.mjs';

test('processLogObjectKey lives under parsed artifact folder', () => {
  assert.equal(
    processLogObjectKey({ parsedPrefix: 'parsed' }, 'my-paper'),
    'parsed/my-paper/process.log',
  );
});

test('parsedStemFromObjectKey strips pdf extension', () => {
  assert.equal(parsedStemFromObjectKey('loaded/2026-05-19T12-00-00-abc-paper.pdf'), '2026-05-19T12-00-00-abc-paper');
});

test('parsedArtifactPrefix builds folder under parsed/', () => {
  assert.equal(
    parsedArtifactPrefix({ parsedPrefix: 'parsed' }, 'my-paper'),
    'parsed/my-paper/',
  );
});
