export const allowedLiteLlmAliasPattern = /^aissistaint-[a-z0-9_-]{1,48}-(high|medium|low)$/;

export const isAllowedLiteLlmAlias = (modelAlias) => allowedLiteLlmAliasPattern.test(String(modelAlias ?? ''));

export const liteLlmSecretReferenceForAlias = (modelAlias) => `aissistaint://${modelAlias}`;

export const isMatchingLiteLlmSecretReference = (modelAlias, secretReference) =>
  Boolean(secretReference) && secretReference === liteLlmSecretReferenceForAlias(modelAlias);
