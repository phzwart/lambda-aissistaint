import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/asyncHandler.mjs';
import { logAuditEvent } from '../lib/auditEvents.mjs';

export const createProjectFilesRouter = ({ config, middleware, services, deps }) => {
  const router = Router();
  const { requireAuth, userSubject } = middleware;
  const { projects, projectFiles } = services;
  const { log } = deps;

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 20,
      fileSize: config.projectMaxUploadBytes,
    },
  });

  router.get(
    '/api/projects/:id/files',
    requireAuth,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, [
        'owner',
        'editor',
        'viewer',
      ]);
      const files = await projectFiles.listFiles(project);
      log('GET /api/projects/:id/files', {
        projectId: project.id,
        count: files.length,
        bucketName: project.bucketName,
      });
      logAuditEvent({
        event: 'project_file.list',
        actor: userSubject(request),
        action: 'read',
        resourceType: 'project_file',
        resourceId: project.id,
        outcome: 'success',
        metadata: { count: files.length, bucketName: project.bucketName },
      });
      response.json({ files });
    }),
  );

  router.post(
    '/api/projects/:id/files',
    requireAuth,
    upload.array('files'),
    asyncHandler(async (request, response) => {
      const uploads = Array.isArray(request.files) ? request.files : [];
      if (uploads.length === 0) {
        response.status(400).json({ error: 'At least one PDF file is required.' });
        return;
      }
      const project = await projects.requireProjectAccess(request.params.id, request, ['owner', 'editor']);
      const files = await projectFiles.uploadFiles(project, uploads);
      log('POST /api/projects/:id/files', {
        projectId: project.id,
        count: files.length,
        bucketName: project.bucketName,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      });
      logAuditEvent({
        event: 'project_file.upload',
        actor: userSubject(request),
        action: 'upload',
        resourceType: 'project_file',
        resourceId: project.id,
        outcome: 'success',
        metadata: { count: files.length, bucketName: project.bucketName },
      });
      response.status(201).json({ files });
    }),
  );

  return router;
};
