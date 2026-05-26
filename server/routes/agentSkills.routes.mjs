import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.mjs';
import { logAuditEvent } from '../lib/auditEvents.mjs';
import { enrichPaperReaderBindingsForEditor } from '../lib/paperReaderProcessingConfig.mjs';

export const createAgentSkillsRouter = ({ middleware, services, deps }) => {
  const router = Router();
  const { requireAuth, userSubject } = middleware;
  const { agentSkills, repository, secrets } = services;
  const { log } = deps;

  router.get(
    '/api/agent-executors',
    requireAuth,
    (request, response) => {
      logAuditEvent({
        event: 'agent_executor.catalog_read',
        actor: userSubject(request),
        action: 'read',
        resourceType: 'agent_executor',
        outcome: 'success',
        metadata: { count: agentSkills.agentExecutorCatalog.length },
      });
      response.json({ executors: agentSkills.agentExecutorCatalog });
    },
  );

  router.get(
    '/api/agent-repos',
    requireAuth,
    (request, response) => {
      const catalog = agentSkills.loadAgentRepositories();
      logAuditEvent({
        event: 'agent_repo.read',
        actor: userSubject(request),
        action: 'read',
        resourceType: 'agent_repo',
        outcome: 'success',
        metadata: {
          repoCount: catalog.repos.length,
          skillCount: catalog.skills.length,
          warningCount: catalog.warnings.length,
        },
      });
      response.json({ repos: catalog.repos, warnings: catalog.warnings });
    },
  );

  router.get(
    '/api/agent-skills',
    requireAuth,
    asyncHandler(async (request, response) => {
      const projectId = String(request.query.projectId ?? '').trim();
      const repoCatalog = agentSkills.loadAgentRepositories();
      const userSkills = await agentSkills.readAgentSkills(request.user);
      const packageSkillIds = new Set(repoCatalog.skills.map((skill) => skill.id));
      const skills = [
        ...repoCatalog.skills,
        ...userSkills.filter((skill) => !packageSkillIds.has(skill.id)),
      ];
      const bindings = enrichPaperReaderBindingsForEditor(
        await agentSkills.readProjectAgentSkillBindings(request.user, projectId, skills),
      );
      log('GET /api/agent-skills', {
        count: skills.length,
        projectId: projectId || undefined,
        bindingCount: bindings.length,
        packageSkillCount: repoCatalog.skills.length,
        userSkillCount: userSkills.length,
      });
      logAuditEvent({
        event: 'agent_repo.read',
        actor: userSubject(request),
        action: 'read',
        resourceType: 'agent_repo',
        outcome: 'success',
        metadata: {
          repoCount: repoCatalog.repos.length,
          skillCount: repoCatalog.skills.length,
          warningCount: repoCatalog.warnings.length,
        },
      });
      response.json({ skills, bindings });
    }),
  );

  router.post(
    '/api/agent-skills',
    requireAuth,
    asyncHandler(async (request, response) => {
      const input = request.body?.skill ?? {};
      const repoCatalog = agentSkills.loadAgentRepositories();
      const packageSkillIds = new Set(repoCatalog.skills.map((skill) => skill.id));
      if (
        input.source === 'package' ||
        input.editable === false ||
        packageSkillIds.has(String(input.id ?? ''))
      ) {
        throw Object.assign(
          new Error('Repository skills are read-only. Duplicate the skill before editing it.'),
          { status: 400 },
        );
      }
      const existingSecret = input.id
        ? await secrets.read(secrets.agentSkillPath(request.user, String(input.id)))
        : null;
      const existing = existingSecret?.data?.data ?? {};
      const skill = agentSkills.normalizeAgentSkill(input, existing);
      const ids = await agentSkills.readAgentSkillIndex(request.user);
      await secrets.write(secrets.agentSkillPath(request.user, skill.id), skill);
      await agentSkills.writeAgentSkillIndex(request.user, [skill.id, ...ids]);
      log('POST /api/agent-skills', {
        id: skill.id,
        status: skill.status,
        executorMode: skill.executable.mode,
      });
      logAuditEvent({
        event: 'agent_skill.save',
        actor: userSubject(request),
        action: 'save',
        resourceType: 'agent_skill',
        resourceId: skill.id,
        outcome: 'success',
        metadata: { status: skill.status, executorMode: skill.executable.mode },
      });
      response.json({ skill });
    }),
  );

  router.delete(
    '/api/agent-skills/:id',
    requireAuth,
    asyncHandler(async (request, response) => {
      const id = String(request.params.id ?? '');
      if (!agentSkills.agentSkillIdPattern.test(id)) {
        response.status(400).json({ error: 'Skill id contains unsupported characters.' });
        return;
      }
      const repoCatalog = agentSkills.loadAgentRepositories();
      if (repoCatalog.skills.some((skill) => skill.id === id)) {
        response.status(400).json({ error: 'Repository skills are read-only and cannot be deleted.' });
        return;
      }

      const ids = await agentSkills.readAgentSkillIndex(request.user);
      await Promise.all([
        secrets.deleteMetadata(secrets.agentSkillPath(request.user, id)),
        agentSkills.writeAgentSkillIndex(
          request.user,
          ids.filter((skillId) => skillId !== id),
        ),
      ]);
      log('DELETE /api/agent-skills/:id', { id });
      logAuditEvent({
        event: 'agent_skill.delete',
        actor: userSubject(request),
        action: 'delete',
        resourceType: 'agent_skill',
        resourceId: id,
        outcome: 'success',
      });
      response.status(204).send();
    }),
  );

  router.put(
    '/api/projects/:id/agent-skills',
    requireAuth,
    asyncHandler(async (request, response) => {
      const projectId = request.params.id;
      await repository.checkProjectRoleStandalone(projectId, request, ['owner', 'editor']);

      const repoCatalog = agentSkills.loadAgentRepositories();
      const userSkills = await agentSkills.readAgentSkills(request.user);
      const packageSkillIds = new Set(repoCatalog.skills.map((skill) => skill.id));
      const skills = [
        ...repoCatalog.skills,
        ...userSkills.filter((skill) => !packageSkillIds.has(skill.id)),
      ];
      const bindings = agentSkills.normalizeProjectSkillBindings(request.body?.bindings, skills);
      await secrets.write(secrets.agentProjectSkillBindingsPath(request.user, projectId), {
        projectId,
        bindings,
        updatedAt: new Date().toISOString(),
      });
      const bindingsForClient = enrichPaperReaderBindingsForEditor(bindings);
      log('PUT /api/projects/:id/agent-skills', { projectId, bindingCount: bindings.length });
      logAuditEvent({
        event: 'agent_skill.enable',
        actor: userSubject(request),
        action: 'enable',
        resourceType: 'agent_skill',
        resourceId: projectId,
        outcome: 'success',
        metadata: {
          enabledCount: bindings.filter((binding) => binding.enabled).length,
          bindingCount: bindings.length,
        },
      });
      response.json({ bindings: bindingsForClient });
    }),
  );

  return router;
};
