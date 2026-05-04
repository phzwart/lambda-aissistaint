import type { LlmConfig } from '../types/domain';
import { appConfig } from '../config/env';
import { apiRequest } from './apiClient';
import { mockDelay } from './mockDelay';

const storageKey = 'aissistaint.llmConfigs';

const getSecretName = (config: LlmConfig, index: number) =>
  config.secretName ?? `secret/data/aissistaint/llm/${config.tier}/endpoint-${index + 1}`;

const withSecretMetadata = (config: LlmConfig, index: number): LlmConfig => {
  const now = new Date().toISOString();
  const hasToken = Boolean(config.token.trim());

  if (!hasToken && !config.secretName) {
    return {
      ...config,
      secretLeaseStatus: 'none',
    };
  }

  return {
    ...config,
    token: hasToken ? config.token : config.token,
    secretName: getSecretName(config, index),
    secretVersion: hasToken ? (config.secretVersion ?? 0) + 1 : config.secretVersion ?? 1,
    secretCreatedAt: config.secretCreatedAt ?? now,
    secretUpdatedAt: hasToken ? now : config.secretUpdatedAt ?? now,
    secretLeaseStatus: hasToken ? 'stored' : config.secretLeaseStatus ?? 'stored',
  };
};

const useApi = () => !appConfig.useMockServices;

const hasProviderKey = (config: LlmConfig) => Boolean(config.token.trim() || config.tokenStored);

const validateRunnableConfig = (config: LlmConfig) => {
  if (!config.endpoint.trim()) {
    return `${config.name} needs a provider base URL before it can be tested.`;
  }

  if (!config.model.trim()) {
    return `${config.name} needs a provider model before it can be tested.`;
  }

  if (!hasProviderKey(config)) {
    return `${config.name} needs a provider API key before it can be tested.`;
  }

  return '';
};

export const llmConfigService = {
  async list(): Promise<LlmConfig[]> {
    if (useApi()) {
      const body = await apiRequest<{ configs: LlmConfig[] }>('/api/llm-config');
      return body.configs;
    }

    await mockDelay(150);

    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      return JSON.parse(stored) as LlmConfig[];
    }

    return [
      {
        id: crypto.randomUUID(),
        name: 'Local Research LLM',
        endpoint: 'https://api.cborg.lbl.gov',
        model: '',
        token: '',
        tier: 'a',
        status: 'idle',
      },
    ];
  },

  async save(configs: LlmConfig[]): Promise<LlmConfig[]> {
    if (useApi()) {
      const body = await apiRequest<{ configs: LlmConfig[] }>('/api/llm-config', {
        method: 'POST',
        body: JSON.stringify({ configs }),
      });
      return body.configs;
    }

    await mockDelay();
    const savedConfigs = configs.map(withSecretMetadata);
    window.localStorage.setItem(storageKey, JSON.stringify(savedConfigs));
    return savedConfigs;
  },

  async retrieveConfiguration(): Promise<LlmConfig[]> {
    if (useApi()) {
      const body = await apiRequest<{ configs: LlmConfig[] }>('/api/llm-config');
      return body.configs;
    }

    await mockDelay(600);

    const stored = window.localStorage.getItem(storageKey);
    const configs = stored ? (JSON.parse(stored) as LlmConfig[]) : await this.list();
    const retrievedAt = new Date().toISOString();

    return configs.map((config, index) => ({
      ...config,
      secretName: getSecretName(config, index),
      secretVersion: config.secretVersion ?? 1,
      secretCreatedAt: config.secretCreatedAt ?? retrievedAt,
      secretUpdatedAt: config.secretUpdatedAt ?? config.secretCreatedAt ?? retrievedAt,
      secretLastRetrievedAt: retrievedAt,
      secretLeaseStatus: config.secretName || config.token.trim() ? 'retrieved' : 'none',
    }));
  },

  async clearSecrets(): Promise<void> {
    if (useApi()) {
      await apiRequest<void>('/api/llm-config/secrets', { method: 'DELETE' });
      return;
    }

    await mockDelay(250);
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) {
      return;
    }

    const sanitized = (JSON.parse(stored) as LlmConfig[]).map((config) => ({
      ...config,
      token: '',
      status: 'idle' as const,
      message: undefined,
      secretLeaseStatus: 'cleared' as const,
    }));

    window.localStorage.setItem(storageKey, JSON.stringify(sanitized));
  },

  async testConnection(config: LlmConfig): Promise<Pick<LlmConfig, 'status' | 'message' | 'lastTestedAt'>> {
    const validationMessage = validateRunnableConfig(config);
    if (validationMessage) {
      return {
        status: 'error',
        message: validationMessage,
        lastTestedAt: new Date().toISOString(),
      };
    }

    if (useApi()) {
      return apiRequest<Pick<LlmConfig, 'status' | 'message' | 'lastTestedAt'>>('/api/llm-config/test', {
        method: 'POST',
        body: JSON.stringify({ config }),
      });
    }

    await mockDelay(700);

    if (!config.endpoint.startsWith('http')) {
      return {
        status: 'error',
        message: 'Base URL must start with http:// or https://',
        lastTestedAt: new Date().toISOString(),
      };
    }

    if (!config.model.trim()) {
      return {
        status: 'error',
        message: 'Model is required before testing this endpoint.',
        lastTestedAt: new Date().toISOString(),
      };
    }

    return {
      status: config.token.trim() ? 'success' : 'error',
      message: config.token.trim()
        ? 'Mock connection succeeded. Ready to route through backend/LiteLLM.'
        : 'Provider API key is required before testing this LiteLLM model.',
      lastTestedAt: new Date().toISOString(),
    };
  },

  async askTestQuestion(config: LlmConfig, question: string): Promise<string> {
    const validationMessage = validateRunnableConfig(config);
    if (validationMessage) {
      throw new Error(validationMessage);
    }

    if (useApi()) {
      const body = await apiRequest<{ answer: string }>('/api/llm-config/chat', {
        method: 'POST',
        body: JSON.stringify({ config, question }),
      });
      return body.answer;
    }

    await mockDelay(750);

    if (!config.endpoint.startsWith('http')) {
      throw new Error('Choose an LLM base URL before testing chat.');
    }

    if (!config.model.trim()) {
      throw new Error('Choose a model before testing chat.');
    }

    if (!config.token.trim()) {
      throw new Error('Add a provider API key before sending a test question.');
    }

    const modelName = config.name.trim() || `${config.tier.toUpperCase()} tier LLM`;

    return `Mock ${modelName} response: I received "${question}". When the backend is connected, this test chat will call LiteLLM through the secure API flow.`;
  },
};
