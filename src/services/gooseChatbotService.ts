import type { GooseChatMessage, GooseChatResponse, LlmTier } from '../types/domain';
import { appConfig } from '../config/env';
import { apiRequest } from './apiClient';
import { mockDelay } from './mockDelay';

export interface SendGooseChatOptions {
  tier?: LlmTier;
  systemPrompt?: string;
}

const storageKey = 'aissistaint.gooseChatMessages';

const createAssistantMessage = (content: string): GooseChatMessage => ({
  id: crypto.randomUUID(),
  role: 'assistant',
  content,
  createdAt: new Date().toISOString(),
});

const useApi = () => !appConfig.useMockServices;

export const gooseChatbotService = {
  loadHistory(): GooseChatMessage[] {
    if (useApi()) {
      return [];
    }

    const stored = window.localStorage.getItem(storageKey);
    return stored ? (JSON.parse(stored) as GooseChatMessage[]) : [];
  },

  saveHistory(messages: GooseChatMessage[]): void {
    if (useApi()) {
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(messages.slice(-24)));
  },

  async send(messages: GooseChatMessage[], options: SendGooseChatOptions = {}): Promise<GooseChatResponse> {
    const payloadMessages = messages.map(({ role, content }) => ({ role, content }));

    if (useApi()) {
      return apiRequest<GooseChatResponse>('/api/goose/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: payloadMessages,
          tier: options.tier,
          systemPrompt: options.systemPrompt,
        }),
      });
    }

    await mockDelay(700);
    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    return {
      message: createAssistantMessage(
        `Mock Goose response: I received "${latestUserMessage?.content ?? 'your message'}". In real-service mode this headless chatbot calls the backend, which routes through LiteLLM using the configured LLM_${(options.tier ?? 'a').toUpperCase()} endpoint.`,
      ),
      modelAlias: 'mock-goose-chatbot',
      tier: options.tier ?? 'a',
    };
  },
};
