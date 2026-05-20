import type {
  WikiBacklinksResponse,
  WikiIngestRequest,
  WikiIngestResponse,
  WikiPageDetail,
  WikiPageResponse,
  WikiPageSummary,
  WikiProcessedSource,
  WikiQueryResponse,
  WikiSyncProcessedResponse,
} from '../types/domain';
import { apiRequest } from './apiClient';

const projectBase = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/wiki`;
const pageBase = (projectId: string, category: string, slug: string) =>
  `${projectBase(projectId)}/pages/${encodeURIComponent(category)}/${encodeURIComponent(slug)}`;

export const wikiService = {
  async list(projectId: string): Promise<{ pages: WikiPageSummary[]; categories: string[] }> {
    return apiRequest(`${projectBase(projectId)}/pages`);
  },

  async get(projectId: string, category: string, slug: string): Promise<WikiPageResponse> {
    return apiRequest(pageBase(projectId, category, slug));
  },

  async upsert(
    projectId: string,
    category: string,
    slug: string,
    markdown: string,
  ): Promise<{ page: WikiPageDetail }> {
    return apiRequest(pageBase(projectId, category, slug), {
      method: 'PUT',
      body: JSON.stringify({ markdown }),
    });
  },

  async remove(projectId: string, category: string, slug: string): Promise<void> {
    await apiRequest<void>(pageBase(projectId, category, slug), { method: 'DELETE' });
  },

  async listSources(projectId: string): Promise<{ sources: WikiProcessedSource[]; autoIngestOnProcess: boolean }> {
    return apiRequest(`${projectBase(projectId)}/sources`);
  },

  async syncProcessed(projectId: string, fileIds?: string[]): Promise<WikiSyncProcessedResponse> {
    return apiRequest(`${projectBase(projectId)}/sync-processed`, {
      method: 'POST',
      body: JSON.stringify(fileIds?.length ? { fileIds } : {}),
    });
  },

  async ingestProcessedFile(projectId: string, fileId: string): Promise<WikiIngestResponse> {
    return apiRequest(`${projectBase(projectId)}/ingest/${encodeURIComponent(fileId)}`, {
      method: 'POST',
    });
  },

  async ingest(projectId: string, request: WikiIngestRequest): Promise<WikiIngestResponse> {
    return apiRequest(`${projectBase(projectId)}/ingest`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  async query(projectId: string, question: string, limit = 6): Promise<WikiQueryResponse> {
    return apiRequest(`${projectBase(projectId)}/query`, {
      method: 'POST',
      body: JSON.stringify({ question, limit }),
    });
  },

  async backlinks(projectId: string): Promise<WikiBacklinksResponse> {
    return apiRequest(`${projectBase(projectId)}/backlinks`);
  },
};
