import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAllowedLiteLlmAlias,
  isMatchingLiteLlmSecretReference,
  liteLlmSecretReferenceForAlias,
} from './brokerPolicy.mjs';

test('isAllowedLiteLlmAlias accepts fixed AIssistAInt model aliases', () => {
  assert.equal(isAllowedLiteLlmAlias('LLM_A'), true);
  assert.equal(isAllowedLiteLlmAlias('LLM_B'), true);
  assert.equal(isAllowedLiteLlmAlias('LLM_C'), true);
});

test('isAllowedLiteLlmAlias rejects aliases outside the namespace or tier set', () => {
  assert.equal(isAllowedLiteLlmAlias('other-user-a'), false);
  assert.equal(isAllowedLiteLlmAlias('aissistaint-user-admin'), false);
  assert.equal(isAllowedLiteLlmAlias('LLM_D'), false);
  assert.equal(isAllowedLiteLlmAlias('llm_a'), false);
  assert.equal(isAllowedLiteLlmAlias('LLM_A_extra'), false);
});

test('isAllowedLiteLlmAlias rejects legacy scoped aliases', () => {
  assert.equal(isAllowedLiteLlmAlias('aissistaint-user_123-a'), false);
  assert.equal(isAllowedLiteLlmAlias('aissistaint-research-agent-b'), false);
  assert.equal(isAllowedLiteLlmAlias('aissistaint-u-c'), false);
});

test('secret references must exactly match the model alias namespace', () => {
  const alias = 'LLM_A';

  assert.equal(liteLlmSecretReferenceForAlias(alias), 'aissistaint://LLM_A');
  assert.equal(isMatchingLiteLlmSecretReference(alias, 'aissistaint://LLM_A'), true);
  assert.equal(isMatchingLiteLlmSecretReference(alias, 'openbao://LLM_A'), false);
  assert.equal(isMatchingLiteLlmSecretReference(alias, 'aissistaint://LLM_B'), false);
  assert.equal(isMatchingLiteLlmSecretReference(alias, ''), false);
});
