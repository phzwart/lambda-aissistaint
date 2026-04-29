import { create } from 'zustand';
import type { ManagedFile, Project, QaAnswer } from '../types/domain';

interface WorkflowState {
  files: ManagedFile[];
  projects: Project[];
  activeProjectId: string;
  activeProject: Project | null;
  latestAnswer: QaAnswer | null;
  setFiles: (files: ManagedFile[]) => void;
  addFiles: (files: ManagedFile[]) => void;
  setProjects: (projects: Project[]) => void;
  setActiveProjectId: (projectId: string) => void;
  setLatestAnswer: (answer: QaAnswer | null) => void;
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  files: [],
  projects: [],
  activeProjectId: '',
  activeProject: null,
  latestAnswer: null,

  setFiles: (files) => set({ files }),
  addFiles: (files) => set((state) => ({ files: [...files, ...state.files] })),
  setProjects: (projects) =>
    set((state) => {
      const activeProject =
        projects.find((project) => project.id === state.activeProjectId) ?? projects[0] ?? null;

      return {
        projects,
        activeProject,
        activeProjectId: activeProject?.id ?? '',
      };
    }),
  setActiveProjectId: (activeProjectId) =>
    set((state) => ({
      activeProjectId,
      activeProject: state.projects.find((project) => project.id === activeProjectId) ?? null,
    })),
  setLatestAnswer: (latestAnswer) => set({ latestAnswer }),
}));
