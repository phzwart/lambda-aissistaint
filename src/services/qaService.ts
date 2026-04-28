import type { QaAnswer } from '../types/domain';
import { mockDelay } from './mockDelay';

export const qaService = {
  async ask(question: string): Promise<QaAnswer> {
    await mockDelay(650);

    return {
      id: crypto.randomUUID(),
      question,
      answer:
        'Mock answer: the backend agent will use processed documents, configured LLM tiers, and knowledge links to produce a grounded response.',
      createdAt: new Date().toISOString(),
    };
  },

  async saveToKnowledgeBase(answer: QaAnswer): Promise<void> {
    await mockDelay(300);
    console.info('Saved mock Q&A answer to knowledge base', answer);
  },
};
