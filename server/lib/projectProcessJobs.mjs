import { randomUUID } from 'node:crypto';

const MAX_JOB_LOG_LINES = 4000;
const MAX_FILE_LOG_LINES = 2000;
const JOB_TTL_MS = Number.parseInt(process.env.PROJECT_PROCESS_JOB_TTL_MS ?? '3600000', 10) || 3_600_000;

/** @type {Map<string, object>} */
const jobs = new Map();

const trimLines = (lines, max = MAX_JOB_LOG_LINES) => {
  if (lines.length <= max) {
    return lines;
  }
  return lines.slice(lines.length - max);
};

const pruneExpiredJobs = () => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if ((job.finishedAt ?? job.startedAt) < cutoff) {
      jobs.delete(id);
    }
  }
};

const ensureFileLog = (job, fileId, fileName = '') => {
  if (!job.fileLogs[fileId]) {
    job.fileLogs[fileId] = {
      fileId,
      fileName: fileName || fileId,
      status: 'pending',
      lines: [],
      updatedAt: Date.now(),
    };
  } else if (fileName) {
    job.fileLogs[fileId].fileName = fileName;
  }
  return job.fileLogs[fileId];
};

export const createProjectProcessJob = ({ projectId, userId, fileIds, fileNames = {} }) => {
  pruneExpiredJobs();
  const id = randomUUID();
  const job = {
    id,
    projectId,
    userId,
    fileIds,
    status: 'running',
    lines: [],
    fileLogs: {},
    currentFileId: null,
    currentFileName: null,
    files: [],
    failures: [],
    wikiPages: [],
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  for (const fileId of fileIds) {
    ensureFileLog(job, fileId, fileNames[fileId] ?? '');
    job.fileLogs[fileId].status = 'pending';
  }
  jobs.set(id, job);
  return job;
};

export const getProjectProcessJob = (jobId) => jobs.get(jobId) ?? null;

/** Best-effort log recovery when MinIO has no process.log yet (in-memory jobs only). */
export const findFileLogFromJobs = (projectId, fileId) => {
  pruneExpiredJobs();
  let best = null;
  for (const job of jobs.values()) {
    if (job.projectId !== projectId) {
      continue;
    }
    const entry = job.fileLogs[fileId];
    if (!entry?.lines?.length) {
      continue;
    }
    if (!best || entry.updatedAt > best.updatedAt) {
      best = {
        jobId: job.id,
        status: entry.status,
        lines: entry.lines,
        updatedAt: entry.updatedAt,
        jobStatus: job.status,
      };
    }
  }
  return best;
};

export const listProjectProcessJobs = (projectId, { fileId } = {}) => {
  pruneExpiredJobs();
  const matches = [];
  for (const job of jobs.values()) {
    if (job.projectId !== projectId) {
      continue;
    }
    if (fileId && !job.fileIds.includes(fileId)) {
      continue;
    }
    matches.push(serializeProjectProcessJob(job));
  }
  return matches.sort((a, b) => b.startedAt - a.startedAt);
};

export const appendProjectProcessJobLog = (jobId, message, { mirrorLog, fileId } = {}) => {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  job.lines = trimLines([...job.lines, message]);

  const targetFileId = fileId ?? job.currentFileId;
  if (targetFileId) {
    const entry = ensureFileLog(job, targetFileId, job.fileLogs[targetFileId]?.fileName);
    entry.lines = trimLines([...entry.lines, message], MAX_FILE_LOG_LINES);
    entry.updatedAt = Date.now();
  }

  if (mirrorLog) {
    mirrorLog('project_file.process.log', { jobId, line: message, fileId: targetFileId });
  }
};

export const setProjectProcessJobFile = (jobId, { fileId, fileName }) => {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  job.currentFileId = fileId;
  job.currentFileName = fileName;
  const entry = ensureFileLog(job, fileId, fileName);
  entry.status = 'running';
  entry.updatedAt = Date.now();
};

export const setProjectProcessFileLogStatus = (jobId, fileId, status) => {
  const job = jobs.get(jobId);
  if (!job?.fileLogs[fileId]) {
    return;
  }
  job.fileLogs[fileId].status = status;
  job.fileLogs[fileId].updatedAt = Date.now();
};

export const completeProjectProcessJob = (jobId, { files, failures, wikiPages }) => {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  job.status = failures.length > 0 && !files.some((file) => file.status === 'completed') ? 'failed' : 'completed';
  job.files = files;
  job.failures = failures;
  job.wikiPages = wikiPages;
  job.finishedAt = Date.now();
  job.currentFileId = null;
  job.currentFileName = null;
  for (const file of files) {
    if (job.fileLogs[file.id]) {
      job.fileLogs[file.id].status = file.status === 'completed' ? 'completed' : 'failed';
      job.fileLogs[file.id].updatedAt = Date.now();
    }
  }
};

export const failProjectProcessJob = (jobId, error) => {
  const job = jobs.get(jobId);
  if (!job) {
    return;
  }
  job.status = 'failed';
  job.error = error instanceof Error ? error.message : String(error);
  job.finishedAt = Date.now();
};

export const serializeProjectProcessJob = (job) => ({
  id: job.id,
  projectId: job.projectId,
  status: job.status,
  lines: job.lines,
  fileLogs: Object.values(job.fileLogs).map((entry) => ({
    fileId: entry.fileId,
    fileName: entry.fileName,
    status: entry.status,
    lines: entry.lines,
    updatedAt: entry.updatedAt,
  })),
  currentFileId: job.currentFileId,
  currentFileName: job.currentFileName,
  files: job.files,
  failures: job.failures,
  wikiPages: job.wikiPages,
  error: job.error,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
});
