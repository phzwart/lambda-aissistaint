import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.mjs';
import { listProjectFiles } from '../lib/projectFiles.mjs';
import { parsedStemFromObjectKey, processLogObjectKey } from '../lib/projectParsedPaths.mjs';

export const createProcessingRouter = ({ middleware, services, deps }) => {
  const router = Router();
  const { requireAuth, userSubject } = middleware;
  const { projects, processing } = services;
  const { log } = deps;

  router.post(
    '/api/projects/:id/files/process',
    requireAuth,
    asyncHandler(async (request, response) => {
      const fileIds = Array.isArray(request.body?.fileIds)
        ? request.body.fileIds.map((value) => String(value))
        : [];
      if (fileIds.length === 0) {
        response.status(400).json({ error: 'Select at least one file to process.' });
        return;
      }
      const project = await projects.requireProjectAccess(request.params.id, request, ['owner', 'editor']);
      const client = projects.requireProjectMinio(project);
      const indexed = new Map((await listProjectFiles(client, project)).map((file) => [file.id, file]));
      const selected = fileIds.map((id) => indexed.get(id)).filter(Boolean);
      if (selected.length === 0) {
        response.status(404).json({ error: 'No matching uploaded files were found for this project.' });
        return;
      }

      const actor = userSubject(request);
      const { job, paperqaRuntime } = await processing.startProcessJob({
        request,
        project,
        selected,
        actor,
      });

      log('POST /api/projects/:id/files/process start', {
        projectId: project.id,
        jobId: job.id,
        fileCount: selected.length,
        bucketName: project.bucketName,
        litellmModelAlias: paperqaRuntime.litellmRuntime.modelAlias,
        litellmUrl: paperqaRuntime.litellmRuntime.litellmUrl,
        providerModel: paperqaRuntime.litellmRuntime.providerModel,
        hasLitellmApiKey: Boolean(paperqaRuntime.litellmApiKey),
      });

      response.status(202).json({ jobId: job.id, status: 'running' });
    }),
  );

  router.get(
    '/api/projects/:id/files/process/jobs',
    requireAuth,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, [
        'owner',
        'editor',
        'viewer',
      ]);
      const fileId = typeof request.query.fileId === 'string' ? request.query.fileId : undefined;
      const jobs = processing.listJobs(project.id, { fileId });
      response.json({ jobs });
    }),
  );

  router.get(
    '/api/projects/:id/files/process/jobs/:jobId',
    requireAuth,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, [
        'owner',
        'editor',
        'viewer',
      ]);
      const job = processing.getJob(request.params.jobId);
      if (!job || job.projectId !== project.id) {
        response.status(404).json({ error: 'Processing job not found.' });
        return;
      }
      if (job.userId !== userSubject(request)) {
        response.status(403).json({ error: 'You do not have access to this processing job.' });
        return;
      }
      response.json({ job: processing.serializeJob(job) });
    }),
  );

  router.get(
    '/api/projects/:id/files/:fileId/process-log',
    requireAuth,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, [
        'owner',
        'editor',
        'viewer',
      ]);
      const client = projects.requireProjectMinio(project);
      const files = await listProjectFiles(client, project);
      const file = files.find((entry) => entry.id === request.params.fileId);
      if (!file) {
        response.status(404).json({ error: 'File not found in this project.' });
        return;
      }

      const stem = parsedStemFromObjectKey(file.objectKey);
      const objectKey = processLogObjectKey(project, stem);
      const logText = await processing.readProcessLog(client, project, file);
      if (logText !== null) {
        response.json({
          fileId: file.id,
          fileName: file.name,
          log: logText,
          source: 'minio',
          objectKey,
          parsedPrefix: project.parsedPrefix ?? 'parsed',
        });
        return;
      }

      const jobLog = processing.findFileLog(project.id, file.id);
      if (jobLog?.lines?.length) {
        response.json({
          fileId: file.id,
          fileName: file.name,
          log: jobLog.lines.join('\n'),
          source: 'job',
          jobId: jobLog.jobId,
          jobStatus: jobLog.jobStatus,
          fileLogStatus: jobLog.status,
        });
        return;
      }

      response.status(404).json({
        error:
          'No process log found for this file. If the server restarted or the job crashed before a checkpoint, logs may be lost. Re-run Process to generate a new log.',
      });
    }),
  );

  return router;
};
