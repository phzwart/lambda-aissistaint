export const paperqaLitellmTimeoutSeconds = () =>
  Number.parseInt(process.env.PAPERQA_LITELLM_TIMEOUT_S ?? '600', 10) || 600;

/**
 * Build the LiteLLM runtime payload passed into the PaperQA2 container.
 * Uses the same deployment aliases (LLM_A/B/C) as Preferences, not provider model names.
 */
export const buildPaperqaLitellmRuntime = ({ llmConfig, modelAlias, litellmUrl, tier }) => ({
  modelAlias,
  litellmUrl: String(litellmUrl ?? '').replace(/\/$/, ''),
  tier: tier ?? 'a',
  requestTimeoutSeconds: paperqaLitellmTimeoutSeconds(),
  // Metadata only — PaperQA must not call the provider endpoint directly.
  providerModel: llmConfig?.model ?? '',
  providerEndpoint: llmConfig?.endpoint ?? '',
  configuredName: llmConfig?.name ?? modelAlias,
});
