import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FileProcessLogEntry } from '../types/fileProcess';

interface FileProcessState {
  /** projectId → fileId → log entry */
  logsByProject: Record<string, Record<string, FileProcessLogEntry>>;
  selectedLogFileId: string | null;
  activeJob: { projectId: string; jobId: string } | null;
  setSelectedLogFileId: (fileId: string | null) => void;
  setActiveJob: (job: { projectId: string; jobId: string } | null) => void;
  upsertFileLog: (projectId: string, entry: FileProcessLogEntry) => void;
  mergeFileLogsFromJob: (
    projectId: string,
    fileLogs: Array<{
      fileId: string;
      fileName: string;
      status: FileProcessLogEntry['status'];
      lines: string[];
      updatedAt: number;
    }>,
  ) => void;
  getFileLog: (projectId: string, fileId: string) => FileProcessLogEntry | undefined;
  clearProjectLogs: (projectId: string) => void;
}

export const useFileProcessStore = create<FileProcessState>()(
  persist(
    (set, get) => ({
      logsByProject: {},
      selectedLogFileId: null,
      activeJob: null,

      setSelectedLogFileId: (fileId) => set({ selectedLogFileId: fileId }),

      setActiveJob: (job) => set({ activeJob: job }),

      upsertFileLog: (projectId, entry) =>
        set((state) => ({
          logsByProject: {
            ...state.logsByProject,
            [projectId]: {
              ...(state.logsByProject[projectId] ?? {}),
              [entry.fileId]: entry,
            },
          },
        })),

      mergeFileLogsFromJob: (projectId, fileLogs) =>
        set((state) => {
          const projectLogs = { ...(state.logsByProject[projectId] ?? {}) };
          for (const fileLog of fileLogs) {
            projectLogs[fileLog.fileId] = {
              fileId: fileLog.fileId,
              fileName: fileLog.fileName,
              status: fileLog.status,
              lines: fileLog.lines,
              updatedAt: fileLog.updatedAt,
            };
          }
          return {
            logsByProject: {
              ...state.logsByProject,
              [projectId]: projectLogs,
            },
          };
        }),

      getFileLog: (projectId, fileId) => get().logsByProject[projectId]?.[fileId],

      clearProjectLogs: (projectId) =>
        set((state) => {
          const next = { ...state.logsByProject };
          delete next[projectId];
          return { logsByProject: next };
        }),
    }),
    {
      name: 'aissistaint-file-process-logs',
      partialize: (state) => ({
        logsByProject: state.logsByProject,
        selectedLogFileId: state.selectedLogFileId,
        activeJob: state.activeJob,
      }),
    },
  ),
);
