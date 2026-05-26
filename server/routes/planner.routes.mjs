import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.mjs';
import { logAuditEvent } from '../lib/auditEvents.mjs';

export const createPlannerRouter = ({ middleware, services }) => {
  const router = Router();
  const { requireAuth, userSubject } = middleware;
  const { planner, llmConfig, taskPlanner, repository } = services;

  router.get(
    '/api/planner-specs',
    requireAuth,
    asyncHandler(async (request, response) => {
      const catalog = planner.loadPlannerRepositories();
      logAuditEvent({
        event: 'planner_spec.read',
        actor: userSubject(request),
        action: 'read',
        resourceType: 'planner_spec',
        outcome: 'success',
        metadata: { specCount: catalog.specs.length, warningCount: catalog.warnings.length },
      });
      response.json({ specs: catalog.specs, warnings: catalog.warnings });
    }),
  );

  router.get(
    '/api/planner-config',
    requireAuth,
    asyncHandler(async (request, response) => {
      const projectId = String(request.query.projectId ?? '').trim();
      const catalog = planner.loadPlannerRepositories();
      const merged = await planner.readMergedPlannerConfig(request.user, projectId, catalog.specs);
      response.json({
        config: merged.config,
        globalConfig: merged.globalConfig,
        projectConfig: merged.projectConfig,
        spec: merged.spec,
        modelAliases: llmConfig.plannerModelAliases(),
        warnings: catalog.warnings,
      });
    }),
  );

  router.put(
    '/api/planner-config/default',
    requireAuth,
    asyncHandler(async (request, response) => {
      const catalog = planner.loadPlannerRepositories();
      const config = planner.normalizePlannerConfig(request.body?.config ?? request.body, catalog.specs);
      await services.secrets.write(services.secrets.plannerDefaultPath(request.user), {
        config,
        updatedAt: new Date().toISOString(),
      });
      logAuditEvent({
        event: 'planner_config.save',
        actor: userSubject(request),
        action: 'save',
        resourceType: 'planner_config',
        resourceId: 'default',
        outcome: 'success',
        metadata: { specId: config.specId },
      });
      response.json({ config });
    }),
  );

  router.put(
    '/api/projects/:id/planner-config',
    requireAuth,
    asyncHandler(async (request, response) => {
      const projectId = request.params.id;
      await repository.checkProjectRoleStandalone(projectId, request, ['owner', 'editor']);

      const catalog = planner.loadPlannerRepositories();
      const config = planner.normalizePlannerConfig(request.body?.config ?? request.body, catalog.specs);
      await services.secrets.write(services.secrets.plannerProjectPath(request.user, projectId), {
        projectId,
        config,
        updatedAt: new Date().toISOString(),
      });
      logAuditEvent({
        event: 'planner_config.save',
        actor: userSubject(request),
        action: 'save',
        resourceType: 'planner_config',
        resourceId: projectId,
        outcome: 'success',
        metadata: { specId: config.specId, projectId },
      });
      response.json({ config });
    }),
  );

  router.post(
    '/api/planner-config/test',
    requireAuth,
    asyncHandler(async (request, response) => {
      const catalog = planner.loadPlannerRepositories();
      const config = planner.normalizePlannerConfig(request.body?.config ?? request.body, catalog.specs);
      const spec = catalog.specs.find((item) => item.id === config.specId);
      const adapter = await taskPlanner.testAdapter(spec);
      logAuditEvent({
        event: 'planner_config.test',
        actor: userSubject(request),
        action: 'test',
        resourceType: 'planner_config',
        resourceId: config.specId,
        outcome: adapter.reachable ? 'success' : 'failure',
        metadata: { engine: spec?.engine, restartRequired: adapter.restartRequired },
      });
      response.json({
        ok: adapter.reachable,
        config,
        adapter,
        modelAliases: llmConfig.plannerModelAliases(),
      });
    }),
  );

  return router;
};
