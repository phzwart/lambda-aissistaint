import { appConfig } from '../config/env';
import type { PlannerConfig, PlannerConfigResponse, PlannerModelAlias, PlannerSpec } from '../types/domain';
import { apiRequest } from './apiClient';
import { mockDelay } from './mockDelay';

const defaultStorageKey = 'aissistaint.planner.default';
const projectStorageKey = 'aissistaint.planner.projects';

const useApi = () => !appConfig.useMockServices;

const mockSpec: PlannerSpec = {
  id: 'goose-task-planner',
  name: 'Goose Task Planner',
  version: '0.1.0',
  description: 'Use Goose as the planning engine while binding planner roles to configured AIssistAInt LiteLLM aliases.',
  engine: 'goose',
  modelRoles: ['planner', 'worker', 'summarizer'],
  defaultContext: {
    strategy: 'summarize',
    maxTurns: 50,
    subagentMaxTurns: 25,
  },
  skillPolicy: {
    defaultVisibility: 'project-enabled',
    allowedSkillIds: [],
    allowedCategories: [],
  },
  workspacePolicy: {
    mode: 'project-workspace',
    readOnly: false,
    requiresProject: true,
  },
  runtime: {
    requiredEnv: ['INTERNAL_GOOSE_URL', 'GOOSE_SECRET_KEY'],
    restartRequiredKeys: ['GOOSE_PROVIDER', 'GOOSE_MODEL', 'GOOSE_PLANNER_PROVIDER', 'GOOSE_PLANNER_MODEL'],
  },
  responseSchema: {
    type: 'skill_execution_plan',
    version: '0.1.0',
  },
  configFiles: ['system.md'],
};

const mockModelAliases: PlannerModelAlias[] = [
  { alias: 'LLM_A', tier: 'a', configured: true },
  { alias: 'LLM_B', tier: 'b', configured: true },
  { alias: 'LLM_C', tier: 'c', configured: true },
];

const readDefault = (): PlannerConfig | null => {
  const stored = window.localStorage.getItem(defaultStorageKey);
  return stored ? (JSON.parse(stored) as PlannerConfig) : null;
};

const writeDefault = (config: PlannerConfig) => {
  window.localStorage.setItem(defaultStorageKey, JSON.stringify(config));
};

const readProjects = (): Record<string, PlannerConfig> => {
  const stored = window.localStorage.getItem(projectStorageKey);
  return stored ? (JSON.parse(stored) as Record<string, PlannerConfig>) : {};
};

const writeProject = (projectId: string, config: PlannerConfig) => {
  const projects = readProjects();
  projects[projectId] = config;
  window.localStorage.setItem(projectStorageKey, JSON.stringify(projects));
};

const defaultConfig = (spec = mockSpec): PlannerConfig => ({
  specId: spec.id,
  roleBindings: Object.fromEntries(spec.modelRoles.map((role) => [role, 'LLM_A'])),
  contextPolicy: { ...spec.defaultContext },
  skillPolicy: {
    visibility: spec.skillPolicy.defaultVisibility,
    allowedSkillIds: [...spec.skillPolicy.allowedSkillIds],
    allowedCategories: [...spec.skillPolicy.allowedCategories],
  },
  workspaceMode: 'project-workspace',
});

const mergeConfig = (globalConfig: PlannerConfig | null, projectConfig: PlannerConfig | null) => ({
  ...defaultConfig(),
  ...(globalConfig ?? {}),
  ...(projectConfig ?? {}),
  roleBindings: {
    ...defaultConfig().roleBindings,
    ...(globalConfig?.roleBindings ?? {}),
    ...(projectConfig?.roleBindings ?? {}),
  },
  contextPolicy: {
    ...defaultConfig().contextPolicy,
    ...(globalConfig?.contextPolicy ?? {}),
    ...(projectConfig?.contextPolicy ?? {}),
  },
  skillPolicy: {
    ...defaultConfig().skillPolicy,
    ...(globalConfig?.skillPolicy ?? {}),
    ...(projectConfig?.skillPolicy ?? {}),
  },
});

export const plannerConfigService = {
  async listSpecs(): Promise<{ specs: PlannerSpec[]; warnings: { directory: string; message: string }[] }> {
    if (useApi()) {
      return apiRequest<{ specs: PlannerSpec[]; warnings: { directory: string; message: string }[] }>('/api/planner-specs');
    }

    await mockDelay(100);
    return { specs: [mockSpec], warnings: [] };
  },

  async getConfig(projectId?: string): Promise<PlannerConfigResponse> {
    if (useApi()) {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
      return apiRequest<PlannerConfigResponse>(`/api/planner-config${query}`);
    }

    await mockDelay(100);
    const globalConfig = readDefault();
    const projectConfig = projectId ? readProjects()[projectId] ?? null : null;
    return {
      config: mergeConfig(globalConfig, projectConfig),
      globalConfig,
      projectConfig,
      spec: mockSpec,
      modelAliases: mockModelAliases,
      warnings: [],
    };
  },

  async saveDefault(config: PlannerConfig): Promise<PlannerConfig> {
    if (useApi()) {
      const body = await apiRequest<{ config: PlannerConfig }>('/api/planner-config/default', {
        method: 'PUT',
        body: JSON.stringify({ config }),
      });
      return body.config;
    }

    await mockDelay(150);
    const saved = { ...config, updatedAt: new Date().toISOString() };
    writeDefault(saved);
    return saved;
  },

  async saveProject(projectId: string, config: PlannerConfig): Promise<PlannerConfig> {
    if (useApi()) {
      const body = await apiRequest<{ config: PlannerConfig }>(`/api/projects/${encodeURIComponent(projectId)}/planner-config`, {
        method: 'PUT',
        body: JSON.stringify({ config }),
      });
      return body.config;
    }

    await mockDelay(150);
    const saved = { ...config, updatedAt: new Date().toISOString() };
    writeProject(projectId, saved);
    return saved;
  },

  async test(config: PlannerConfig): Promise<{ ok: boolean; adapter: { message: string; restartRequired: boolean; restartRequiredKeys: string[] } }> {
    if (useApi()) {
      return apiRequest<{ ok: boolean; adapter: { message: string; restartRequired: boolean; restartRequiredKeys: string[] } }>(
        '/api/planner-config/test',
        {
          method: 'POST',
          body: JSON.stringify({ config }),
        },
      );
    }

    await mockDelay(200);
    return {
      ok: true,
      adapter: {
        message: 'Mock Goose validation passed.',
        restartRequired: true,
        restartRequiredKeys: mockSpec.runtime.restartRequiredKeys,
      },
    };
  },
};
