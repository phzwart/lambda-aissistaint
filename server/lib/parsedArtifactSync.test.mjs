import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { syncParsedOutputDir } from './parsedArtifactSync.mjs';

test('syncParsedOutputDir uploads new files and skips unchanged', async () => {
  const workDir = join(tmpdir(), `artifact-sync-${Date.now()}`);
  await mkdir(workDir, { recursive: true });
  const outputDir = join(workDir, 'output');
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'extracted.txt'), 'hello paper', 'utf8');

  const putKeys = [];
  const client = {
    send: async (command) => {
      putKeys.push(command.input.Key);
      return {};
    },
  };
  const project = { bucketName: 'test-bucket', parsedPrefix: 'parsed' };
  const stem = 'my-stem';

  const first = await syncParsedOutputDir({ client, project, stem, outputDir });
  assert.equal(putKeys.length, 1);
  assert.ok(first.artifactKeys['extracted.txt']);

  const second = await syncParsedOutputDir({
    client,
    project,
    stem,
    outputDir,
    uploaded: first.uploadedKeys,
  });
  assert.equal(putKeys.length, 1);

  await writeFile(join(outputDir, 'abstract.txt'), 'abstract body', 'utf8');
  await syncParsedOutputDir({
    client,
    project,
    stem,
    outputDir,
    uploaded: second.uploadedKeys,
  });
  assert.equal(putKeys.length, 2);

  await rm(workDir, { recursive: true, force: true });
});
