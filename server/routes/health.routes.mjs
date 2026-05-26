import { Router } from 'express';

export const createHealthRouter = ({ config, middleware }) => {
  const router = Router();
  const { requireAuth, requireAdmin } = middleware;

  router.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });

  router.get('/api/health/details', requireAuth, requireAdmin, (_request, response) => {
    response.json({
      ok: true,
      issuer: config.issuer,
      keycloakJwksUrl: config.keycloakJwksUrl,
      openBaoUrl: config.openBaoUrl,
      openBaoKvMount: config.openBaoKvMount,
      openBaoPrefix: config.openBaoPrefix,
      liteLlmUrl: config.liteLlmUrl,
      appDatabaseConfigured: Boolean(config.appDatabaseUrl),
    });
  });

  return router;
};
