import { create } from 'zustand';
import type { ManagedFile, QaAnswer } from '../types/domain';

interface WorkflowState {
  files: ManagedFile[];
  latestAnswer: QaAnswer | null;
  setFiles: (files: ManagedFile[]) => void;
  addFiles: (files: ManagedFile[]) => void;
  setLatestAnswer: (answer: QaAnswer | null) => void;
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  files: [],
  latestAnswer: null,

  setFiles: (files) => set({ files }),
  addFiles: (files) => set((state) => ({ files: [...files, ...state.files] })),
  setLatestAnswer: (latestAnswer) => set({ latestAnswer }),
}));
