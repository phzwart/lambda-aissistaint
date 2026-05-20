/** Per LiteLLM/PaperQA HTTP call (seconds). Default 15 minutes. */
export const paperqaLitellmTimeoutSeconds = () =>
  Number.parseInt(process.env.PAPERQA_LITELLM_TIMEOUT_S ?? '900', 10) || 900;

/**
 * Wall-clock cap for the whole podman run (ms). Defaults to max(45 min, 5× per-call timeout)
 * to cover structured summary + extended abstract + follow-up questions.
 */
export const paperqaRunnerTimeoutMs = () => {
  const explicit = Number.parseInt(process.env.PAPERQA_RUNNER_TIMEOUT_MS ?? '', 10);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }
  const perCallSeconds = paperqaLitellmTimeoutSeconds();
  return Math.max(2_700_000, perCallSeconds * 5 * 1000);
};

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
