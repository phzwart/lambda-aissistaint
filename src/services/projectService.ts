import { appConfig } from '../config/env';
import type { Project } from '../types/domain';
import { apiRequest } from './apiClient';
import { mockDelay } from './mockDelay';

const storageKey = 'aissistaint.projects';

const useApi = () => !appConfig.useMockServices;

const readMockProjects = (): Project[] => {
  const stored = window.localStorage.getItem(storageKey);
  if (!stored) {
    return [];
  }

  return JSON.parse(stored) as Project[];
};

const writeMockProjects = (projects: Project[]) => {
  window.localStorage.setItem(storageKey, JSON.stringify(projects));
};

export const projectService = {
  async list(): Promise<Project[]> {
    if (useApi()) {
      const body = await apiRequest<{ projects: Project[] }>('/api/projects');
      return body.projects;
    }

    await mockDelay(150);
    return readMockProjects();
  },

  async create(input: Pick<Project, 'name' | 'description'>): Promise<Project> {
    if (useApi()) {
      const body = await apiRequest<{ project: Project }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return body.project;
    }

    await mockDelay(250);
    const now = new Date().toISOString();
    const project: Project = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description,
      status: 'active',
      bucketName: `mock-project-${crypto.randomUUID().slice(0, 8)}`,
      loadedPrefix: 'loaded',
      parsedPrefix: 'parsed',
      metadataObjectKey: 'project.json',
      createdBy: 'mock-user',
      createdAt: now,
      updatedAt: now,
    };
    const projects = [project, ...readMockProjects()];
    writeMockProjects(projects);
    return project;
  },

  async update(id: string, input: Partial<Pick<Project, 'name' | 'description' | 'status'>>): Promise<Project> {
    if (useApi()) {
      const body = await apiRequest<{ project: Project }>(`/api/projects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      });
      return body.project;
    }

    await mockDelay(200);
    const projects = readMockProjects();
    const updatedProjects = projects.map((project) =>
      project.id === id
        ? {
            ...project,
            ...input,
            updatedAt: new Date().toISOString(),
          }
        : project,
    );
    writeMockProjects(updatedProjects);
    const project = updatedProjects.find((item) => item.id === id);
    if (!project) {
      throw new Error('Project not found.');
    }
    return project;
  },

  async delete(id: string): Promise<void> {
    if (useApi()) {
      await apiRequest<void>(`/api/projects/${id}`, {
        method: 'DELETE',
      });
      return;
    }

    await mockDelay(150);
    writeMockProjects(readMockProjects().filter((project) => project.id !== id));
  },
};
