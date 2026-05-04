import { appConfig } from '../config/env';
import type { AgentExecutorCatalogItem, AgentSkill, ProjectAgentSkillBinding } from '../types/domain';
import { apiRequest } from './apiClient';
import { mockDelay } from './mockDelay';

const skillStorageKey = 'aissistaint.agentSkills';
const bindingStorageKey = 'aissistaint.projectAgentSkillBindings';

const useApi = () => !appConfig.useMockServices;

const readMockSkills = (): AgentSkill[] => {
  const stored = window.localStorage.getItem(skillStorageKey);
  return stored ? (JSON.parse(stored) as AgentSkill[]) : [];
};

const writeMockSkills = (skills: AgentSkill[]) => {
  window.localStorage.setItem(skillStorageKey, JSON.stringify(skills));
};

const readMockBindings = (): Record<string, ProjectAgentSkillBinding[]> => {
  const stored = window.localStorage.getItem(bindingStorageKey);
  return stored ? (JSON.parse(stored) as Record<string, ProjectAgentSkillBinding[]>) : {};
};

const writeMockBindings = (bindings: Record<string, ProjectAgentSkillBinding[]>) => {
  window.localStorage.setItem(bindingStorageKey, JSON.stringify(bindings));
};

export const defaultAgentSkillExecutable = () => ({
  mode: 'none' as const,
  args: [],
  timeoutSeconds: 120,
  network: 'none' as const,
  envAllowlist: [],
});

export const defaultAgentSkillPackage = () => ({
  directoryName: 'untitled-skill',
  skillMd: '',
  files: [],
});

export const createEmptyAgentSkill = (): AgentSkill => {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: '',
    category: 'General',
    status: 'draft',
    purpose: '',
    whenToUse: '',
    inputs: [],
    procedure: '',
    expectedOutput: '',
    safetyConstraints: '',
    requiredTools: [],
    executable: defaultAgentSkillExecutable(),
    skillPackage: defaultAgentSkillPackage(),
    createdAt: now,
    updatedAt: now,
  };
};

const mockExecutors: AgentExecutorCatalogItem[] = [
  {
    id: 'python-sandbox',
    name: 'Python Sandbox',
    description: 'Runs short Python helpers in a constrained workspace container.',
    image: 'ghcr.io/aissistaint/python-sandbox:latest',
    command: 'python',
    args: ['-m', 'aissistaint_skill_runner'],
    workingDir: '/workspace',
    timeoutSeconds: 120,
    network: 'none',
    envAllowlist: [],
  },
];

export const agentSkillService = {
  async list(projectId?: string): Promise<{ skills: AgentSkill[]; bindings: ProjectAgentSkillBinding[] }> {
    if (useApi()) {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
      return apiRequest<{ skills: AgentSkill[]; bindings: ProjectAgentSkillBinding[] }>(`/api/agent-skills${query}`);
    }

    await mockDelay(150);
    return {
      skills: readMockSkills(),
      bindings: projectId ? readMockBindings()[projectId] ?? [] : [],
    };
  },

  async save(skill: AgentSkill): Promise<AgentSkill> {
    if (useApi()) {
      const body = await apiRequest<{ skill: AgentSkill }>('/api/agent-skills', {
        method: 'POST',
        body: JSON.stringify({ skill }),
      });
      return body.skill;
    }

    await mockDelay(200);
    const now = new Date().toISOString();
    const saved = {
      ...skill,
      updatedAt: now,
      createdAt: skill.createdAt || now,
    };
    const current = readMockSkills();
    const next = current.some((item) => item.id === saved.id)
      ? current.map((item) => (item.id === saved.id ? saved : item))
      : [saved, ...current];
    writeMockSkills(next);
    return saved;
  },

  async delete(id: string): Promise<void> {
    if (useApi()) {
      await apiRequest<void>(`/api/agent-skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return;
    }

    await mockDelay(150);
    writeMockSkills(readMockSkills().filter((skill) => skill.id !== id));
    const bindings = readMockBindings();
    for (const projectId of Object.keys(bindings)) {
      bindings[projectId] = bindings[projectId].filter((binding) => binding.skillId !== id);
    }
    writeMockBindings(bindings);
  },

  async listExecutors(): Promise<AgentExecutorCatalogItem[]> {
    if (useApi()) {
      const body = await apiRequest<{ executors: AgentExecutorCatalogItem[] }>('/api/agent-executors');
      return body.executors;
    }

    await mockDelay(100);
    return mockExecutors;
  },

  async saveProjectBindings(projectId: string, bindings: ProjectAgentSkillBinding[]): Promise<ProjectAgentSkillBinding[]> {
    if (useApi()) {
      const body = await apiRequest<{ bindings: ProjectAgentSkillBinding[] }>(`/api/projects/${encodeURIComponent(projectId)}/agent-skills`, {
        method: 'PUT',
        body: JSON.stringify({ bindings }),
      });
      return body.bindings;
    }

    await mockDelay(150);
    const allBindings = readMockBindings();
    allBindings[projectId] = bindings;
    writeMockBindings(allBindings);
    return bindings;
  },
};
