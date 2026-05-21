import assert from 'node:assert/strict';
import test from 'node:test';

test('parsed-artifacts.zip route is registered before :artifactName', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../index.mjs', import.meta.url), 'utf8');
  const zipIndex = source.indexOf('parsed-artifacts.zip');
  const paramIndex = source.indexOf('parsed-artifacts/:artifactName');
  assert.ok(zipIndex > 0);
  assert.ok(paramIndex > 0);
  assert.ok(zipIndex < paramIndex);
});
