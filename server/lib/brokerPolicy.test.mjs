import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAllowedLiteLlmAlias,
  isMatchingLiteLlmSecretReference,
  liteLlmSecretReferenceForAlias,
} from './brokerPolicy.mjs';

test('isAllowedLiteLlmAlias accepts scoped AIssistAInt tier aliases', () => {
  assert.equal(isAllowedLiteLlmAlias('aissistaint-user_123-high'), true);
  assert.equal(isAllowedLiteLlmAlias('aissistaint-research-agent-medium'), true);
  assert.equal(isAllowedLiteLlmAlias('aissistaint-u-low'), true);
});

test('isAllowedLiteLlmAlias rejects aliases outside the namespace or tier set', () => {
  assert.equal(isAllowedLiteLlmAlias('other-user-high'), false);
  assert.equal(isAllowedLiteLlmAlias('aissistaint-user-admin'), false);
  assert.equal(isAllowedLiteLlmAlias('aissistaint-user-high-extra'), false);
  assert.equal(isAllowedLiteLlmAlias('aissistaint-User-high'), false);
  assert.equal(isAllowedLiteLlmAlias('aissistaint--high'), false);
});

test('isAllowedLiteLlmAlias enforces bounded user segment length', () => {
  const fortyEight = 'a'.repeat(48);
  const fortyNine = 'a'.repeat(49);

  assert.equal(isAllowedLiteLlmAlias(`aissistaint-${fortyEight}-high`), true);
  assert.equal(isAllowedLiteLlmAlias(`aissistaint-${fortyNine}-high`), false);
});

test('secret references must exactly match the model alias namespace', () => {
  const alias = 'aissistaint-user_123-high';

  assert.equal(liteLlmSecretReferenceForAlias(alias), 'aissistaint://aissistaint-user_123-high');
  assert.equal(isMatchingLiteLlmSecretReference(alias, 'aissistaint://aissistaint-user_123-high'), true);
  assert.equal(isMatchingLiteLlmSecretReference(alias, 'openbao://aissistaint-user_123-high'), false);
  assert.equal(isMatchingLiteLlmSecretReference(alias, 'aissistaint://aissistaint-other-high'), false);
  assert.equal(isMatchingLiteLlmSecretReference(alias, ''), false);
});
