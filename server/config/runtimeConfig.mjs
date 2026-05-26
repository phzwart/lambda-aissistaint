import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { configuredAgentRepoDirectories } from '../lib/agentRepo.mjs';
import { parseAllowedHosts } from '../lib/llmEndpointPolicy.mjs';
import { configuredPlannerRepoDirectories } from '../lib/plannerRepo.mjs';

const loadEnvFile = (path, { allowEmpty = true } = {}) => {
  if (!path || !existsSync(path)) {
    return;
  }

  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }

    const [key, ...valueParts] = line.split('=');
    const value = valueParts.join('=');
    if (!(key in process.env)) {
      if (value || allowEmpty) {
        process.env[key] = value;
      }
    }
  }
};

export const loadRuntimeConfig = () => {
  loadEnvFile(resolve('.env.local'), { allowEmpty: false });
  const stackName = process.env.STACK_NAME ?? 'platform-demo';
  const defaultPlatformDir = process.env.BASE_DIR || `${homedir()}/${stackName}`;
  loadEnvFile(process.env.PLATFORM_ENV_FILE || `${defaultPlatformDir}/${stackName}-runtime.env`);
  loadEnvFile(process.env.API_SECRET_ENV_FILE || `${defaultPlatformDir}/secrets/api-runtime.env`);
  loadEnvFile(
    process.env.LITELLM_SECRET_BROKER_ENV_FILE || `${defaultPlatformDir}/secrets/litellm-secret-broker.env`,
  );
  if (process.env.API_LOAD_REMOVAL_SECRETS === 'true') {
    loadEnvFile(process.env.API_REMOVAL_ENV_FILE || `${defaultPlatformDir}/secrets/api-removal.env`);
  }

  const apiPort = Number.parseInt(process.env.API_PORT ?? '8787', 10);
  const apiHost = process.env.API_HOST ?? '127.0.0.1';
  const keycloakPublicUrl =
    process.env.PUBLIC_KEYCLOAK_URL ??
    process.env.VITE_KEYCLOAK_URL ??
    `http://${process.env.HOST_IP ?? '127.0.0.1'}:8080`;
  const keycloakInternalUrl = process.env.INTERNAL_KEYCLOAK_URL ?? keycloakPublicUrl;
  const keycloakRealm = process.env.VITE_KEYCLOAK_REALM ?? process.env.KC_REALM ?? 'minio';
  const keycloakClientId =
    process.env.VITE_KEYCLOAK_CLIENT_ID ?? process.env.AISSISTAINT_UI_CLIENT_ID ?? 'aissistaint-ui';
  const issuer = `${keycloakPublicUrl}/realms/${keycloakRealm}`;
  const keycloakJwksUrl = `${keycloakInternalUrl}/realms/${keycloakRealm}/protocol/openid-connect/certs`;

  const openBaoUrl = process.env.INTERNAL_OPENBAO_URL ?? process.env.VITE_OPENBAO_URL ?? 'http://127.0.0.1:8200';
  const openBaoToken = process.env.OPENBAO_APP_TOKEN ?? '';
  const openBaoKvMount = process.env.OPENBAO_KV_MOUNT ?? 'secret';
  const openBaoPrefix = process.env.OPENBAO_RW_PREFIX ?? 'app-tokens';
  const secretStoreProvider = process.env.SECRET_STORE_PROVIDER ?? 'openbao';
  const appDatabaseUrl = process.env.APP_DATABASE_URL ?? '';

  const minioEndpoint = process.env.INTERNAL_MINIO_ENDPOINT ?? process.env.MINIO_ENDPOINT ?? 'http://127.0.0.1:9000';
  const minioAccessKey = process.env.MINIO_APP_ACCESS_KEY ?? '';
  const minioSecretKey = process.env.MINIO_APP_SECRET_KEY ?? '';
  const minioRemovalAccessKey = process.env.MINIO_REMOVAL_ACCESS_KEY ?? '';
  const minioRemovalSecretKey = process.env.MINIO_REMOVAL_SECRET_KEY ?? '';
  const minioRemovalPolicyName = process.env.MINIO_REMOVAL_POLICY_NAME ?? 'project-removal-rw';

  const projectBucketPrefix = process.env.PROJECT_BUCKET_PREFIX ?? 'aissistaint-project';
  const projectLoadedPrefix = process.env.PROJECT_LOADED_PREFIX ?? 'loaded';
  const projectParsedPrefix = process.env.PROJECT_PARSED_PREFIX ?? 'parsed';
  const projectMetadataObjectKey = process.env.PROJECT_METADATA_OBJECT_KEY ?? 'project.json';

  const wikiBucketPrefix = (process.env.WIKI_BUCKET_PREFIX ?? 'wiki').replace(/^\/+|\/+$/g, '') || 'wiki';
  const wikiMetadataPrefix = (process.env.WIKI_METADATA_PREFIX ?? 'metadata').replace(/^\/+|\/+$/g, '') || 'metadata';
  const wikiMaxChunksPerIngest = Math.max(
    1,
    Number.parseInt(process.env.WIKI_MAX_CHUNKS_PER_INGEST ?? '12', 10) || 12,
  );
  const wikiMaxPageBytes = Math.max(
    1024,
    Number.parseInt(process.env.WIKI_MAX_PAGE_BYTES ?? '131072', 10) || 131072,
  );
  const wikiDefaultTier = String(process.env.WIKI_LLM_TIER ?? 'a').toLowerCase();

  const projectMaxUploadBytes = Math.max(
    1024 * 1024,
    Number.parseInt(process.env.PROJECT_MAX_UPLOAD_BYTES ?? String(64 * 1024 * 1024), 10) || 64 * 1024 * 1024,
  );

  const publicAppUrl = process.env.PUBLIC_APP_URL ?? 'https://aissistaint.localhost:8443';
  const allowedOrigins = new Set(
    (process.env.CORS_ALLOWED_ORIGINS ?? `${publicAppUrl},http://localhost:5173,http://127.0.0.1:5173`)
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  const allowedLlmHosts = parseAllowedHosts(process.env.LLM_ALLOWED_HOSTS ?? 'api.cborg.lbl.gov');
  const allowPrivateLlmEndpoints = process.env.LLM_ALLOW_PRIVATE_ENDPOINTS === 'true';
  const allowHttpLlmEndpoints = process.env.LLM_ALLOW_HTTP_ENDPOINTS === 'true';
  const allowAnyLlmHosts = process.env.LLM_ALLOW_ANY_HOSTS === 'true';
  const explicitLlmDevMode = process.env.LLM_DEV_MODE === 'true';
  const llmRequestTimeoutMs = Number.parseInt(process.env.LLM_REQUEST_TIMEOUT_MS ?? '30000', 10);
  const liteLlmUrl = (process.env.INTERNAL_LITELLM_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/g, '');
  const liteLlmApiKey = process.env.LITELLM_API_KEY ?? '';
  const paperqaLitellmUrl = (process.env.PAPERQA_LITELLM_URL ?? liteLlmUrl).replace(/\/+$/g, '');
  const paperqaLitellmApiKey = process.env.PAPERQA_LITELLM_API_KEY ?? liteLlmApiKey;
  const paperqaEmbeddingModel =
    process.env.PAPERQA_DEFAULT_EMBEDDING_MODEL ?? 'st-multi-qa-MiniLM-L6-cos-v1';
  const paperqaLlmTier = String(process.env.PAPERQA_LLM_TIER ?? wikiDefaultTier).toLowerCase();
  const paperqaIngestWiki = process.env.PAPERQA_PROCESS_INGEST_WIKI !== 'false';
  const liteLlmAdminBrokerUrl = (process.env.LITELLM_ADMIN_BROKER_URL ?? 'http://127.0.0.1:8788').replace(/\/+$/g, '');
  const liteLlmAdminBrokerToken = process.env.LITELLM_ADMIN_BROKER_TOKEN ?? '';
  const liteLlmSecretBrokerToken = process.env.LITELLM_SECRET_BROKER_TOKEN ?? '';
  const secretEncryptionKeyVersion = process.env.SECRET_ENCRYPTION_KEY_VERSION ?? 'v1';

  const agentRepoDirectories = configuredAgentRepoDirectories(process.env.AGENT_REPO_DIRECTORIES);
  const plannerRepoDirectories = configuredPlannerRepoDirectories(
    process.env.PLANNER_REPO_DIRECTORIES,
    process.env.AGENT_REPO_DIRECTORIES,
  );

  const allowedCustomExecutorRegistries = (process.env.AGENT_EXECUTOR_ALLOWED_REGISTRIES ?? 'ghcr.io,docker.io,quay.io')
    .split(',')
    .map((registry) => registry.trim().toLowerCase())
    .filter(Boolean);
  const allowCustomAgentExecutorRegistries =
    process.env.AGENT_EXECUTOR_ALLOW_ANY_REGISTRY === 'true' && process.env.NODE_ENV !== 'production';
  const paperqa2RunnerImage = process.env.PAPERQA2_RUNNER_IMAGE ?? 'localhost/aissistaint/paperqa2-paper-reader:latest';
  const agentExecutorCatalogJson = process.env.AGENT_EXECUTOR_CATALOG_JSON ?? '';

  const gooseChatbotBackend = (process.env.GOOSE_CHATBOT_BACKEND ?? 'litellm').toLowerCase();
  const internalGooseUrl = (process.env.INTERNAL_GOOSE_URL ?? '').replace(/\/+$/g, '');
  const gooseSecretKey = process.env.GOOSE_SECRET_KEY ?? '';
  const gooseWorkingDir = process.env.GOOSE_WORKING_DIR ?? '/workspace';
  const gooseWorkspaceHostDir = resolve(process.env.GOOSE_WORKSPACE_DIR || `${defaultPlatformDir}/goose/workspace`);
  const gooseChatbotDefaultTier = (process.env.GOOSE_CHATBOT_DEFAULT_TIER ?? 'a').toLowerCase();
  const gooseChatbotMaxMessages = Number.parseInt(process.env.GOOSE_CHATBOT_MAX_MESSAGES ?? '24', 10);
  const gooseChatbotMaxTokens = Number.parseInt(process.env.GOOSE_CHATBOT_MAX_TOKENS ?? '768', 10);
  const gooseChatbotTemperature = Number.parseFloat(process.env.GOOSE_CHATBOT_TEMPERATURE ?? '0.2');
  const gooseChatbotSystemPrompt =
    process.env.GOOSE_CHATBOT_SYSTEM_PROMPT ??
    'You are Goose, a concise AI assistant embedded in AIssistAInt. Answer helpfully, avoid exposing secrets, and ask for missing project context when needed.';

  const llmTiers = (process.env.VITE_LLM_TIERS ?? 'A,B,C')
    .split(',')
    .map((tier) => tier.trim().toLowerCase())
    .filter((tier) => ['a', 'b', 'c'].includes(tier));
  const configuredLlmTiers = llmTiers.length > 0 ? llmTiers : ['a', 'b', 'c'];
  const llmEndpointCount = configuredLlmTiers.length;

  if (!openBaoToken) {
    console.warn('OPENBAO_APP_TOKEN is not set. OpenBao API calls will fail until a scoped app token is available.');
  }

  if (!appDatabaseUrl) {
    console.warn('APP_DATABASE_URL is not set. Project API calls will fail until the app database is configured.');
  }

  if (!liteLlmApiKey) {
    console.warn('LITELLM_API_KEY is not set. LLM test/chat calls will fail until LiteLLM proxy credentials are configured.');
  }

  if (!liteLlmAdminBrokerToken) {
    console.warn('LITELLM_ADMIN_BROKER_TOKEN is not set. Saving LLM provider configuration will not be able to update LiteLLM model aliases.');
  }

  if (!liteLlmSecretBrokerToken) {
    console.warn('LITELLM_SECRET_BROKER_TOKEN is not set. LiteLLM secret broker calls will fail until it is configured.');
  }

  if (process.env.NODE_ENV === 'production' && allowPrivateLlmEndpoints) {
    throw new Error('LLM_ALLOW_PRIVATE_ENDPOINTS cannot be enabled when NODE_ENV=production.');
  }

  if (
    allowedLlmHosts.size === 0 &&
    !(allowAnyLlmHosts && explicitLlmDevMode && process.env.NODE_ENV !== 'production')
  ) {
    throw new Error(
      'LLM_ALLOWED_HOSTS must be configured unless LLM_ALLOW_ANY_HOSTS=true and LLM_DEV_MODE=true outside production.',
    );
  }

  return {
    stackName,
    defaultPlatformDir,
    apiPort,
    apiHost,
    keycloakPublicUrl,
    keycloakInternalUrl,
    keycloakRealm,
    keycloakClientId,
    issuer,
    keycloakJwksUrl,
    openBaoUrl,
    openBaoToken,
    openBaoKvMount,
    openBaoPrefix,
    secretStoreProvider,
    appDatabaseUrl,
    minioEndpoint,
    minioAccessKey,
    minioSecretKey,
    minioRemovalAccessKey,
    minioRemovalSecretKey,
    minioRemovalPolicyName,
    projectBucketPrefix,
    projectLoadedPrefix,
    projectParsedPrefix,
    projectMetadataObjectKey,
    wikiBucketPrefix,
    wikiMetadataPrefix,
    wikiMaxChunksPerIngest,
    wikiMaxPageBytes,
    wikiDefaultTier,
    projectMaxUploadBytes,
    publicAppUrl,
    allowedOrigins,
    allowedLlmHosts,
    allowPrivateLlmEndpoints,
    allowHttpLlmEndpoints,
    allowAnyLlmHosts,
    explicitLlmDevMode,
    llmRequestTimeoutMs,
    liteLlmUrl,
    liteLlmApiKey,
    paperqaLitellmUrl,
    paperqaLitellmApiKey,
    paperqaEmbeddingModel,
    paperqaLlmTier,
    paperqaIngestWiki,
    liteLlmAdminBrokerUrl,
    liteLlmAdminBrokerToken,
    liteLlmSecretBrokerToken,
    secretEncryptionKeyVersion,
    agentRepoDirectories,
    plannerRepoDirectories,
    allowedCustomExecutorRegistries,
    allowCustomAgentExecutorRegistries,
    paperqa2RunnerImage,
    agentExecutorCatalogJson,
    gooseChatbotBackend,
    internalGooseUrl,
    gooseSecretKey,
    gooseWorkingDir,
    gooseWorkspaceHostDir,
    gooseChatbotDefaultTier,
    gooseChatbotMaxMessages,
    gooseChatbotMaxTokens,
    gooseChatbotTemperature,
    gooseChatbotSystemPrompt,
    configuredLlmTiers,
    llmEndpointCount,
  };
};
