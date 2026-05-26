import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { actorFromPayload, logAuditEvent } from '../lib/auditEvents.mjs';
import { loadPlannerSpecCatalog } from '../lib/plannerRepo.mjs';
import {
  plannerSkillDirectoryName,
  renderPlannerSkillCatalog,
  renderPlannerSkillMarkdown,
  resolvePlannerVisibleSkills,
} from '../lib/plannerSkillCatalog.mjs';

const trimBounded = (value, label, maxLength, { required = false } = {}) => {
  const trimmed = String(value ?? '').trim();
  if (required && !trimmed) {
    throw Object.assign(new Error(`${label} is required.`), { status: 400 });
  }
  if (trimmed.length > maxLength) {
    throw Object.assign(new Error(`${label} must be ${maxLength} characters or less.`), { status: 400 });
  }
  return trimmed;
};

const splitLines = (value) =>
  Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : String(value ?? '')
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);

export const createPlannerService = ({ config, services }) => {
  const { secrets, llmConfig, agentSkills } = services;
  const { plannerRepoDirectories, gooseWorkspaceHostDir, gooseWorkingDir } = config;

  const loadPlannerRepositories = () =>
    loadPlannerSpecCatalog({ directories: plannerRepoDirectories, logger: console });

  const defaultPlannerConfigFromSpec = (spec) => {
    const aliases = llmConfig.plannerModelAliases();
    const fallbackAlias = aliases[0]?.alias ?? 'LLM_A';
    return {
      specId: spec?.id ?? '',
      roleBindings: Object.fromEntries(
        (spec?.modelRoles ?? ['planner', 'worker', 'summarizer']).map((role) => [role, fallbackAlias]),
      ),
      contextPolicy: {
        strategy: spec?.defaultContext?.strategy ?? 'summarize',
        maxTurns: spec?.defaultContext?.maxTurns ?? 50,
        subagentMaxTurns: spec?.defaultContext?.subagentMaxTurns ?? 25,
      },
      skillPolicy: {
        visibility: spec?.skillPolicy?.defaultVisibility ?? 'project-enabled',
        allowedSkillIds: spec?.skillPolicy?.allowedSkillIds ?? [],
        allowedCategories: spec?.skillPolicy?.allowedCategories ?? [],
      },
      workspaceMode: spec?.workspacePolicy?.mode ?? 'project-workspace',
    };
  };

  const mergePlannerConfig = (spec, globalConfig = {}, projectConfig = {}) => ({
    ...defaultPlannerConfigFromSpec(spec),
    ...globalConfig,
    ...projectConfig,
    roleBindings: {
      ...defaultPlannerConfigFromSpec(spec).roleBindings,
      ...(globalConfig.roleBindings ?? {}),
      ...(projectConfig.roleBindings ?? {}),
    },
    contextPolicy: {
      ...defaultPlannerConfigFromSpec(spec).contextPolicy,
      ...(globalConfig.contextPolicy ?? {}),
      ...(projectConfig.contextPolicy ?? {}),
    },
    skillPolicy: {
      ...defaultPlannerConfigFromSpec(spec).skillPolicy,
      ...(globalConfig.skillPolicy ?? {}),
      ...(projectConfig.skillPolicy ?? {}),
    },
  });

  const normalizePlannerConfig = (input = {}, specs = []) => {
    const fallbackSpec = specs[0];
    const specId = trimBounded(input.specId || fallbackSpec?.id || '', 'Planner spec', 80, { required: true });
    const spec = specs.find((item) => item.id === specId);
    if (!spec) {
      throw Object.assign(new Error('Selected planner spec is not available.'), { status: 400 });
    }

    const allowedAliases = llmConfig.plannerAliasSet();
    const base = defaultPlannerConfigFromSpec(spec);
    const roleBindings = {};
    for (const role of spec.modelRoles) {
      const alias = trimBounded(
        input.roleBindings?.[role] || base.roleBindings[role],
        `Model binding for ${role}`,
        40,
        { required: true },
      );
      if (!allowedAliases.has(alias)) {
        throw Object.assign(new Error(`Model binding for ${role} must use a configured LiteLLM alias.`), {
          status: 400,
        });
      }
      roleBindings[role] = alias;
    }

    const strategy = ['summarize', 'truncate', 'clear', 'prompt'].includes(input.contextPolicy?.strategy)
      ? input.contextPolicy.strategy
      : base.contextPolicy.strategy;
    const maxTurns = Math.min(
      Math.max(Number.parseInt(input.contextPolicy?.maxTurns ?? base.contextPolicy.maxTurns, 10) || 50, 1),
      200,
    );
    const subagentMaxTurns = Math.min(
      Math.max(
        Number.parseInt(input.contextPolicy?.subagentMaxTurns ?? base.contextPolicy.subagentMaxTurns, 10) || 25,
        1,
      ),
      100,
    );
    const visibility = ['all-enabled', 'project-enabled', 'allowlist'].includes(input.skillPolicy?.visibility)
      ? input.skillPolicy.visibility
      : base.skillPolicy.visibility;

    return {
      specId,
      roleBindings,
      contextPolicy: { strategy, maxTurns, subagentMaxTurns },
      skillPolicy: {
        visibility,
        allowedSkillIds: splitLines(input.skillPolicy?.allowedSkillIds).slice(0, 100),
        allowedCategories: splitLines(input.skillPolicy?.allowedCategories).slice(0, 30),
      },
      workspaceMode: ['project-workspace', 'goose-workspace', 'read-only'].includes(input.workspaceMode)
        ? input.workspaceMode
        : base.workspaceMode,
      updatedAt: new Date().toISOString(),
    };
  };

  const readPlannerConfigRecord = async (path) => {
    const secret = await secrets.read(path);
    return secret?.data?.data?.config ?? null;
  };

  const readMergedPlannerConfig = async (user, projectId, specs) => {
    const globalConfig = await readPlannerConfigRecord(secrets.plannerDefaultPath(user));
    const selectedSpecId = projectId
      ? (await readPlannerConfigRecord(secrets.plannerProjectPath(user, projectId)))?.specId ||
        globalConfig?.specId
      : globalConfig?.specId;
    const spec = specs.find((item) => item.id === selectedSpecId) ?? specs[0];
    if (!spec) {
      return { config: null, globalConfig, projectConfig: null, spec: null };
    }
    const projectConfig = projectId
      ? await readPlannerConfigRecord(secrets.plannerProjectPath(user, projectId))
      : null;
    return {
      config: mergePlannerConfig(spec, globalConfig ?? {}, projectConfig ?? {}),
      globalConfig,
      projectConfig,
      spec,
    };
  };

  const safeProjectWorkspaceName = (projectId) => {
    const normalized = String(projectId ?? '')
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96);
    if (!normalized) {
      throw Object.assign(new Error('Project id is required for planner Goose workspace materialization.'), {
        status: 400,
      });
    }
    return normalized;
  };

  const projectGooseWorkspace = (projectId) => {
    const projectDirectory = safeProjectWorkspaceName(projectId);
    const hostPath = resolve(gooseWorkspaceHostDir, 'projects', projectDirectory);
    const relativeHostPath = relative(gooseWorkspaceHostDir, hostPath);
    if (relativeHostPath.startsWith('..') || relativeHostPath === '') {
      throw Object.assign(new Error('Resolved Goose project workspace is invalid.'), { status: 500 });
    }
    return {
      hostPath,
      containerPath: `${gooseWorkingDir.replace(/\/+$/g, '')}/projects/${projectDirectory}`,
    };
  };

  const resolvePlannerSkillCatalog = async ({ user, projectId, plannerConfig }) => {
    const skills = await agentSkills.mergedAgentSkillsForUser(user);
    const bindings = await agentSkills.readProjectAgentSkillBindings(user, projectId, skills);
    return resolvePlannerVisibleSkills({ skills, bindings, plannerConfig });
  };

  const materializeGoosePlannerSkillCatalog = async ({ user, projectId, plannerConfig }) => {
    const workspace = projectGooseWorkspace(projectId);
    const visibleSkills = await resolvePlannerSkillCatalog({ user, projectId, plannerConfig });
    const skillsRoot = join(workspace.hostPath, '.agents', 'skills');
    const catalogRoot = join(workspace.hostPath, '.aissistaint');

    rmSync(skillsRoot, { recursive: true, force: true });
    mkdirSync(skillsRoot, { recursive: true });
    mkdirSync(catalogRoot, { recursive: true });

    for (const skill of visibleSkills) {
      const skillDirectory = join(skillsRoot, plannerSkillDirectoryName(skill.id));
      mkdirSync(skillDirectory, { recursive: true });
      writeFileSync(join(skillDirectory, 'SKILL.md'), renderPlannerSkillMarkdown(skill), 'utf8');
    }

    writeFileSync(
      join(catalogRoot, 'skill-catalog.json'),
      `${JSON.stringify(renderPlannerSkillCatalog({ projectId, plannerConfig, skills: visibleSkills }), null, 2)}\n`,
      'utf8',
    );

    logAuditEvent({
      event: 'planner_skill_catalog.materialize',
      actor: actorFromPayload(user),
      action: 'materialize',
      resourceType: 'planner_skill_catalog',
      resourceId: projectId,
      outcome: 'success',
      metadata: {
        skillCount: visibleSkills.length,
        visibility: plannerConfig?.skillPolicy?.visibility ?? 'project-enabled',
      },
    });

    return { workspace, visibleSkills };
  };

  const plannerSystemPromptFromSpec = (spec) => {
    const systemFile =
      spec?.files?.find((file) => file.path === 'system.md') ??
      spec?.files?.find((file) => file.path?.endsWith('/system.md'));
    return String(systemFile?.content ?? '').trim();
  };

  const loadProjectPlannerContext = async (user, projectId) => {
    const catalog = loadPlannerRepositories();
    const merged = await readMergedPlannerConfig(user, projectId, catalog.specs);
    if (!merged.config || !merged.spec) {
      throw Object.assign(new Error('No planner spec is available.'), { status: 400 });
    }
    const materialized = await materializeGoosePlannerSkillCatalog({
      user,
      projectId,
      plannerConfig: merged.config,
    });
    return {
      ...merged,
      ...materialized,
      systemPrompt: plannerSystemPromptFromSpec(merged.spec),
    };
  };

  return {
    loadPlannerRepositories,
    defaultPlannerConfigFromSpec,
    mergePlannerConfig,
    normalizePlannerConfig,
    readPlannerConfigRecord,
    readMergedPlannerConfig,
    safeProjectWorkspaceName,
    projectGooseWorkspace,
    resolvePlannerSkillCatalog,
    materializeGoosePlannerSkillCatalog,
    plannerSystemPromptFromSpec,
    loadProjectPlannerContext,
  };
};
