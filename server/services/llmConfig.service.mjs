import { actorFromPayload, logAuditEvent } from '../lib/auditEvents.mjs';

export const createLlmConfigService = ({ config, deps, services }) => {
  const { litellm, log } = deps;
  const { secrets } = services;
  const { configuredLlmTiers, llmEndpointCount } = config;

  const defaultTier = (index) => configuredLlmTiers[index] ?? 'a';
  const systemLlmName = (index) => `LLM_${defaultTier(index).toUpperCase()}`;
  const liteLlmModelAlias = (_user, index) => systemLlmName(index);
  const liteLlmSecretReference = (user, index) => `aissistaint://${liteLlmModelAlias(user, index)}`;

  const plannerModelAliases = () =>
    Array.from({ length: llmEndpointCount }, (_value, index) => ({
      alias: systemLlmName(index),
      tier: defaultTier(index),
      configured: true,
    }));

  const plannerAliasSet = () => new Set(plannerModelAliases().map((model) => model.alias));

  const indexFromConfig = (cfg) => {
    const source = `${cfg.secretName ?? ''} ${cfg.id ?? ''}`;
    const match = source.match(/endpoints\/(\d+)|openbao-llm-(\d+)/);
    const parsed = Number.parseInt(match?.[1] ?? match?.[2] ?? '1', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed - 1 : 0;
  };

  const loadRunnableLlmConfig = async (user, cfg) => {
    const index = Math.min(indexFromConfig(cfg), llmEndpointCount - 1);
    const existingSecret = await secrets.read(secrets.secretPath(user, index));
    const existingData = existingSecret?.data?.data ?? {};
    const endpoint = cfg.endpoint || existingData.endpoint || '';
    const model = cfg.model || existingData.model || '';
    const hasToken = Boolean(cfg.token || existingData.encryptedToken || existingData.token);

    if (!endpoint.startsWith('http')) {
      throw new Error('Provider base URL must start with http:// or https://.');
    }

    await litellm.validateLlmEndpoint(endpoint);

    if (!model) {
      throw new Error('No model is configured for this endpoint.');
    }

    if (!hasToken) {
      throw new Error('No provider API key is available in encrypted secret storage for this LiteLLM model.');
    }

    return {
      index,
      endpoint,
      model,
      modelAlias: existingData.modelAlias || liteLlmModelAlias(user, index),
      name: systemLlmName(index),
      tier: defaultTier(index),
    };
  };

  const configureLiteLlmModel = async (user, index, { endpoint, model }) => {
    const modelAlias = liteLlmModelAlias(user, index);
    return litellm.configureModelViaAdminBroker({
      modelAlias,
      model,
      endpoint,
      secretReference: liteLlmSecretReference(user, index),
      actor: actorFromPayload(user),
      auditMetadata: { endpoint: systemLlmName(index) },
    });
  };

  const callLlmChatEndpoint = (cfg, messages, options) => litellm.callChat(cfg, messages, options);

  const extractLlmAnswer = (body) =>
    body.choices?.[0]?.message?.content ??
    body.choices?.[0]?.text ??
    body.output_text ??
    body.response ??
    JSON.stringify(body);

  const toLlmConfig = async (user, index) => {
    const path = secrets.secretPath(user, index);

    try {
      const [secret, metadata] = await Promise.all([
        secrets.read(path),
        secrets.readMetadataForEndpoint(user, index),
      ]);
      if (!secret && !metadata) {
        return {
          id: `openbao-llm-${index + 1}`,
          name: systemLlmName(index),
          endpoint: '',
          model: '',
          modelAlias: liteLlmModelAlias(user, index),
          token: '',
          tier: defaultTier(index),
          status: 'idle',
          secretName: `${secrets.openBaoKvMount}/data/${path}`,
          secretLeaseStatus: 'none',
        };
      }

      const data = secret?.data?.data ?? {};
      const meta = metadata?.data ?? {};
      const tokenStored = Boolean(data.encryptedToken || data.token);

      return {
        id: data.id ?? `openbao-llm-${index + 1}`,
        name: systemLlmName(index),
        endpoint: data.endpoint ?? '',
        model: data.model ?? '',
        modelAlias: data.modelAlias ?? liteLlmModelAlias(user, index),
        token: '',
        tier: defaultTier(index),
        status: 'idle',
        secretName: `${secrets.openBaoKvMount}/data/${path}`,
        secretVersion: meta.current_version,
        secretCreatedAt: meta.created_time,
        secretUpdatedAt: meta.updated_time,
        secretLastRetrievedAt: new Date().toISOString(),
        secretLeaseStatus: secret ? 'retrieved' : 'none',
        tokenStored,
        tokenPreview: tokenStored ? 'stored' : undefined,
      };
    } catch (error) {
      void error;
      return {
        id: `openbao-llm-${index + 1}`,
        name: systemLlmName(index),
        endpoint: '',
        model: '',
        modelAlias: liteLlmModelAlias(user, index),
        token: '',
        tier: defaultTier(index),
        status: 'idle',
        secretName: `${secrets.openBaoKvMount}/data/${path}`,
        secretLeaseStatus: 'none',
      };
    }
  };

  void log;
  void logAuditEvent;

  return {
    defaultTier,
    systemLlmName,
    liteLlmModelAlias,
    liteLlmSecretReference,
    plannerModelAliases,
    plannerAliasSet,
    indexFromConfig,
    loadRunnableLlmConfig,
    configureLiteLlmModel,
    callLlmChatEndpoint,
    extractLlmAnswer,
    toLlmConfig,
    llmEndpointCount,
    configuredLlmTiers,
  };
};
