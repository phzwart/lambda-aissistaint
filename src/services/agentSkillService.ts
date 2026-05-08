import { appConfig } from '../config/env';
import type { AgentExecutorCatalogItem, AgentRepository, AgentSkill, ProjectAgentSkillBinding } from '../types/domain';
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
    description: '',
    category: 'General',
    status: 'draft',
    source: 'user',
    editable: true,
    capabilities: [],
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

const mockRepositories: AgentRepository[] = [
  {
    name: 'AIssistAInt Agent Repository',
    version: '0.1.0',
    description: 'Package-provided agent skill templates and future predefined skills for AIssistAInt.',
    directory: 'agent-repo',
    skillsPath: 'skills',
    templatesPath: 'templates',
    skillCount: 1,
  },
];

const createMockRepositorySkills = (): AgentSkill[] => [
  {
    id: 'package-repository-sample',
    name: 'Repository Sample Skill',
    description: 'A read-only sample that demonstrates repository-loaded skills in mock mode.',
    category: 'General',
    status: 'enabled',
    source: 'package',
    editable: false,
    origin: {
      repoName: 'AIssistAInt Agent Repository',
      directory: 'agent-repo/skills/repository-sample',
      version: '0.1.0',
    },
    capabilities: ['sample', 'repository'],
    purpose: 'Demonstrate a read-only repository skill in mock mode.',
    whenToUse: 'Use when verifying that repository skills appear alongside user-created skills.',
    inputs: [],
    procedure: 'Review this sample as a repository skill. Duplicate it to customize the instructions.',
    expectedOutput: 'A duplicated editable user skill when customization is needed.',
    safetyConstraints: 'Do not store secrets in repository skill files.',
    requiredTools: [],
    executable: defaultAgentSkillExecutable(),
    skillPackage: {
      directoryName: 'repository-sample',
      skillMd: `---
name: repository-sample
description: "A read-only sample that demonstrates repository-loaded skills in mock mode."
disable-model-invocation: true
---

# Repository Sample Skill

## Purpose

Demonstrate a read-only repository skill in mock mode.
`,
      files: [],
    },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
];

export const agentSkillService = {
  async list(projectId?: string): Promise<{ skills: AgentSkill[]; bindings: ProjectAgentSkillBinding[] }> {
    if (useApi()) {
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
      return apiRequest<{ skills: AgentSkill[]; bindings: ProjectAgentSkillBinding[] }>(`/api/agent-skills${query}`);
    }

    await mockDelay(150);
    const repositorySkills = createMockRepositorySkills();
    const userSkills = readMockSkills().map((skill) => ({
      capabilities: [],
      description: '',
      ...skill,
      source: 'user' as const,
      editable: true,
    }));
    return {
      skills: [...repositorySkills, ...userSkills],
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
      source: 'user' as const,
      editable: true,
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

  async listRepositories(): Promise<{ repos: AgentRepository[]; warnings: { directory: string; message: string }[] }> {
    if (useApi()) {
      return apiRequest<{ repos: AgentRepository[]; warnings: { directory: string; message: string }[] }>('/api/agent-repos');
    }

    await mockDelay(100);
    return { repos: mockRepositories, warnings: [] };
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
