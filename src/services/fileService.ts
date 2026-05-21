import { appConfig } from '../config/env';
import type { ManagedFile } from '../types/domain';
import type { FileProcessJob } from '../types/fileProcess';
import type { ParsedArtifactContent, ParsedArtifactListing } from '../types/parsedArtifact';
import { apiRequest } from './apiClient';
import { authService } from './authService';
import { mockDelay } from './mockDelay';

const apiBaseUrl = appConfig.apiBaseUrl.replace(/\/$/, '');
const useApi = () => !appConfig.useMockServices;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const uploadWithAuth = async (projectId: string, files: FileList): Promise<ManagedFile[]> => {
  const token = await authService.getToken();
  if (!token) {
    throw new Error('You must be logged in before uploading files.');
  }

  const form = new FormData();
  for (const file of Array.from(files)) {
    form.append('files', file);
  }

  const response = await fetch(`${apiBaseUrl || ''}/api/projects/${encodeURIComponent(projectId)}/files`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  const text = await response.text();
  let body: { files?: ManagedFile[]; error?: string } = {};
  if (text) {
    body = JSON.parse(text) as { files?: ManagedFile[]; error?: string };
  }

  if (!response.ok) {
    throw new Error(body.error ?? `Upload failed with ${response.status}`);
  }

  return body.files ?? [];
};

export const fileService = {
  async list(projectId: string): Promise<ManagedFile[]> {
    if (useApi()) {
      const body = await apiRequest<{ files: ManagedFile[] }>(`/api/projects/${encodeURIComponent(projectId)}/files`);
      return body.files;
    }

    await mockDelay(150);
    return [];
  },

  async upload(projectId: string, files: FileList): Promise<ManagedFile[]> {
    if (useApi()) {
      return uploadWithAuth(projectId, files);
    }

    await mockDelay();
    return Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      status: 'uploaded',
    }));
  },

  async getProcessJob(projectId: string, jobId: string): Promise<FileProcessJob> {
    const body = await apiRequest<{ job: FileProcessJob }>(
      `/api/projects/${encodeURIComponent(projectId)}/files/process/jobs/${encodeURIComponent(jobId)}`,
    );
    return body.job;
  },

  async listParsedArtifacts(projectId: string, fileId: string): Promise<ParsedArtifactListing> {
    if (useApi()) {
      return apiRequest<ParsedArtifactListing>(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/parsed-artifacts`,
      );
    }

    await mockDelay(120);
    return {
      fileId,
      fileName: 'mock-paper.pdf',
      stem: 'mock-stem',
      parsedPrefix: 'parsed',
      prefix: 'parsed/mock-stem/',
      artifacts: [
        {
          name: 'abstract.txt',
          kind: 'text',
          objectKey: 'parsed/mock-stem/abstract.txt',
          size: 120,
          lastModified: new Date().toISOString(),
          contentType: 'text/plain; charset=utf-8',
        },
        {
          name: 'summary.md',
          kind: 'markdown',
          objectKey: 'parsed/mock-stem/summary.md',
          size: 400,
          lastModified: new Date().toISOString(),
          contentType: 'text/markdown; charset=utf-8',
        },
      ],
    };
  },

  async downloadParsedArtifactsZip(projectId: string, fileId: string, fileName: string): Promise<void> {
    const token = await authService.getToken();
    if (!token) {
      throw new Error('You must be logged in before downloading artifacts.');
    }

    const response = await fetch(
      `${apiBaseUrl}/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/parsed-artifacts.zip`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    if (!response.ok) {
      const text = await response.text();
      let message = `Download failed with ${response.status}`;
      if (text) {
        try {
          const body = JSON.parse(text) as { error?: string };
          message = body.error ?? message;
        } catch {
          message = text.slice(0, 200);
        }
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const match = /filename="?([^";\n]+)"?/i.exec(disposition);
    const downloadName =
      match?.[1]?.trim() ??
      `${fileName.replace(/\.pdf$/i, '') || 'processed-output'}-artifacts.zip`;

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = downloadName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },

  async getParsedArtifact(
    projectId: string,
    fileId: string,
    artifactName: string,
  ): Promise<ParsedArtifactContent> {
    if (useApi()) {
      return apiRequest<ParsedArtifactContent>(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/parsed-artifacts/${encodeURIComponent(artifactName)}`,
      );
    }

    await mockDelay(80);
    if (artifactName.endsWith('.md')) {
      return {
        fileId,
        fileName: 'mock-paper.pdf',
        name: artifactName,
        kind: 'markdown',
        objectKey: `parsed/mock-stem/${artifactName}`,
        contentType: 'text/markdown; charset=utf-8',
        content: '# Mock summary\n\nProcessed output preview.',
      };
    }
    return {
      fileId,
      fileName: 'mock-paper.pdf',
      name: artifactName,
      kind: 'text',
      objectKey: `parsed/mock-stem/${artifactName}`,
      contentType: 'text/plain; charset=utf-8',
      content: 'Mock plain-text artifact.',
    };
  },

  async getStoredProcessLog(
    projectId: string,
    fileId: string,
  ): Promise<{ log: string; source: string; objectKey?: string } | { error: string }> {
    try {
      const body = await apiRequest<{ log: string; source?: string; objectKey?: string }>(
        `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/process-log`,
      );
      return { log: body.log, source: body.source ?? 'minio', objectKey: body.objectKey };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Failed to load process log.',
      };
    }
  },

  async startProcess(projectId: string, fileIds: string[]): Promise<{ jobId: string }> {
    const body = await apiRequest<{ jobId: string; status: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/files/process`,
      {
        method: 'POST',
        body: JSON.stringify({ fileIds }),
      },
    );
    return { jobId: body.jobId };
  },

  async process(
    projectId: string,
    files: ManagedFile[],
    callbacks?: {
      onJobStarted?: (jobId: string) => void;
      onJobUpdate?: (job: FileProcessJob) => void;
    },
  ): Promise<ManagedFile[]> {
    if (useApi()) {
      const start = await this.startProcess(
        projectId,
        files.map((file) => file.id),
      );
      callbacks?.onJobStarted?.(start.jobId);

      let job = await this.getProcessJob(projectId, start.jobId);
      callbacks?.onJobUpdate?.(job);

      while (job.status === 'running') {
        await sleep(1500);
        job = await this.getProcessJob(projectId, start.jobId);
        callbacks?.onJobUpdate?.(job);
      }

      if (job.status === 'failed' && job.error && !job.files.some((file) => file.status === 'completed')) {
        throw new Error(job.error);
      }

      if (job.failures?.length && !job.files.some((file) => file.status === 'completed')) {
        throw new Error(job.failures.map((failure) => `${failure.name}: ${failure.error}`).join(' '));
      }

      return job.files;
    }

    await mockDelay(900);
    const mockJob: FileProcessJob = {
      id: 'mock',
      projectId,
      status: 'completed',
      lines: ['[mock] Processing complete.'],
      fileLogs: files.map((file) => ({
        fileId: file.id,
        fileName: file.name,
        status: 'completed',
        lines: ['[mock] done'],
        updatedAt: Date.now(),
      })),
      currentFileId: null,
      currentFileName: null,
      files: files.map((file) => ({ ...file, status: 'completed' })),
      failures: [],
      wikiPages: [],
      error: null,
      startedAt: Date.now(),
      finishedAt: Date.now(),
    };
    callbacks?.onJobUpdate?.(mockJob);
    return mockJob.files;
  },
};
