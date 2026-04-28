import type { KnowledgeDocument } from '../types/domain';
import { mockDelay } from './mockDelay';

const documents: KnowledgeDocument[] = [
  {
    id: 'kb-001',
    title: 'Catalyst Screening Summary',
    summary:
      'Summarizes experimental conditions and highlights promising catalyst families from uploaded PDFs.',
    linkedDocumentIds: ['kb-002'],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'kb-002',
    title: 'Spectroscopy Notes',
    summary:
      'Extracted cross-document references connecting spectra interpretation with synthesis conditions.',
    linkedDocumentIds: ['kb-001'],
    updatedAt: new Date().toISOString(),
  },
];

export const knowledgeService = {
  async list(): Promise<KnowledgeDocument[]> {
    await mockDelay(250);
    return documents;
  },
};
