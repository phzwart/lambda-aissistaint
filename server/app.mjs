import cors from 'cors';
import express from 'express';
import { createRoleHelpers } from './middleware/roles.mjs';
import { createRequireAuth } from './middleware/auth.mjs';
import { createErrorHandler } from './middleware/errors.mjs';
import { createProjectDbGate } from './db/migrations.mjs';
import { createProjectRepository } from './db/projectRepository.mjs';
import { createSecretsService } from './services/secrets.service.mjs';
import { createLlmConfigService } from './services/llmConfig.service.mjs';
import { createTaskPlannerService } from './services/taskPlanner.service.mjs';
import { createAgentSkillsService } from './services/agentSkills.service.mjs';
import { createPlannerService } from './services/planner.service.mjs';
import { createWikiService } from './services/wiki.service.mjs';
import { createProjectsService } from './services/projects.service.mjs';
import { createProjectFilesService } from './services/projectFiles.service.mjs';
import { createProcessingService } from './services/processing.service.mjs';
import { createProvenanceService } from './services/provenance.service.mjs';
import { createHealthRouter } from './routes/health.routes.mjs';
import { createProjectsRouter } from './routes/projects.routes.mjs';
import { createProjectFilesRouter } from './routes/projectFiles.routes.mjs';
import { createProcessingRouter } from './routes/processing.routes.mjs';
import { createLlmRouter } from './routes/llm.routes.mjs';
import { createWikiRouter } from './routes/wiki.routes.mjs';
import { createPlannerRouter } from './routes/planner.routes.mjs';
import { createAgentSkillsRouter } from './routes/agentSkills.routes.mjs';
import { createProvenanceRouter } from './routes/provenance.routes.mjs';

export const buildServices = ({ config, deps }) => {
  const roles = createRoleHelpers({ config });
  const migrations = createProjectDbGate({ deps });
  const repository = createProjectRepository({ migrations, roles });

  const secrets = createSecretsService({ config, deps });
  const services = { secrets, roles };

  services.llmConfig = createLlmConfigService({ config, deps, services });
  services.taskPlanner = createTaskPlannerService({ config, deps, services });
  services.agentSkills = createAgentSkillsService({ config, services });
  services.planner = createPlannerService({ config, services });
  services.wiki = createWikiService({ config, deps, services });
  services.projects = createProjectsService({ config, deps, repository });
  services.projectFiles = createProjectFilesService({ services });
  services.processing = createProcessingService({ config, deps, services });
  services.provenance = createProvenanceService();
  services.repository = repository;
  services.migrations = migrations;

  return services;
};

export const createApp = ({ config, deps, services }) => {
  const roles = services.roles;
  const requireAuth = createRequireAuth({ config, deps });
  const middleware = {
    requireAuth,
    requireAdmin: roles.requireAdmin,
    requireProjectDeletionRole: roles.requireProjectDeletionRole,
    userSubject: roles.userSubject,
    isAdmin: roles.isAdmin,
    isRemovalAgent: roles.isRemovalAgent,
  };

  const app = express();
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || config.allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error('CORS origin is not allowed.'));
      },
    }),
  );
  app.use(express.json({ limit: '4mb' }));

  app.use(createHealthRouter({ config, middleware }));
  app.use(createProjectsRouter({ middleware, services, deps }));
  app.use(createProjectFilesRouter({ config, middleware, services, deps }));
  app.use(createProcessingRouter({ middleware, services, deps }));
  app.use(createLlmRouter({ config, middleware, services, deps }));
  app.use(createWikiRouter({ config, middleware, services, deps }));
  app.use(createPlannerRouter({ middleware, services }));
  app.use(createAgentSkillsRouter({ middleware, services, deps }));
  app.use(createProvenanceRouter({ middleware, services }));

  app.use(createErrorHandler({ deps }));

  return app;
};
