export const allowedLiteLlmAliasPattern = /^LLM_[ABC]$/;

export const isAllowedLiteLlmAlias = (modelAlias) => allowedLiteLlmAliasPattern.test(String(modelAlias ?? ''));

export const liteLlmSecretReferenceForAlias = (modelAlias) => `aissistaint://${modelAlias}`;

export const isMatchingLiteLlmSecretReference = (modelAlias, secretReference) =>
  Boolean(secretReference) && secretReference === liteLlmSecretReferenceForAlias(modelAlias);
