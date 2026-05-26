import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.mjs';
import { logAuditEvent } from '../lib/auditEvents.mjs';
import { toProject } from '../db/projectRepository.mjs';

export const createProjectsRouter = ({ middleware, services, deps }) => {
  const router = Router();
  const { requireAuth, requireProjectDeletionRole, userSubject } = middleware;
  const { projects, repository } = services;
  const { log } = deps;

  router.get(
    '/api/projects',
    requireAuth,
    asyncHandler(async (request, response) => {
      const result = await repository.listProjectsForRequest(request);
      log('GET /api/projects', { count: result.rowCount });
      response.json({ projects: result.rows.map(toProject) });
    }),
  );

  router.post(
    '/api/projects',
    requireAuth,
    asyncHandler(async (request, response) => {
      const name = String(request.body?.name ?? '').trim();
      const description = String(request.body?.description ?? '').trim();
      const subject = userSubject(request);

      const project = await projects.createProject({ name, description, subject });
      response.status(201).json({ project });
    }),
  );

  router.patch(
    '/api/projects/:id',
    requireAuth,
    asyncHandler(async (request, response) => {
      const id = request.params.id;
      const name = request.body?.name === undefined ? undefined : String(request.body.name).trim();
      const description =
        request.body?.description === undefined ? undefined : String(request.body.description).trim();
      const status = request.body?.status === undefined ? undefined : String(request.body.status).trim();

      const project = await projects.patchProject({ id, name, description, status, request });
      response.json({ project });
    }),
  );

  router.delete(
    '/api/projects/:id',
    requireAuth,
    requireProjectDeletionRole,
    asyncHandler(async (request, response) => {
      const id = request.params.id;
      const project = await projects.deleteProject({ id });
      logAuditEvent({
        event: 'project.delete',
        actor: userSubject(request),
        action: 'delete',
        resourceType: 'project',
        resourceId: id,
        outcome: 'success',
        metadata: { bucketName: project.bucketName, status: 'deleted' },
      });
      response.status(204).send();
    }),
  );

  return router;
};
