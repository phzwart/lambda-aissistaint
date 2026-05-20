import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendProjectProcessJobLog,
  createProjectProcessJob,
  findFileLogFromJobs,
  getProjectProcessJob,
  serializeProjectProcessJob,
  setProjectProcessJobFile,
} from './projectProcessJobs.mjs';

test('process job stores log lines and serializes safely', () => {
  const job = createProjectProcessJob({
    projectId: 'project-1',
    userId: 'user-1',
    fileIds: ['file-1'],
  });
  appendProjectProcessJobLog(job.id, 'first line');
  appendProjectProcessJobLog(job.id, 'second line');
  const loaded = getProjectProcessJob(job.id);
  assert.equal(loaded.lines.length, 2);
  const serialized = serializeProjectProcessJob(loaded);
  assert.equal(serialized.status, 'running');
  assert.equal(serialized.lines[1], 'second line');
});

test('findFileLogFromJobs returns per-file lines from in-memory job', () => {
  const job = createProjectProcessJob({
    projectId: 'project-1',
    userId: 'user-1',
    fileIds: ['file-a', 'file-b'],
    fileNames: { 'file-a': 'a.pdf', 'file-b': 'b.pdf' },
  });
  setProjectProcessJobFile(job.id, { fileId: 'file-a', fileName: 'a.pdf' });
  appendProjectProcessJobLog(job.id, 'line for a');
  const found = findFileLogFromJobs('project-1', 'file-a');
  assert.ok(found);
  assert.equal(found.jobId, job.id);
  assert.ok(found.lines.some((line) => line.includes('line for a')));
});
