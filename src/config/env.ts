import type { LlmTier } from '../types/domain';

const parseLlmTiers = (): LlmTier[] => {
  const raw: string = import.meta.env.VITE_LLM_TIERS ?? 'A,B,C';
  const tiers = raw
    .split(',')
    .map((tier) => tier.trim().toLowerCase())
    .filter((tier): tier is LlmTier => tier === 'a' || tier === 'b' || tier === 'c');

  return tiers.length > 0 ? tiers : ['a', 'b', 'c'];
};

const llmTiers = parseLlmTiers();

export const appConfig = {
  appTitle: import.meta.env.VITE_APP_TITLE ?? 'AIssistAInt',
  appSubtitle: import.meta.env.VITE_APP_SUBTITLE ?? 'Knowledge & Question Processor',
  preferencesSubtitle:
    import.meta.env.VITE_PREFERENCES_SUBTITLE ??
    'Configure LiteLLM provider models for LLM_A, LLM_B, and LLM_C. Provider keys are write-only and stored through OpenBao.',
  keycloakUrl: import.meta.env.VITE_KEYCLOAK_URL ?? '',
  keycloakRealm: import.meta.env.VITE_KEYCLOAK_REALM ?? '',
  keycloakClientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? '',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  openBaoUrl: import.meta.env.VITE_OPENBAO_URL ?? '',
  llmTiers,
  llmEndpointCount: llmTiers.length,
  useMockServices: import.meta.env.VITE_USE_MOCK_SERVICES !== 'false',
};
