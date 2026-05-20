import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPaperqaLitellmRuntime } from './paperqaRuntime.mjs';

const originalTimeout = process.env.PAPERQA_LITELLM_TIMEOUT_S;

test.after(() => {
  if (originalTimeout === undefined) {
    delete process.env.PAPERQA_LITELLM_TIMEOUT_S;
  } else {
    process.env.PAPERQA_LITELLM_TIMEOUT_S = originalTimeout;
  }
});

test('buildPaperqaLitellmRuntime uses deployment alias not provider model', () => {
  const runtime = buildPaperqaLitellmRuntime({
    llmConfig: {
      model: 'gpt-4o-2024-11-20',
      endpoint: 'https://api.cborg.lbl.gov/v1',
      name: 'LLM_A',
      tier: 'a',
    },
    modelAlias: 'LLM_A',
    litellmUrl: 'http://127.0.0.1:4000/',
    tier: 'a',
  });
  assert.equal(runtime.modelAlias, 'LLM_A');
  assert.equal(runtime.providerModel, 'gpt-4o-2024-11-20');
  assert.equal(runtime.litellmUrl, 'http://127.0.0.1:4000');
});

test('buildPaperqaLitellmRuntime includes requestTimeoutSeconds for the runner', () => {
  process.env.PAPERQA_LITELLM_TIMEOUT_S = '900';
  const runtime = buildPaperqaLitellmRuntime({
    llmConfig: { model: 'gemma', endpoint: 'https://example/v1', name: 'LLM_A', tier: 'a' },
    modelAlias: 'LLM_A',
    litellmUrl: 'http://127.0.0.1:4000',
    tier: 'a',
  });
  assert.equal(runtime.requestTimeoutSeconds, 900);
});
