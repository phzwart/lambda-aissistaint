import type { ManagedFile } from './domain';

export type FileProcessJobStatus = 'running' | 'completed' | 'failed';

export type FileLogStatus = 'pending' | 'running' | 'completed' | 'failed' | 'idle';

export interface FileProcessLogEntry {
  fileId: string;
  fileName: string;
  status: FileLogStatus;
  lines: string[];
  updatedAt: number;
}

export interface FileProcessJobFileLog {
  fileId: string;
  fileName: string;
  status: FileLogStatus;
  lines: string[];
  updatedAt: number;
}

export interface FileProcessJob {
  id: string;
  projectId: string;
  status: FileProcessJobStatus;
  lines: string[];
  fileLogs: FileProcessJobFileLog[];
  currentFileId: string | null;
  currentFileName: string | null;
  files: ManagedFile[];
  failures: Array<{ fileId: string; name: string; error: string }>;
  wikiPages: Array<{ fileId: string; pageKey: string; title: string }>;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}
