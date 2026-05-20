import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import pg from 'pg';
import { configuredAgentRepoDirectories, loadAgentRepoCatalog } from './lib/agentRepo.mjs';
import { actorFromPayload, logAuditEvent } from './lib/auditEvents.mjs';
import { isAllowedLiteLlmAlias } from './lib/brokerPolicy.mjs';
import { createLlmEndpointValidator, parseAllowedHosts } from './lib/llmEndpointPolicy.mjs';
import {
  plannerSkillDirectoryName,
  renderPlannerSkillCatalog,
  renderPlannerSkillMarkdown,
  resolvePlannerVisibleSkills,
  validatePlannerExecutionPayload,
} from './lib/plannerSkillCatalog.mjs';
import { configuredPlannerRepoDirectories, loadPlannerSpecCatalog } from './lib/plannerRepo.mjs';
import { ingestDocument as wikiIngestDocument } from './lib/wiki/ingest.mjs';
import {
  ingestProcessedFileToWiki,
  listWikiProcessedSources,
  syncProcessedFilesToWiki,
} from './lib/wiki/processedSources.mjs';
import {
  defaultWikiCategory,
  normalizeCategory as wikiNormalizeCategory,
  pageRefKey as wikiPageRefKey,
  slugifyTitle as wikiSlugifyTitle,
  wikiCategories,
} from './lib/wiki/paths.mjs';
import { parsePage as wikiParsePage } from './lib/wiki/pageDocument.mjs';
import { queryWiki as wikiQuery } from './lib/wiki/query.mjs';
import { buildPaperqaLitellmRuntime } from './lib/paperqaRuntime.mjs';
import {
  PAPER_READER_SKILL_ID,
  normalizePaperReaderProcessingConfig,
  resolvePaperReaderProcessing,
} from './lib/paperReaderProcessingConfig.mjs';
import {
  createProjectProcessJob,
  findFileLogFromJobs,
  getProjectProcessJob,
  listProjectProcessJobs,
  serializeProjectProcessJob,
} from './lib/projectProcessJobs.mjs';
import { readProcessLogFromStorage } from './lib/projectFileProcess.mjs';
import { parsedStemFromObjectKey, processLogObjectKey } from './lib/projectParsedPaths.mjs';
import { runProjectFileProcessJob } from './lib/runProjectFileProcessJob.mjs';
import { listProjectFiles, uploadProjectFiles } from './lib/projectFiles.mjs';
import { createWikiStorage } from './lib/wiki/storage.mjs';

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

loadEnvFile(resolve('.env.local'), { allowEmpty: false });
const stackName = process.env.STACK_NAME ?? 'platform-demo';
const defaultPlatformDir = process.env.BASE_DIR || `${homedir()}/${stackName}`;
loadEnvFile(process.env.PLATFORM_ENV_FILE || `${defaultPlatformDir}/${stackName}-runtime.env`);
loadEnvFile(process.env.API_SECRET_ENV_FILE || `${defaultPlatformDir}/secrets/api-runtime.env`);
loadEnvFile(process.env.LITELLM_SECRET_BROKER_ENV_FILE || `${defaultPlatformDir}/secrets/litellm-secret-broker.env`);
if (process.env.API_LOAD_REMOVAL_SECRETS === 'true') {
  loadEnvFile(process.env.API_REMOVAL_ENV_FILE || `${defaultPlatformDir}/secrets/api-removal.env`);
}

const apiPort = Number.parseInt(process.env.API_PORT ?? '8787', 10);
const apiHost = process.env.API_HOST ?? '127.0.0.1';
const keycloakPublicUrl =
  process.env.PUBLIC_KEYCLOAK_URL ?? process.env.VITE_KEYCLOAK_URL ?? `http://${process.env.HOST_IP ?? '127.0.0.1'}:8080`;
const keycloakInternalUrl = process.env.INTERNAL_KEYCLOAK_URL ?? keycloakPublicUrl;
const keycloakRealm = process.env.VITE_KEYCLOAK_REALM ?? process.env.KC_REALM ?? 'minio';
const keycloakClientId = process.env.VITE_KEYCLOAK_CLIENT_ID ?? process.env.AISSISTAINT_UI_CLIENT_ID ?? 'aissistaint-ui';
const issuer = `${keycloakPublicUrl}/realms/${keycloakRealm}`;
const jwks = createRemoteJWKSet(new URL(`${keycloakInternalUrl}/realms/${keycloakRealm}/protocol/openid-connect/certs`));

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
const projectUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 20,
    fileSize: projectMaxUploadBytes,
  },
});
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
const plannerRepoDirectories = configuredPlannerRepoDirectories(process.env.PLANNER_REPO_DIRECTORIES, process.env.AGENT_REPO_DIRECTORIES);
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
const validateLlmEndpoint = createLlmEndpointValidator({
  allowedHosts: allowedLlmHosts,
  allowPrivateEndpoints: allowPrivateLlmEndpoints,
  allowHttpEndpoints: allowHttpLlmEndpoints,
});
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

if (allowedLlmHosts.size === 0 && !(allowAnyLlmHosts && explicitLlmDevMode && process.env.NODE_ENV !== 'production')) {
  throw new Error('LLM_ALLOWED_HOSTS must be configured unless LLM_ALLOW_ANY_HOSTS=true and LLM_DEV_MODE=true outside production.');
}

const projectDb = appDatabaseUrl ? new pg.Pool({ connectionString: appDatabaseUrl }) : null;
const createMinioClient = (accessKeyId, secretAccessKey) =>
  accessKeyId && secretAccessKey
    ? new S3Client({
        endpoint: minioEndpoint,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      })
    : null;
const minioClient = createMinioClient(minioAccessKey, minioSecretKey);
const minioRemovalClient = createMinioClient(minioRemovalAccessKey, minioRemovalSecretKey);
let projectDbReady = false;
let projectDbInitPromise = null;

if (!minioClient) {
  console.warn('MINIO_APP_ACCESS_KEY/MINIO_APP_SECRET_KEY are not set. Project bucket operations will fail until scoped app credentials are available.');
}

if (!minioRemovalClient) {
  console.warn('MINIO_REMOVAL_ACCESS_KEY/MINIO_REMOVAL_SECRET_KEY are not set. Project deletion bucket lockdown will fail until scoped removal credentials are available.');
}

const app = express();
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('CORS origin is not allowed.'));
    },
  }),
);
app.use(express.json({ limit: '1mb' }));

const log = (message, details = {}) => {
  const suffix = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
  console.log(`[${new Date().toISOString()}] ${message}${suffix}`);
};

const loadSecretEncryptionKey = () => {
  const keyFile = process.env.SECRET_ENCRYPTION_KEY_FILE ?? '';
  let raw = '';
  if (keyFile && existsSync(keyFile)) {
    const mode = statSync(keyFile).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      throw new Error('SECRET_ENCRYPTION_KEY_FILE must not be readable by group or others.');
    }
    raw = readFileSync(keyFile, 'utf8').trim();
  } else if (process.env.SECRET_ENCRYPTION_KEY_ALLOW_ENV === 'true') {
    raw = process.env.SECRET_ENCRYPTION_KEY ?? '';
  }

  if (!raw) {
    return null;
  }

  const normalized = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(normalized)
    ? Buffer.from(normalized, 'hex')
    : Buffer.from(normalized, 'base64');
  if (key.length !== 32) {
    throw new Error('Secret encryption key must decode to 32 bytes.');
  }
  return key;
};

const secretEncryptionKey = loadSecretEncryptionKey();

const requireSecretEncryptionKey = () => {
  if (!secretEncryptionKey) {
    throw new Error('Secret encryption key is not configured on the backend.');
  }
  return secretEncryptionKey;
};

const tokenFingerprint = (token) => createHash('sha256').update(token).digest('hex').slice(0, 16);

const encryptProviderToken = (token, associatedData) => {
  const key = requireSecretEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(associatedData));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    encryptedToken: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: secretEncryptionKeyVersion,
    tokenFingerprint: tokenFingerprint(token),
  };
};

const decryptProviderToken = (record, associatedData) => {
  const key = requireSecretEncryptionKey();
  if (!record?.encryptedToken || !record?.iv || !record?.authTag) {
    throw new Error('Encrypted provider key record is incomplete.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
  decipher.setAAD(Buffer.from(associatedData));
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(record.encryptedToken, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};

const userRoles = (payload = {}) => {
  const realmRoles = Array.isArray(payload.realm_access?.roles) ? payload.realm_access.roles : [];
  const clientRoles = Array.isArray(payload.resource_access?.[keycloakClientId]?.roles)
    ? payload.resource_access[keycloakClientId].roles
    : [];
  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  return new Set([...realmRoles, ...clientRoles, ...groups].map((role) => String(role).replace(/^\//, '').toLowerCase()));
};

const hasAnyRole = (payload, roles) => {
  const assignedRoles = userRoles(payload);
  return roles.some((role) => assignedRoles.has(role));
};

const isAdmin = (payload) => hasAnyRole(payload, ['aissistaint-admin']);
const isRemovalAgent = (payload) => hasAnyRole(payload, ['removal-agent']);

const requireAdmin = (request, response, next) => {
  if (isAdmin(request.user)) {
    next();
    return;
  }
  response.status(403).json({ error: 'Administrator access is required.' });
};

const requireProjectDeletionRole = (request, response, next) => {
  if (isAdmin(request.user) || isRemovalAgent(request.user)) {
    next();
    return;
  }
  response.status(403).json({ error: 'Administrator or removal-agent access is required.' });
};

const forbidden = (message = 'You do not have access to this project.') => {
  const error = new Error(message);
  error.status = 403;
  return error;
};

const jsonResponse = async (response) => {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const requireAuth = async (request, response, next) => {
  const header = request.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

  if (!token) {
    response.status(401).json({ error: 'Missing bearer token.' });
    return;
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
    });
    const audience = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
    if (payload.azp !== keycloakClientId && !audience.includes(keycloakClientId)) {
      response.status(403).json({ error: 'Token was not issued for this application client.' });
      return;
    }

    request.user = payload;
    next();
  } catch (error) {
    log('Invalid Keycloak token', { detail: error instanceof Error ? error.message : 'Unknown verification error.' });
    logAuditEvent({
      event: 'auth.token_invalid',
      actor: 'anonymous',
      action: 'verify',
      resourceType: 'auth',
      outcome: 'denied',
      metadata: { reason: error instanceof Error ? error.name : 'unknown' },
    });
    response.status(401).json({
      error: 'Invalid Keycloak token.',
    });
  }
};

const resetProjectDbInit = () => {
  projectDbReady = false;
  projectDbInitPromise = null;
};

const isMissingProjectsTableError = (error) =>
  error?.code === '42P01' && /relation "projects" does not exist/i.test(String(error?.message ?? ''));

const verifyProjectSchema = async () => {
  const result = await projectDb.query(
    `SELECT to_regclass('public.projects') AS projects_table, to_regclass('public.project_members') AS members_table`,
  );
  const row = result.rows[0] ?? {};
  return Boolean(row.projects_table && row.members_table);
};

const initializeProjectDb = async () => {
  const client = await projectDb.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(424242001)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id uuid PRIMARY KEY,
        name text NOT NULL CHECK (length(trim(name)) > 0),
        description text NOT NULL DEFAULT '',
        status text NOT NULL DEFAULT 'active',
        bucket_name text,
        loaded_prefix text NOT NULL DEFAULT 'loaded',
        parsed_prefix text NOT NULL DEFAULT 'parsed',
        metadata_object_key text NOT NULL DEFAULT 'project.json',
        created_by text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS bucket_name text');
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS loaded_prefix text NOT NULL DEFAULT 'loaded'`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS parsed_prefix text NOT NULL DEFAULT 'parsed'`);
    await client.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS metadata_object_key text NOT NULL DEFAULT 'project.json'`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_members (
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_subject text NOT NULL,
        role text NOT NULL DEFAULT 'owner',
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (project_id, user_subject)
      )
    `);
    await client.query('COMMIT');
    projectDbReady = true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const requireProjectDb = async () => {
  if (!projectDb) {
    throw new Error('App database is not configured on the backend.');
  }

  if (projectDbReady) {
    const schemaOk = await verifyProjectSchema();
    if (!schemaOk) {
      log('Project schema missing; re-initializing app database tables.');
      resetProjectDbInit();
    }
  }

  if (!projectDbReady) {
    projectDbInitPromise ??= initializeProjectDb().catch((error) => {
      projectDbInitPromise = null;
      throw error;
    });
    await projectDbInitPromise;
  }

  return projectDb;
};

const toProject = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  status: row.status,
  bucketName: row.bucket_name,
  loadedPrefix: row.loaded_prefix,
  parsedPrefix: row.parsed_prefix,
  metadataObjectKey: row.metadata_object_key,
  createdBy: row.created_by,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
});

const userSubject = (request) => actorFromPayload(request.user);

const getProjectRole = async (client, projectId, request) => {
  if (isAdmin(request.user) || isRemovalAgent(request.user)) {
    return 'admin';
  }

  const result = await client.query(
    `
      SELECT role
      FROM project_members
      WHERE project_id = $1 AND user_subject = $2
    `,
    [projectId, userSubject(request)],
  );
  return result.rows[0]?.role ?? null;
};

const requireProjectRole = async (client, projectId, request, allowedRoles = ['owner', 'editor']) => {
  const role = await getProjectRole(client, projectId, request);
  if (!role || (role !== 'admin' && !allowedRoles.includes(role))) {
    throw forbidden();
  }
  return role;
};

const normalizeBucketSegment = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const projectBucketName = (projectId, name) => {
  const prefix = normalizeBucketSegment(projectBucketPrefix) || 'aissistaint-project';
  const slug = normalizeBucketSegment(name) || 'project';
  return `${prefix}-${slug}-${projectId.slice(0, 8)}`.slice(0, 63).replace(/-+$/g, '');
};

const objectPrefix = (value) => value.replace(/^\/+|\/+$/g, '') || 'data';
const objectKey = (value) => value.replace(/^\/+/g, '') || 'project.json';

const ensureProjectBucket = async ({ bucketName, loadedPrefix, parsedPrefix }) => {
  if (!minioClient) {
    throw new Error('MinIO credentials are not configured on the backend.');
  }

  try {
    await minioClient.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch {
    await minioClient.send(new CreateBucketCommand({ Bucket: bucketName }));
  }

  const emptyPrefixBody = Buffer.alloc(0);
  await Promise.all(
    [loadedPrefix, parsedPrefix].map((prefix) =>
      minioClient.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: `${objectPrefix(prefix)}/`,
          Body: emptyPrefixBody,
          ContentLength: 0,
        }),
      ),
    ),
  );
};

const writeProjectMetadataObject = async (project) => {
  if (!minioClient) {
    throw new Error('MinIO credentials are not configured on the backend.');
  }

  if (!project.bucketName) {
    throw new Error('Project does not have a MinIO bucket configured.');
  }

  const metadata = {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    bucketName: project.bucketName,
    loadedPrefix: project.loadedPrefix,
    parsedPrefix: project.parsedPrefix,
    metadataObjectKey: project.metadataObjectKey,
    createdBy: project.createdBy,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    deletedAt: project.deletedAt,
  };

  await minioClient.send(
    new PutObjectCommand({
      Bucket: project.bucketName,
      Key: objectKey(project.metadataObjectKey ?? projectMetadataObjectKey),
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json',
    }),
  );
};

const restrictDeletedProjectBucket = async (bucketName) => {
  if (!minioRemovalClient) {
    throw new Error('MinIO removal credentials are not configured on the backend.');
  }

  await minioRemovalClient.send(
    new PutBucketPolicyCommand({
      Bucket: bucketName,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'HideDeletedProjectFromRegularUsers',
            Effect: 'Deny',
            Principal: '*',
            Action: [
              's3:GetBucketLocation',
              's3:ListBucket',
              's3:GetObject',
              's3:PutObject',
              's3:DeleteObject',
            ],
            Resource: [`arn:aws:s3:::${bucketName}`, `arn:aws:s3:::${bucketName}/*`],
            Condition: {
              StringNotEquals: {
                'jwt:policy': minioRemovalPolicyName,
              },
            },
          },
        ],
      }),
    }),
  );
};

const openBaoFetch = async (path, init = {}) => {
  if (!openBaoToken) {
    throw new Error('OpenBao token is not configured on the backend.');
  }

  const response = await fetch(`${openBaoUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Vault-Token': openBaoToken,
      ...(init.headers ?? {}),
    },
  });
  const body = await jsonResponse(response);
  log('OpenBao request', {
    method: init.method ?? 'GET',
    path,
    status: response.status,
  });

  if (!response.ok) {
    log('OpenBao request failed', {
      method: init.method ?? 'GET',
      path,
      status: response.status,
      detail: body.errors?.join(', ') || body.error || body.raw || 'No response detail.',
    });
    const error = new Error('Secret store request failed.');
    error.status = response.status;
    throw error;
  }

  return body;
};

const openBaoFetchOptional = async (path, init = {}) => {
  try {
    return await openBaoFetch(path, init);
  } catch (error) {
    if (error instanceof Error && error.status === 404) {
      log('OpenBao secret not found', {
        method: init.method ?? 'GET',
        path,
      });
      return null;
    }

    throw error;
  }
};

const ensureSupportedSecretStore = () => {
  if (secretStoreProvider !== 'openbao') {
    throw new Error(`Secret store provider ${secretStoreProvider} is not implemented by this backend.`);
  }
};

const secretStoreRead = async (path) => {
  ensureSupportedSecretStore();
  return openBaoFetchOptional(dataApiPathForSecretPath(path));
};

const secretStoreWrite = async (path, data) => {
  ensureSupportedSecretStore();
  return openBaoFetch(dataApiPathForSecretPath(path), {
    method: 'POST',
    body: JSON.stringify({ data }),
  });
};

const secretStoreDeleteMetadata = async (path) => {
  ensureSupportedSecretStore();
  return openBaoFetchOptional(`/v1/${openBaoKvMount}/metadata/${path}`, { method: 'DELETE' });
};

const secretUserSegment = (user) =>
  encodeURIComponent(String(user?.sub ?? user?.preferred_username ?? 'unknown-user')).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const secretPath = (user, index) => `${openBaoPrefix}/users/${secretUserSegment(user)}/llm/endpoints/${index + 1}`;
const agentSkillRootPath = (user) => `${openBaoPrefix}/users/${secretUserSegment(user)}/agent`;
const agentSkillIndexPath = (user) => `${agentSkillRootPath(user)}/skills/index`;
const agentSkillPath = (user, skillId) => `${agentSkillRootPath(user)}/skills/${encodeURIComponent(skillId)}`;
const agentProjectSkillBindingsPath = (user, projectId) =>
  `${agentSkillRootPath(user)}/projects/${encodeURIComponent(projectId)}/skills`;
const plannerRootPath = (user) => `${openBaoPrefix}/users/${secretUserSegment(user)}/planner`;
const plannerDefaultPath = (user) => `${plannerRootPath(user)}/default`;
const plannerProjectPath = (user, projectId) => `${plannerRootPath(user)}/projects/${encodeURIComponent(projectId)}`;
const providerTokenAad = (path) => `${secretStoreProvider}:${path}:provider-token`;
const dataApiPath = (user, index) => `/v1/${openBaoKvMount}/data/${secretPath(user, index)}`;
const metadataApiPath = (user, index) => `/v1/${openBaoKvMount}/metadata/${secretPath(user, index)}`;
const dataApiPathForSecretPath = (path) => `/v1/${openBaoKvMount}/data/${path}`;
const aliasPath = (alias) => `${openBaoPrefix}/litellm/aliases/${encodeURIComponent(alias)}`;
const aliasDataApiPath = (alias) => dataApiPathForSecretPath(aliasPath(alias));

const defaultTier = (index) => configuredLlmTiers[index] ?? 'a';
const systemLlmName = (index) => `LLM_${defaultTier(index).toUpperCase()}`;
const liteLlmModelAlias = (_user, index) => systemLlmName(index);
const liteLlmSecretReference = (user, index) => `aissistaint://${liteLlmModelAlias(user, index)}`;

const defaultAgentSkillExecutable = () => ({
  mode: 'none',
  args: [],
  timeoutSeconds: 120,
  network: 'none',
  envAllowlist: [],
});

const defaultAgentExecutorCatalog = [
  {
    id: 'python-sandbox',
    name: 'Python Sandbox',
    description: 'Runs short Python helpers in a constrained workspace container.',
    image: 'ghcr.io/aissistaint/python-sandbox:latest',
    command: 'python',
    args: ['-m', 'aissistaint_skill_runner'],
    workingDir: '/workspace',
    timeoutSeconds: 120,
    network: 'none',
    envAllowlist: [],
  },
  {
    id: 'paperqa2-paper-reader',
    name: 'PaperQA2 Paper Reader',
    description: 'Runs the one-paper PaperQA2 summary workflow in a constrained Podman container.',
    image: process.env.PAPERQA2_RUNNER_IMAGE ?? 'localhost/aissistaint/paperqa2-paper-reader:latest',
    command: 'paper-reader-summary',
    args: [],
    workingDir: '/workspace',
    timeoutSeconds: 900,
    network: 'egress',
    envAllowlist: ['PAPERQA_LITELLM_URL', 'PAPERQA_LITELLM_API_KEY'],
  },
];

const parseAgentExecutorCatalog = () => {
  const raw = process.env.AGENT_EXECUTOR_CATALOG_JSON;
  if (!raw) {
    return defaultAgentExecutorCatalog;
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : defaultAgentExecutorCatalog;
  } catch {
    console.warn('AGENT_EXECUTOR_CATALOG_JSON is not valid JSON. Using default agent executor catalog.');
    return defaultAgentExecutorCatalog;
  }
};

const agentExecutorCatalog = parseAgentExecutorCatalog();

const loadAgentRepositories = () =>
  loadAgentRepoCatalog({
    directories: agentRepoDirectories,
    executorCatalog: agentExecutorCatalog,
    logger: console,
  });

const loadPlannerRepositories = () =>
  loadPlannerSpecCatalog({
    directories: plannerRepoDirectories,
    logger: console,
  });

const agentSkillIdPattern = /^[A-Za-z0-9_-]{1,80}$/;
const allowedCustomExecutorRegistries = (process.env.AGENT_EXECUTOR_ALLOWED_REGISTRIES ?? 'ghcr.io,docker.io,quay.io')
  .split(',')
  .map((registry) => registry.trim().toLowerCase())
  .filter(Boolean);
const allowCustomAgentExecutorRegistries =
  process.env.AGENT_EXECUTOR_ALLOW_ANY_REGISTRY === 'true' && process.env.NODE_ENV !== 'production';

const splitLines = (value) =>
  Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : String(value ?? '')
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);

const trimBounded = (value, label, maxLength, { required = false } = {}) => {
  const trimmed = String(value ?? '').trim();
  if (required && !trimmed) {
    throw Object.assign(new Error(`${label} is required.`), { status: 400 });
  }
  if (trimmed.length > maxLength) {
    throw Object.assign(new Error(`${label} must be ${maxLength} characters or less.`), { status: 400 });
  }
  return trimmed;
};

const validateEnvAllowlist = (values) => {
  const envNames = splitLines(values);
  for (const name of envNames) {
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(name)) {
      throw Object.assign(new Error(`Invalid environment variable allowlist entry: ${name}.`), { status: 400 });
    }
  }
  return envNames;
};

const validateExecutorImage = (image) => {
  const trimmed = trimBounded(image, 'Container image', 240, { required: true });
  if (trimmed.includes(' ') || trimmed.includes('..')) {
    throw Object.assign(new Error('Container image contains invalid characters.'), { status: 400 });
  }

  const registry = trimmed.includes('/') ? trimmed.split('/')[0].toLowerCase() : 'docker.io';
  if (!allowCustomAgentExecutorRegistries && !allowedCustomExecutorRegistries.includes(registry)) {
    throw Object.assign(new Error(`Container image registry ${registry} is not allowed.`), { status: 400 });
  }
  return trimmed;
};

const slugifySkillName = (value, fallbackId) => {
  const slug = String(value || fallbackId || 'agent-skill')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'agent-skill';
};

const yamlQuote = (value) => JSON.stringify(String(value ?? ''));

const skillDescription = (skill) => {
  const purpose = skill.purpose || `${skill.name} agent skill.`;
  const when = skill.whenToUse ? ` Use when ${skill.whenToUse.replace(/\.$/, '')}.` : '';
  return `${purpose}${when}`.replace(/\s+/g, ' ').trim().slice(0, 1024);
};

const renderListSection = (title, values) => {
  if (!values.length) {
    return '';
  }
  return `\n## ${title}\n\n${values.map((value) => `- ${value}`).join('\n')}\n`;
};

const renderExecutableSection = (executable) => {
  if (!executable || executable.mode === 'none') {
    return '';
  }

  const lines = [
    '\n## Executable',
    '',
    `Mode: ${executable.mode}`,
    executable.catalogId ? `Catalog id: ${executable.catalogId}` : '',
    executable.image ? `Container image: ${executable.image}` : '',
    executable.command ? `Command: \`${[executable.command, ...(executable.args ?? [])].join(' ')}\`` : '',
    executable.workingDir ? `Working directory: \`${executable.workingDir}\`` : '',
    `Timeout: ${executable.timeoutSeconds} seconds`,
    `Network: ${executable.network}`,
    executable.envAllowlist?.length ? `Allowed environment names: ${executable.envAllowlist.join(', ')}` : '',
    '',
    'Treat this executable as an approved runtime declaration. Do not add secrets to arguments or environment values.',
  ].filter(Boolean);

  return `${lines.join('\n')}\n`;
};

const renderSkillPackage = (skill) => {
  const directoryName = slugifySkillName(skill.name, skill.id);
  const description = skillDescription(skill);
  const skillMd = `---
name: ${directoryName}
description: ${yamlQuote(description)}
disable-model-invocation: true
---

# ${skill.name || directoryName}

## Purpose

${skill.purpose || 'Describe what this skill does.'}

## When To Use

${skill.whenToUse || 'Describe when the agent should use this skill.'}
${renderListSection('Inputs', skill.inputs)}
## Procedure

${skill.procedure || 'Describe the steps the agent should follow.'}

## Expected Output

${skill.expectedOutput || 'Describe the expected output.'}

## Safety Constraints

${skill.safetyConstraints || 'Follow project safety and data handling requirements.'}
${renderListSection('Required Tools', skill.requiredTools)}${renderExecutableSection(skill.executable)}`;

  return {
    directoryName,
    skillMd,
    files: [
      {
        path: 'SKILL.md',
        content: skillMd,
      },
    ],
  };
};

const normalizeAgentExecutable = (input = {}) => {
  const mode = ['none', 'catalog', 'custom'].includes(input.mode) ? input.mode : 'none';
  if (mode === 'none') {
    return defaultAgentSkillExecutable();
  }

  const timeoutSeconds = Math.min(Math.max(Number.parseInt(input.timeoutSeconds ?? '120', 10) || 120, 10), 900);
  const network = input.network === 'egress' ? 'egress' : 'none';
  const args = splitLines(input.args).slice(0, 20);
  const envAllowlist = validateEnvAllowlist(input.envAllowlist).slice(0, 30);

  if (mode === 'catalog') {
    const catalogId = trimBounded(input.catalogId, 'Executor catalog item', 80, { required: true });
    const catalogItem = agentExecutorCatalog.find((item) => item.id === catalogId);
    if (!catalogItem) {
      throw Object.assign(new Error('Selected executor catalog item is not available.'), { status: 400 });
    }
    return {
      mode,
      catalogId,
      image: catalogItem.image,
      command: catalogItem.command,
      args: args.length ? args : catalogItem.args,
      workingDir: catalogItem.workingDir,
      timeoutSeconds,
      network: catalogItem.network,
      envAllowlist,
    };
  }

  const workingDir = trimBounded(input.workingDir || '/workspace', 'Working directory', 120);
  if (!workingDir.startsWith('/workspace')) {
    throw Object.assign(new Error('Custom executors must use a working directory under /workspace.'), { status: 400 });
  }

  return {
    mode,
    image: validateExecutorImage(input.image),
    command: trimBounded(input.command, 'Command', 120, { required: true }),
    args,
    workingDir,
    timeoutSeconds,
    network,
    envAllowlist,
  };
};

const normalizeAgentSkill = (input = {}, existing = {}) => {
  const now = new Date().toISOString();
  const id = String(input.id || existing.id || randomUUID());
  if (!agentSkillIdPattern.test(id)) {
    throw Object.assign(new Error('Skill id contains unsupported characters.'), { status: 400 });
  }

  const status = input.status === 'enabled' ? 'enabled' : 'draft';
  const skill = {
    id,
    name: trimBounded(input.name, 'Skill name', 120, { required: status === 'enabled' }),
    description: trimBounded(input.description, 'Skill description', 1024),
    category: trimBounded(input.category || 'General', 'Category', 80),
    status,
    source: 'user',
    editable: true,
    origin: input.origin && input.source === 'package' ? undefined : input.origin,
    capabilities: splitLines(input.capabilities).slice(0, 30),
    purpose: trimBounded(input.purpose, 'Purpose', 2000, { required: status === 'enabled' }),
    whenToUse: trimBounded(input.whenToUse, 'When to use', 2000, { required: status === 'enabled' }),
    inputs: splitLines(input.inputs).slice(0, 30),
    procedure: trimBounded(input.procedure, 'Procedure', 6000, { required: status === 'enabled' }),
    expectedOutput: trimBounded(input.expectedOutput, 'Expected output', 2000),
    safetyConstraints: trimBounded(input.safetyConstraints, 'Safety constraints', 3000),
    requiredTools: splitLines(input.requiredTools).slice(0, 30),
    executable: normalizeAgentExecutable(input.executable),
    skillPackage: input.skillPackage ?? existing.skillPackage ?? { directoryName: 'agent-skill', skillMd: '', files: [] },
    createdAt: existing.createdAt || input.createdAt || now,
    updatedAt: now,
  };

  if (skill.status === 'enabled' && skill.executable.mode === 'custom' && !skill.safetyConstraints) {
    throw Object.assign(new Error('Safety constraints are required before enabling a custom executable skill.'), { status: 400 });
  }

  return {
    ...skill,
    skillPackage: renderSkillPackage(skill),
  };
};

const readAgentSkillIndex = async (user) => {
  const secret = await secretStoreRead(agentSkillIndexPath(user));
  const ids = secret?.data?.data?.ids;
  return Array.isArray(ids) ? ids.filter((id) => agentSkillIdPattern.test(String(id))) : [];
};

const writeAgentSkillIndex = async (user, ids) => {
  const uniqueIds = [...new Set(ids.filter((id) => agentSkillIdPattern.test(String(id))))];
  await secretStoreWrite(agentSkillIndexPath(user), { ids: uniqueIds, updatedAt: new Date().toISOString() });
  return uniqueIds;
};

const readAgentSkills = async (user) => {
  const ids = await readAgentSkillIndex(user);
  const skills = await Promise.all(
    ids.map(async (id) => {
      const secret = await secretStoreRead(agentSkillPath(user, id));
      return secret?.data?.data ?? null;
    }),
  );
  return skills.filter(Boolean).map((skill) => ({
    source: 'user',
    editable: true,
    capabilities: [],
    description: '',
    ...skill,
    source: 'user',
    editable: true,
  }));
};

const normalizeProjectSkillBindings = (bindings, skills) => {
  const skillIds = new Set(skills.map((skill) => skill.id));
  return (Array.isArray(bindings) ? bindings : [])
    .filter((binding) => skillIds.has(String(binding.skillId ?? '')))
    .map((binding, index) => {
      const skillId = String(binding.skillId);
      const normalized = {
        skillId,
        enabled: Boolean(binding.enabled),
        priority: Number.isFinite(Number(binding.priority)) ? Number(binding.priority) : index + 1,
        notes: trimBounded(binding.notes, 'Binding notes', 500),
      };
      if (skillId === PAPER_READER_SKILL_ID && binding.processingConfig) {
        const processingConfig = normalizePaperReaderProcessingConfig(binding.processingConfig);
        if (processingConfig) {
          normalized.processingConfig = processingConfig;
        }
      }
      return normalized;
    })
    .sort((a, b) => a.priority - b.priority);
};

const readProjectAgentSkillBindings = async (user, projectId, skills) => {
  if (!projectId) {
    return [];
  }
  const secret = await secretStoreRead(agentProjectSkillBindingsPath(user, projectId));
  return normalizeProjectSkillBindings(secret?.data?.data?.bindings ?? [], skills);
};

const plannerModelAliases = () =>
  Array.from({ length: llmEndpointCount }, (_value, index) => ({
    alias: systemLlmName(index),
    tier: defaultTier(index),
    configured: true,
  }));

const plannerAliasSet = () => new Set(plannerModelAliases().map((model) => model.alias));

const defaultPlannerConfigFromSpec = (spec) => {
  const aliases = plannerModelAliases();
  const fallbackAlias = aliases[0]?.alias ?? 'LLM_A';
  return {
    specId: spec?.id ?? '',
    roleBindings: Object.fromEntries((spec?.modelRoles ?? ['planner', 'worker', 'summarizer']).map((role) => [role, fallbackAlias])),
    contextPolicy: {
      strategy: spec?.defaultContext?.strategy ?? 'summarize',
      maxTurns: spec?.defaultContext?.maxTurns ?? 50,
      subagentMaxTurns: spec?.defaultContext?.subagentMaxTurns ?? 25,
    },
    skillPolicy: {
      visibility: spec?.skillPolicy?.defaultVisibility ?? 'project-enabled',
      allowedSkillIds: spec?.skillPolicy?.allowedSkillIds ?? [],
      allowedCategories: spec?.skillPolicy?.allowedCategories ?? [],
    },
    workspaceMode: spec?.workspacePolicy?.mode ?? 'project-workspace',
  };
};

const mergePlannerConfig = (spec, globalConfig = {}, projectConfig = {}) => ({
  ...defaultPlannerConfigFromSpec(spec),
  ...globalConfig,
  ...projectConfig,
  roleBindings: {
    ...defaultPlannerConfigFromSpec(spec).roleBindings,
    ...(globalConfig.roleBindings ?? {}),
    ...(projectConfig.roleBindings ?? {}),
  },
  contextPolicy: {
    ...defaultPlannerConfigFromSpec(spec).contextPolicy,
    ...(globalConfig.contextPolicy ?? {}),
    ...(projectConfig.contextPolicy ?? {}),
  },
  skillPolicy: {
    ...defaultPlannerConfigFromSpec(spec).skillPolicy,
    ...(globalConfig.skillPolicy ?? {}),
    ...(projectConfig.skillPolicy ?? {}),
  },
});

const normalizePlannerConfig = (input = {}, specs = []) => {
  const fallbackSpec = specs[0];
  const specId = trimBounded(input.specId || fallbackSpec?.id || '', 'Planner spec', 80, { required: true });
  const spec = specs.find((item) => item.id === specId);
  if (!spec) {
    throw Object.assign(new Error('Selected planner spec is not available.'), { status: 400 });
  }

  const allowedAliases = plannerAliasSet();
  const base = defaultPlannerConfigFromSpec(spec);
  const roleBindings = {};
  for (const role of spec.modelRoles) {
    const alias = trimBounded(input.roleBindings?.[role] || base.roleBindings[role], `Model binding for ${role}`, 40, { required: true });
    if (!allowedAliases.has(alias)) {
      throw Object.assign(new Error(`Model binding for ${role} must use a configured LiteLLM alias.`), { status: 400 });
    }
    roleBindings[role] = alias;
  }

  const strategy = ['summarize', 'truncate', 'clear', 'prompt'].includes(input.contextPolicy?.strategy)
    ? input.contextPolicy.strategy
    : base.contextPolicy.strategy;
  const maxTurns = Math.min(Math.max(Number.parseInt(input.contextPolicy?.maxTurns ?? base.contextPolicy.maxTurns, 10) || 50, 1), 200);
  const subagentMaxTurns = Math.min(
    Math.max(Number.parseInt(input.contextPolicy?.subagentMaxTurns ?? base.contextPolicy.subagentMaxTurns, 10) || 25, 1),
    100,
  );
  const visibility = ['all-enabled', 'project-enabled', 'allowlist'].includes(input.skillPolicy?.visibility)
    ? input.skillPolicy.visibility
    : base.skillPolicy.visibility;

  return {
    specId,
    roleBindings,
    contextPolicy: { strategy, maxTurns, subagentMaxTurns },
    skillPolicy: {
      visibility,
      allowedSkillIds: splitLines(input.skillPolicy?.allowedSkillIds).slice(0, 100),
      allowedCategories: splitLines(input.skillPolicy?.allowedCategories).slice(0, 30),
    },
    workspaceMode: ['project-workspace', 'goose-workspace', 'read-only'].includes(input.workspaceMode)
      ? input.workspaceMode
      : base.workspaceMode,
    updatedAt: new Date().toISOString(),
  };
};

const readPlannerConfigRecord = async (path) => {
  const secret = await secretStoreRead(path);
  return secret?.data?.data?.config ?? null;
};

const readMergedPlannerConfig = async (user, projectId, specs) => {
  const globalConfig = await readPlannerConfigRecord(plannerDefaultPath(user));
  const selectedSpecId = projectId
    ? (await readPlannerConfigRecord(plannerProjectPath(user, projectId)))?.specId || globalConfig?.specId
    : globalConfig?.specId;
  const spec = specs.find((item) => item.id === selectedSpecId) ?? specs[0];
  if (!spec) {
    return { config: null, globalConfig, projectConfig: null, spec: null };
  }
  const projectConfig = projectId ? await readPlannerConfigRecord(plannerProjectPath(user, projectId)) : null;
  return {
    config: mergePlannerConfig(spec, globalConfig ?? {}, projectConfig ?? {}),
    globalConfig,
    projectConfig,
    spec,
  };
};

const safeProjectWorkspaceName = (projectId) => {
  const normalized = String(projectId ?? '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  if (!normalized) {
    throw Object.assign(new Error('Project id is required for planner Goose workspace materialization.'), { status: 400 });
  }
  return normalized;
};

const projectGooseWorkspace = (projectId) => {
  const projectDirectory = safeProjectWorkspaceName(projectId);
  const hostPath = resolve(gooseWorkspaceHostDir, 'projects', projectDirectory);
  const relativeHostPath = relative(gooseWorkspaceHostDir, hostPath);
  if (relativeHostPath.startsWith('..') || relativeHostPath === '') {
    throw Object.assign(new Error('Resolved Goose project workspace is invalid.'), { status: 500 });
  }
  return {
    hostPath,
    containerPath: `${gooseWorkingDir.replace(/\/+$/g, '')}/projects/${projectDirectory}`,
  };
};

const mergedAgentSkillsForUser = async (user) => {
  const repoCatalog = loadAgentRepositories();
  const userSkills = await readAgentSkills(user);
  const packageSkillIds = new Set(repoCatalog.skills.map((skill) => skill.id));
  return [...repoCatalog.skills, ...userSkills.filter((skill) => !packageSkillIds.has(skill.id))];
};

const resolvePlannerSkillCatalog = async ({ user, projectId, plannerConfig }) => {
  const skills = await mergedAgentSkillsForUser(user);
  const bindings = await readProjectAgentSkillBindings(user, projectId, skills);
  return resolvePlannerVisibleSkills({ skills, bindings, plannerConfig });
};

const materializeGoosePlannerSkillCatalog = async ({ user, projectId, plannerConfig }) => {
  const workspace = projectGooseWorkspace(projectId);
  const visibleSkills = await resolvePlannerSkillCatalog({ user, projectId, plannerConfig });
  const skillsRoot = join(workspace.hostPath, '.agents', 'skills');
  const catalogRoot = join(workspace.hostPath, '.aissistaint');

  rmSync(skillsRoot, { recursive: true, force: true });
  mkdirSync(skillsRoot, { recursive: true });
  mkdirSync(catalogRoot, { recursive: true });

  for (const skill of visibleSkills) {
    const skillDirectory = join(skillsRoot, plannerSkillDirectoryName(skill.id));
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(join(skillDirectory, 'SKILL.md'), renderPlannerSkillMarkdown(skill), 'utf8');
  }

  writeFileSync(
    join(catalogRoot, 'skill-catalog.json'),
    `${JSON.stringify(renderPlannerSkillCatalog({ projectId, plannerConfig, skills: visibleSkills }), null, 2)}\n`,
    'utf8',
  );

  logAuditEvent({
    event: 'planner_skill_catalog.materialize',
    actor: actorFromPayload(user),
    action: 'materialize',
    resourceType: 'planner_skill_catalog',
    resourceId: projectId,
    outcome: 'success',
    metadata: { skillCount: visibleSkills.length, visibility: plannerConfig?.skillPolicy?.visibility ?? 'project-enabled' },
  });

  return { workspace, visibleSkills };
};

const plannerSystemPromptFromSpec = (spec) => {
  const systemFile = spec?.files?.find((file) => file.path === 'system.md') ?? spec?.files?.find((file) => file.path?.endsWith('/system.md'));
  return String(systemFile?.content ?? '').trim();
};

const loadProjectPlannerContext = async (user, projectId) => {
  const catalog = loadPlannerRepositories();
  const merged = await readMergedPlannerConfig(user, projectId, catalog.specs);
  if (!merged.config || !merged.spec) {
    throw Object.assign(new Error('No planner spec is available.'), { status: 400 });
  }
  const materialized = await materializeGoosePlannerSkillCatalog({
    user,
    projectId,
    plannerConfig: merged.config,
  });
  return {
    ...merged,
    ...materialized,
    systemPrompt: plannerSystemPromptFromSpec(merged.spec),
  };
};

const gooseAcpUrl = () => `${internalGooseUrl}/acp`;

const gooseAcpHeaders = (extra = {}) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  ...(gooseSecretKey ? { 'X-Secret-Key': gooseSecretKey } : {}),
  ...extra,
});

const parseAcpSseMessages = (rawEvent) => {
  const data = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  if (!data || data === '[DONE]') {
    return null;
  }
  return JSON.parse(data);
};

const contentBlockText = (content) => {
  if (!content) {
    return '';
  }
  if (content.type === 'text' && typeof content.text === 'string') {
    return content.text;
  }
  if (Array.isArray(content)) {
    return content.map(contentBlockText).filter(Boolean).join('');
  }
  return '';
};

const extractAcpAgentText = (message) => {
  const params = message?.params ?? {};
  const update = params.update ?? params.sessionUpdate ?? {};
  const kind = update.sessionUpdate ?? update.type;
  if (message?.method !== 'session/update' || kind !== 'agent_message_chunk') {
    return '';
  }
  return contentBlockText(update.content);
};

const createGooseAcpClient = async ({ timeoutMs = 120000 } = {}) => {
  if (!internalGooseUrl) {
    throw new Error('INTERNAL_GOOSE_URL is not configured.');
  }

  let nextRequestId = 1;
  const pending = new Map();
  const assistantText = [];
  const streamController = new AbortController();
  const timeoutHandles = new Set();

  const requestBody = (method, params = {}) => ({
    jsonrpc: '2.0',
    id: nextRequestId++,
    method,
    params,
  });

  const initializeRequest = requestBody('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
  });
  const initializeResponse = await fetch(gooseAcpUrl(), {
    method: 'POST',
    headers: gooseAcpHeaders(),
    body: JSON.stringify(initializeRequest),
  });
  const initializeBody = await jsonResponse(initializeResponse);
  if (!initializeResponse.ok) {
    throw new Error(initializeBody.error?.message ?? initializeBody.error ?? `Goose ACP initialize failed with ${initializeResponse.status}`);
  }
  const connectionId = initializeResponse.headers.get('acp-connection-id');
  if (!connectionId) {
    throw new Error('Goose ACP initialize did not return Acp-Connection-Id.');
  }

  const failPending = (error) => {
    for (const waiter of pending.values()) {
      waiter.reject(error);
      clearTimeout(waiter.timeout);
    }
    pending.clear();
  };

  const sseResponse = await fetch(gooseAcpUrl(), {
    method: 'GET',
    headers: gooseAcpHeaders({
      Accept: 'text/event-stream',
      'Acp-Connection-Id': connectionId,
    }),
    signal: streamController.signal,
  });
  if (!sseResponse.ok || !sseResponse.body) {
    throw new Error(`Goose ACP stream failed with ${sseResponse.status}`);
  }

  const reader = sseResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const streamTask = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let eventEnd;
        while ((eventEnd = buffer.indexOf('\n\n')) >= 0) {
          const rawEvent = buffer.slice(0, eventEnd);
          buffer = buffer.slice(eventEnd + 2);
          const message = parseAcpSseMessages(rawEvent);
          if (!message) {
            continue;
          }
          const chunkText = extractAcpAgentText(message);
          if (chunkText) {
            assistantText.push(chunkText);
          }
          if (message.id !== undefined && pending.has(message.id)) {
            const waiter = pending.get(message.id);
            pending.delete(message.id);
            clearTimeout(waiter.timeout);
            if (message.error) {
              waiter.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
            } else {
              waiter.resolve(message);
            }
          }
        }
      }
    } catch (error) {
      if (!streamController.signal.aborted) {
        failPending(error instanceof Error ? error : new Error('Goose ACP stream failed.'));
      }
    }
  })();

  const send = async (method, params = {}, { sessionId } = {}) => {
    const body = requestBody(method, params);
    const responsePromise = new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        pending.delete(body.id);
        rejectPromise(new Error(`Goose ACP request ${method} timed out.`));
      }, timeoutMs);
      timeoutHandles.add(timeout);
      pending.set(body.id, {
        resolve: (message) => {
          timeoutHandles.delete(timeout);
          resolvePromise(message);
        },
        reject: (error) => {
          timeoutHandles.delete(timeout);
          rejectPromise(error);
        },
        timeout,
      });
    });
    const response = await fetch(gooseAcpUrl(), {
      method: 'POST',
      headers: gooseAcpHeaders({
        'Acp-Connection-Id': connectionId,
        ...(sessionId ? { 'Acp-Session-Id': sessionId } : {}),
      }),
      body: JSON.stringify(body),
    });
    if (![200, 202].includes(response.status)) {
      pending.delete(body.id);
      const text = await response.text();
      throw new Error(text || `Goose ACP ${method} failed with ${response.status}`);
    }
    if (response.status === 200) {
      const waiter = pending.get(body.id);
      if (waiter) {
        pending.delete(body.id);
        clearTimeout(waiter.timeout);
      }
      return jsonResponse(response);
    }
    return responsePromise;
  };

  const close = async () => {
    streamController.abort();
    for (const timeout of timeoutHandles) {
      clearTimeout(timeout);
    }
    timeoutHandles.clear();
    pending.clear();
    try {
      await fetch(gooseAcpUrl(), {
        method: 'DELETE',
        headers: gooseAcpHeaders({ 'Acp-Connection-Id': connectionId }),
      });
    } catch {
      // Connection cleanup is best effort.
    }
    try {
      await streamTask;
    } catch {
      // The stream normally errors when aborted locally.
    }
  };

  return {
    send,
    close,
    getAssistantText: () => assistantText.join('').trim(),
  };
};

const testGoosePlannerAdapter = async (spec) => {
  const restartRequiredKeys = spec?.runtime?.restartRequiredKeys ?? [];
  const result = {
    engine: spec?.engine ?? 'goose',
    reachable: false,
    restartRequired: restartRequiredKeys.length > 0,
    restartRequiredKeys,
    message: '',
  };

  if (spec?.engine !== 'goose') {
    return { ...result, reachable: true, restartRequired: false, message: 'No Goose validation is required for this planner engine.' };
  }
  if (!internalGooseUrl) {
    return { ...result, message: 'INTERNAL_GOOSE_URL is not configured.' };
  }

  let client;
  try {
    client = await createGooseAcpClient({ timeoutMs: 10000 });
    const session = await client.send('session/new', { cwd: gooseWorkingDir, mcpServers: [] });
    const sessionId = session?.result?.sessionId;
    return {
      ...result,
      reachable: Boolean(sessionId),
      message: sessionId ? 'Goose accepted an ACP session/new request.' : 'Goose ACP session/new did not return a session id.',
    };
  } catch (error) {
    return {
      ...result,
      message: error instanceof Error ? error.message : 'Failed to reach Goose.',
    };
  } finally {
    await client?.close();
  }
};

const chatCompletionsUrl = (baseUrl) => {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }

  return `${trimmed}/chat/completions`;
};

const indexFromConfig = (config) => {
  const source = `${config.secretName ?? ''} ${config.id ?? ''}`;
  const match = source.match(/endpoints\/(\d+)|openbao-llm-(\d+)/);
  const parsed = Number.parseInt(match?.[1] ?? match?.[2] ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed - 1 : 0;
};

const loadRunnableLlmConfig = async (user, config) => {
  const index = Math.min(indexFromConfig(config), llmEndpointCount - 1);
  const existingSecret = await secretStoreRead(secretPath(user, index));
  const existingData = existingSecret?.data?.data ?? {};
  const endpoint = config.endpoint || existingData.endpoint || '';
  const model = config.model || existingData.model || '';
  const hasToken = Boolean(config.token || existingData.encryptedToken || existingData.token);

  if (!endpoint.startsWith('http')) {
    throw new Error('Provider base URL must start with http:// or https://.');
  }

  await validateLlmEndpoint(endpoint);

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
  if (!liteLlmAdminBrokerToken) {
    throw new Error('LiteLLM admin broker token is not configured on the backend.');
  }

  const modelAlias = liteLlmModelAlias(user, index);
  const response = await fetch(`${liteLlmAdminBrokerUrl}/internal/litellm/models`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${liteLlmAdminBrokerToken}`,
    },
    body: JSON.stringify({
      modelAlias,
      model,
      endpoint,
      secretReference: liteLlmSecretReference(user, index),
    }),
  });
  const body = await jsonResponse(response);
  log('LiteLLM model configuration broker request', {
    modelAlias,
    status: response.status,
  });
  logAuditEvent({
    event: 'litellm_model.configure',
    actor: actorFromPayload(user),
    action: 'configure',
    resourceType: 'litellm_model',
    resourceId: modelAlias,
    outcome: response.ok ? 'success' : 'failure',
    metadata: { status: response.status, endpoint: systemLlmName(index) },
  });

  if (!response.ok) {
    throw new Error(body.error ?? body.raw ?? `LiteLLM model configuration failed with ${response.status}`);
  }

  return modelAlias;
};

const callLlmChatEndpoint = async (
  { modelAlias },
  messages,
  { maxTokens = 128, temperature = 0 } = {},
) => {
  if (!liteLlmApiKey) {
    throw new Error('LiteLLM API key is not configured on the backend.');
  }

  const chatMessages = Array.isArray(messages)
    ? messages
    : [
        {
          role: 'user',
          content: String(messages ?? ''),
        },
      ];
  const url = `${liteLlmUrl}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), llmRequestTimeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${liteLlmApiKey}`,
      },
      body: JSON.stringify({
        model: modelAlias,
        messages: chatMessages,
        max_tokens: maxTokens,
        temperature,
      }),
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`LiteLLM chat request timed out after ${llmRequestTimeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const body = await jsonResponse(response);
  log('LiteLLM chat request', {
    endpoint: liteLlmUrl,
    modelAlias,
    status: response.status,
  });

  if (!response.ok) {
    if (response.status >= 300 && response.status < 400) {
      throw new Error('LLM endpoint redirects are not allowed.');
    }
    throw new Error(body.error?.message ?? body.error ?? body.raw ?? `LLM endpoint failed with ${response.status}`);
  }

  return body;
};

const extractLlmAnswer = (body) =>
  body.choices?.[0]?.message?.content ??
  body.choices?.[0]?.text ??
  body.output_text ??
  body.response ??
  JSON.stringify(body);

const normalizeChatRole = (role) => {
  const normalized = String(role ?? '').toLowerCase();
  return ['system', 'user', 'assistant'].includes(normalized) ? normalized : 'user';
};

const sanitizeGooseMessages = (messages) => {
  if (!Array.isArray(messages)) {
    throw Object.assign(new Error('Messages must be an array.'), { status: 400 });
  }

  const boundedMaxMessages = Number.isFinite(gooseChatbotMaxMessages) && gooseChatbotMaxMessages > 0 ? gooseChatbotMaxMessages : 24;
  const sanitized = messages
    .slice(-boundedMaxMessages)
    .map((message) => ({
      role: normalizeChatRole(message?.role),
      content: String(message?.content ?? message?.text ?? '').trim(),
    }))
    .filter((message) => message.content);

  if (sanitized.length === 0 || !sanitized.some((message) => message.role === 'user')) {
    throw Object.assign(new Error('At least one user message is required.'), { status: 400 });
  }

  return sanitized;
};

const gooseTierIndex = (tier) => {
  const requestedTier = String(tier || gooseChatbotDefaultTier).toLowerCase();
  const index = configuredLlmTiers.indexOf(requestedTier);
  return index >= 0 ? index : 0;
};

const loadGooseChatbotConfig = async (user, tier) => {
  const index = gooseTierIndex(tier);
  return loadRunnableLlmConfig(user, { id: `openbao-llm-${index + 1}` });
};

const gooseMessage = (message) => ({
  id: message.id ?? randomUUID(),
  role: message.role === 'assistant' ? 'assistant' : 'user',
  created: Math.floor(Date.now() / 1000),
  content: [
    {
      type: 'text',
      text: message.content,
    },
  ],
  metadata: {
    userVisible: message.role !== 'system',
    agentVisible: true,
  },
});

const extractGooseText = (message) =>
  (message?.content ?? [])
    .filter((content) => content?.type === 'text' && typeof content.text === 'string')
    .map((content) => content.text)
    .join('');

const parseGooseSseAnswer = (text) => {
  const assistantMessages = [];
  let errorMessage = '';

  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) {
      continue;
    }

    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') {
      continue;
    }

    try {
      const event = JSON.parse(payload);
      if (event.type === 'Error') {
        errorMessage = event.error || errorMessage;
      }
      if (event.type === 'Message' && event.message?.role === 'assistant') {
        const content = extractGooseText(event.message);
        if (content) {
          assistantMessages.push(content);
        }
      }
    } catch {
      // Ignore malformed keepalive/event lines from Goose.
    }
  }

  if (errorMessage) {
    throw new Error(errorMessage);
  }

  return assistantMessages.join('\n').trim();
};

const callGooseChatEndpoint = async ({ modelAlias }, messages, { workingDir = gooseWorkingDir } = {}) => {
  const client = await createGooseAcpClient();
  const session = await client.send('session/new', { cwd: workingDir, mcpServers: [] });
  const sessionId = session?.result?.sessionId;
  const systemContext = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .filter(Boolean)
    .join('\n\n');
  const visibleMessages = messages.filter((message) => message.role !== 'system');
  const latestUserMessage = [...visibleMessages].reverse().find((message) => message.role === 'user');
  if (!sessionId || !latestUserMessage) {
    await client.close();
    throw new Error('Goose agent did not return a session or no user message was provided.');
  }

  const priorConversation = visibleMessages
    .filter((message) => message.id !== latestUserMessage.id)
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n\n');

  try {
    await client.send(
      'session/prompt',
      {
        sessionId,
        prompt: [
          {
            type: 'text',
            text: [
              systemContext,
              priorConversation ? `Prior conversation:\n${priorConversation}` : '',
              `User request:\n${latestUserMessage.content}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
      },
      { sessionId },
    );
    const answer = client.getAssistantText();
    if (!answer) {
      throw new Error(`Goose returned an empty response for ${modelAlias}.`);
    }
    return { answer, sessionId };
  } finally {
    await client.close();
  }
};

const toLlmConfig = async (user, index) => {
  const path = secretPath(user, index);

  try {
    const [secret, metadata] = await Promise.all([
      secretStoreRead(path),
      openBaoFetchOptional(metadataApiPath(user, index)),
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
        secretName: `${openBaoKvMount}/data/${path}`,
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
      secretName: `${openBaoKvMount}/data/${path}`,
      secretVersion: meta.current_version,
      secretCreatedAt: meta.created_time,
      secretUpdatedAt: meta.updated_time,
      secretLastRetrievedAt: new Date().toISOString(),
      secretLeaseStatus: secret ? 'retrieved' : 'none',
      tokenStored,
      tokenPreview: tokenStored ? 'stored' : undefined,
    };
  } catch (error) {
    return {
      id: `openbao-llm-${index + 1}`,
      name: systemLlmName(index),
      endpoint: '',
      model: '',
      modelAlias: liteLlmModelAlias(user, index),
      token: '',
      tier: defaultTier(index),
      status: 'idle',
      secretName: `${openBaoKvMount}/data/${path}`,
      secretLeaseStatus: 'none',
    };
  }
};

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/health/details', requireAuth, requireAdmin, (_request, response) => {
  response.json({
    ok: true,
    issuer,
    keycloakJwksUrl: `${keycloakInternalUrl}/realms/${keycloakRealm}/protocol/openid-connect/certs`,
    openBaoUrl,
    openBaoKvMount,
    openBaoPrefix,
    liteLlmUrl,
    appDatabaseConfigured: Boolean(appDatabaseUrl),
  });
});

app.get('/internal/litellm/secrets/:modelAlias', async (request, response, next) => {
  try {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!liteLlmSecretBrokerToken || token !== liteLlmSecretBrokerToken) {
      logAuditEvent({
        event: 'litellm_secret.read',
        actor: 'litellm',
        action: 'read',
        resourceType: 'litellm_secret',
        resourceId: request.params.modelAlias,
        outcome: 'denied',
      });
      response.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const modelAlias = request.params.modelAlias;
    if (!isAllowedLiteLlmAlias(modelAlias)) {
      logAuditEvent({
        event: 'litellm_secret.read',
        actor: 'litellm',
        action: 'read',
        resourceType: 'litellm_secret',
        resourceId: modelAlias,
        outcome: 'denied',
        metadata: { reason: 'invalid_alias' },
      });
      response.status(400).json({ error: 'Model alias is outside the allowed AIssistAInt namespace.' });
      return;
    }

    const aliasRecord = await secretStoreRead(aliasPath(modelAlias));
    const secretPathForAlias = aliasRecord?.data?.data?.secretPath;
    if (!secretPathForAlias) {
      response.status(404).json({ error: 'Secret alias not found.' });
      return;
    }

    const secretRecord = await secretStoreRead(secretPathForAlias);
    const secretData = secretRecord?.data?.data ?? {};
    const value = decryptProviderToken(secretData, providerTokenAad(secretPathForAlias));
    log('LiteLLM secret broker request', { modelAlias, status: 200 });
    logAuditEvent({
      event: 'litellm_secret.read',
      actor: 'litellm',
      action: 'read',
      resourceType: 'litellm_secret',
      resourceId: modelAlias,
      outcome: 'success',
    });
    response.json({ value });
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects', requireAuth, async (request, response, next) => {
  try {
    const db = await requireProjectDb();
    const result =
      isAdmin(request.user) || isRemovalAgent(request.user)
        ? await db.query(`
          SELECT id, name, description, status, bucket_name, loaded_prefix, parsed_prefix, metadata_object_key, created_by, created_at, updated_at
          FROM projects
          ORDER BY updated_at DESC, created_at DESC
        `)
        : await db.query(
            `
              SELECT p.id, p.name, p.description, p.status, p.bucket_name, p.loaded_prefix, p.parsed_prefix, p.metadata_object_key, p.created_by, p.created_at, p.updated_at
              FROM projects p
              INNER JOIN project_members pm ON pm.project_id = p.id
              WHERE pm.user_subject = $1
              ORDER BY p.updated_at DESC, p.created_at DESC
            `,
            [userSubject(request)],
          );
    log('GET /api/projects', { count: result.rowCount });
    response.json({ projects: result.rows.map(toProject) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects', requireAuth, async (request, response, next) => {
  try {
    const db = await requireProjectDb();
    const name = String(request.body?.name ?? '').trim();
    const description = String(request.body?.description ?? '').trim();
    const subject = userSubject(request);

    if (!name) {
      response.status(400).json({ error: 'Project name is required.' });
      return;
    }

    const projectId = randomUUID();
    const bucketName = projectBucketName(projectId, name);
    const loadedPrefix = objectPrefix(projectLoadedPrefix);
    const parsedPrefix = objectPrefix(projectParsedPrefix);
    const metadataObjectKey = objectKey(projectMetadataObjectKey);
    await ensureProjectBucket({ bucketName, loadedPrefix, parsedPrefix });

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `
          INSERT INTO projects (id, name, description, bucket_name, loaded_prefix, parsed_prefix, metadata_object_key, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, name, description, status, bucket_name, loaded_prefix, parsed_prefix, metadata_object_key, created_by, created_at, updated_at
        `,
        [projectId, name, description, bucketName, loadedPrefix, parsedPrefix, metadataObjectKey, subject],
      );
      await client.query(
        `
          INSERT INTO project_members (project_id, user_subject, role)
          VALUES ($1, $2, 'owner')
          ON CONFLICT (project_id, user_subject) DO UPDATE SET role = EXCLUDED.role
        `,
        [result.rows[0].id, subject],
      );
      await writeProjectMetadataObject(toProject(result.rows[0]));
      await client.query('COMMIT');
      log('POST /api/projects', { id: result.rows[0].id, name, bucketName });
      response.status(201).json({ project: toProject(result.rows[0]) });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

app.patch('/api/projects/:id', requireAuth, async (request, response, next) => {
  try {
    const db = await requireProjectDb();
    const id = request.params.id;
    const name = request.body?.name === undefined ? undefined : String(request.body.name).trim();
    const description =
      request.body?.description === undefined ? undefined : String(request.body.description).trim();
    const status = request.body?.status === undefined ? undefined : String(request.body.status).trim();

    if (name === '') {
      response.status(400).json({ error: 'Project name cannot be blank.' });
      return;
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await requireProjectRole(client, id, request, ['owner', 'editor']);
      const result = await client.query(
        `
          UPDATE projects
          SET
            name = COALESCE($2, name),
            description = COALESCE($3, description),
            status = COALESCE($4, status),
            updated_at = now()
          WHERE id = $1
          RETURNING id, name, description, status, bucket_name, loaded_prefix, parsed_prefix, metadata_object_key, created_by, created_at, updated_at
        `,
        [id, name, description, status],
      );

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        response.status(404).json({ error: 'Project not found.' });
        return;
      }

      const project = toProject(result.rows[0]);
      await writeProjectMetadataObject(project);
      await client.query('COMMIT');
      log('PATCH /api/projects/:id', { id, metadataObjectKey: project.metadataObjectKey });
      response.json({ project });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

app.delete('/api/projects/:id', requireAuth, requireProjectDeletionRole, async (request, response, next) => {
  try {
    const db = await requireProjectDb();
    const id = request.params.id;
    const client = await db.connect();

    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `
          SELECT id, name, description, status, bucket_name, loaded_prefix, parsed_prefix, metadata_object_key, created_by, created_at, updated_at
          FROM projects
          WHERE id = $1
        `,
        [id],
      );

      if (existing.rowCount === 0) {
        await client.query('ROLLBACK');
        response.status(404).json({ error: 'Project not found.' });
        return;
      }

      const project = toProject(existing.rows[0]);
      if (project.bucketName) {
        await writeProjectMetadataObject({
          ...project,
          status: 'deleted',
          deletedAt: new Date().toISOString(),
        });
        await restrictDeletedProjectBucket(project.bucketName);
      }

      await client.query('DELETE FROM projects WHERE id = $1', [id]);
      await client.query('COMMIT');
      log('DELETE /api/projects/:id', { id, bucketName: project.bucketName });
      logAuditEvent({
        event: 'project.delete',
        actor: userSubject(request),
        action: 'delete',
        resourceType: 'project',
        resourceId: id,
        outcome: 'success',
        metadata: { bucketName: project.bucketName, status: 'deleted' },
      });
      response.status(204).send();
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

const requireProjectAccess = async (projectId, request, allowedRoles) => {
  const db = await requireProjectDb();
  const client = await db.connect();
  try {
    await requireProjectRole(client, projectId, request, allowedRoles);
    const result = await client.query(
      `
        SELECT id, name, description, status, bucket_name, loaded_prefix, parsed_prefix, metadata_object_key, created_by, created_at, updated_at
        FROM projects
        WHERE id = $1
      `,
      [projectId],
    );
    if (result.rowCount === 0) {
      throw Object.assign(new Error('Project not found.'), { status: 404 });
    }
    return toProject(result.rows[0]);
  } finally {
    client.release();
  }
};

const requireProjectMinio = (project) => {
  if (!minioClient) {
    throw Object.assign(new Error('MinIO credentials are not configured on the backend.'), { status: 503 });
  }
  if (!project.bucketName) {
    throw Object.assign(new Error('Project does not have a MinIO bucket configured.'), { status: 400 });
  }
  return minioClient;
};

const loadPaperqaRuntime = async (user) => {
  const tierIndex = Math.max(0, configuredLlmTiers.indexOf(paperqaLlmTier));
  const llmConfig = await loadRunnableLlmConfig(user, { id: `openbao-llm-${tierIndex + 1}` });
  const modelAlias = liteLlmModelAlias(user, tierIndex);
  if (!paperqaLitellmApiKey?.trim()) {
    throw Object.assign(
      new Error(
        'LITELLM_API_KEY is not configured on the API. Set it in platform runtime env before processing papers.',
      ),
      { status: 503 },
    );
  }
  const litellmRuntime = buildPaperqaLitellmRuntime({
    llmConfig,
    modelAlias,
    litellmUrl: paperqaLitellmUrl,
    tier: llmConfig.tier ?? defaultTier(tierIndex),
  });
  return {
    llmModel: modelAlias,
    summaryLlmModel: modelAlias,
    embeddingModel: paperqaEmbeddingModel,
    litellmUrl: paperqaLitellmUrl,
    litellmApiKey: paperqaLitellmApiKey,
    litellmRuntime,
  };
};

app.get('/api/projects/:id/files', requireAuth, async (request, response, next) => {
  try {
    const project = await requireProjectAccess(request.params.id, request, ['owner', 'editor', 'viewer']);
    const client = requireProjectMinio(project);
    const files = await listProjectFiles(client, project);
    log('GET /api/projects/:id/files', { projectId: project.id, count: files.length, bucketName: project.bucketName });
    logAuditEvent({
      event: 'project_file.list',
      actor: userSubject(request),
      action: 'read',
      resourceType: 'project_file',
      resourceId: project.id,
      outcome: 'success',
      metadata: { count: files.length, bucketName: project.bucketName },
    });
    response.json({ files });
  } catch (error) {
    next(error);
  }
});

app.post(
  '/api/projects/:id/files',
  requireAuth,
  projectUpload.array('files'),
  async (request, response, next) => {
    try {
      const uploads = Array.isArray(request.files) ? request.files : [];
      if (uploads.length === 0) {
        response.status(400).json({ error: 'At least one PDF file is required.' });
        return;
      }
      const project = await requireProjectAccess(request.params.id, request, ['owner', 'editor']);
      const client = requireProjectMinio(project);
      const files = await uploadProjectFiles(client, project, uploads);
      log('POST /api/projects/:id/files', {
        projectId: project.id,
        count: files.length,
        bucketName: project.bucketName,
        totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      });
      logAuditEvent({
        event: 'project_file.upload',
        actor: userSubject(request),
        action: 'upload',
        resourceType: 'project_file',
        resourceId: project.id,
        outcome: 'success',
        metadata: { count: files.length, bucketName: project.bucketName },
      });
      response.status(201).json({ files });
    } catch (error) {
      next(error);
    }
  },
);

app.post('/api/projects/:id/files/process', requireAuth, async (request, response, next) => {
  try {
    const fileIds = Array.isArray(request.body?.fileIds)
      ? request.body.fileIds.map((value) => String(value))
      : [];
    if (fileIds.length === 0) {
      response.status(400).json({ error: 'Select at least one file to process.' });
      return;
    }
    const project = await requireProjectAccess(request.params.id, request, ['owner', 'editor']);
    const client = requireProjectMinio(project);
    const indexed = new Map((await listProjectFiles(client, project)).map((file) => [file.id, file]));
    const selected = fileIds.map((id) => indexed.get(id)).filter(Boolean);
    if (selected.length === 0) {
      response.status(404).json({ error: 'No matching uploaded files were found for this project.' });
      return;
    }

    const paperqaRuntime = await loadPaperqaRuntime(request.user);
    const ingestWiki = request.body?.ingestWiki !== false && paperqaIngestWiki;
    const wikiStorage = ingestWiki ? wikiStorageForProject(project) : null;
    const wikiLlmConfig = ingestWiki ? await loadWikiLlmConfig(request.user) : null;

    const repoCatalog = loadAgentRepositories();
    const userSkills = await readAgentSkills(request.user);
    const packageSkillIds = new Set(repoCatalog.skills.map((skill) => skill.id));
    const skillsForBindings = [
      ...repoCatalog.skills,
      ...userSkills.filter((skill) => !packageSkillIds.has(skill.id)),
    ];
    const skillBindings = await readProjectAgentSkillBindings(request.user, project.id, skillsForBindings);
    const paperReaderBinding = skillBindings.find(
      (binding) => binding.skillId === PAPER_READER_SKILL_ID && binding.enabled,
    );
    const paperReaderProcessing = await resolvePaperReaderProcessing(paperReaderBinding);

    const job = createProjectProcessJob({
      projectId: project.id,
      userId: userSubject(request),
      fileIds: selected.map((file) => file.id),
      fileNames: Object.fromEntries(selected.map((file) => [file.id, file.name])),
    });

    log('POST /api/projects/:id/files/process start', {
      projectId: project.id,
      jobId: job.id,
      fileCount: selected.length,
      bucketName: project.bucketName,
      litellmModelAlias: paperqaRuntime.litellmRuntime.modelAlias,
      litellmUrl: paperqaRuntime.litellmRuntime.litellmUrl,
      providerModel: paperqaRuntime.litellmRuntime.providerModel,
      hasLitellmApiKey: Boolean(paperqaRuntime.litellmApiKey),
    });

    void runProjectFileProcessJob({
      jobId: job.id,
      project,
      client,
      selected,
      paperqaRuntime,
      paperReaderProcessing,
      ingestWiki,
      wikiStorage,
      wikiLlmConfig,
      callLlmChatEndpoint,
      extractLlmAnswer,
      mirrorLog: (event, payload) => log(event, payload),
    })
      .then(({ processed, failures, wikiPages }) => {
        log('POST /api/projects/:id/files/process complete', {
          projectId: project.id,
          jobId: job.id,
          count: processed.length,
          failureCount: failures.length,
          wikiPageCount: wikiPages.length,
          bucketName: project.bucketName,
        });
        logAuditEvent({
          event: 'project_file.process',
          actor: userSubject(request),
          action: 'process',
          resourceType: 'project_file',
          resourceId: project.id,
          outcome: failures.length ? 'partial' : 'success',
          metadata: {
            jobId: job.id,
            count: processed.length,
            failureCount: failures.length,
            wikiPageCount: wikiPages.length,
            bucketName: project.bucketName,
          },
        });
      })
      .catch((error) => {
        log('POST /api/projects/:id/files/process job error', {
          projectId: project.id,
          jobId: job.id,
          error: error instanceof Error ? error.message : 'Processing failed.',
        });
      });

    response.status(202).json({ jobId: job.id, status: 'running' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:id/files/process/jobs', requireAuth, async (request, response, next) => {
  try {
    const project = await requireProjectAccess(request.params.id, request, ['owner', 'editor', 'viewer']);
    const fileId = typeof request.query.fileId === 'string' ? request.query.fileId : undefined;
    const jobs = listProjectProcessJobs(project.id, { fileId });
    response.json({ jobs });
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:id/files/process/jobs/:jobId', requireAuth, async (request, response, next) => {
  try {
    const project = await requireProjectAccess(request.params.id, request, ['owner', 'editor', 'viewer']);
    const job = getProjectProcessJob(request.params.jobId);
    if (!job || job.projectId !== project.id) {
      response.status(404).json({ error: 'Processing job not found.' });
      return;
    }
    if (job.userId !== userSubject(request)) {
      response.status(403).json({ error: 'You do not have access to this processing job.' });
      return;
    }
    response.json({ job: serializeProjectProcessJob(job) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:id/files/:fileId/process-log', requireAuth, async (request, response, next) => {
  try {
    const project = await requireProjectAccess(request.params.id, request, ['owner', 'editor', 'viewer']);
    const client = requireProjectMinio(project);
    const files = await listProjectFiles(client, project);
    const file = files.find((entry) => entry.id === request.params.fileId);
    if (!file) {
      response.status(404).json({ error: 'File not found in this project.' });
      return;
    }

    const stem = parsedStemFromObjectKey(file.objectKey);
    const objectKey = processLogObjectKey(project, stem);
    const logText = await readProcessLogFromStorage(client, project, file);
    if (logText !== null) {
      response.json({
        fileId: file.id,
        fileName: file.name,
        log: logText,
        source: 'minio',
        objectKey,
        parsedPrefix: project.parsedPrefix ?? 'parsed',
      });
      return;
    }

    const jobLog = findFileLogFromJobs(project.id, file.id);
    if (jobLog?.lines?.length) {
      response.json({
        fileId: file.id,
        fileName: file.name,
        log: jobLog.lines.join('\n'),
        source: 'job',
        jobId: jobLog.jobId,
        jobStatus: jobLog.jobStatus,
        fileLogStatus: jobLog.status,
      });
      return;
    }

    response.status(404).json({
      error:
        'No process log found for this file. If the server restarted or the job crashed before a checkpoint, logs may be lost. Re-run Process to generate a new log.',
    });
  } catch (error) {
    next(error);
  }
});

const requireProjectForWiki = requireProjectAccess;

const wikiStorageForProject = (project) => {
  if (!minioClient) {
    throw Object.assign(new Error('MinIO credentials are not configured on the backend.'), { status: 503 });
  }
  if (!project?.bucketName) {
    throw Object.assign(new Error('Project does not have a MinIO bucket configured.'), { status: 400 });
  }
  return createWikiStorage({
    client: minioClient,
    bucket: project.bucketName,
    wikiPrefix: wikiBucketPrefix,
    metadataPrefix: wikiMetadataPrefix,
  });
};

const loadWikiLlmConfig = async (user) => {
  const tier = wikiDefaultTier;
  const index = configuredLlmTiers.indexOf(tier);
  const safeIndex = index >= 0 ? index : 0;
  try {
    return await loadRunnableLlmConfig(user, { id: `openbao-llm-${safeIndex + 1}` });
  } catch (error) {
    log('Wiki LLM tier unavailable; falling back to heuristic synthesis', {
      tier,
      detail: error instanceof Error ? error.message : 'Unknown LLM lookup error.',
    });
    return null;
  }
};

const wikiPageSummary = ({ key, ref, page }) => ({
  key,
  category: ref.category,
  slug: ref.slug,
  title: page.frontmatter?.title ?? ref.slug,
  updated: page.frontmatter?.updated ?? null,
  created: page.frontmatter?.created ?? null,
  sources: Array.isArray(page.frontmatter?.sources) ? page.frontmatter.sources : [],
  related: Array.isArray(page.frontmatter?.related) ? page.frontmatter.related : [],
  confidence: page.frontmatter?.confidence ?? null,
});

const isValidWikiCategory = (value) => wikiCategories.includes(String(value ?? '').toLowerCase());

app.get('/api/projects/:id/wiki/pages', requireAuth, async (request, response, next) => {
  try {
    const project = await requireProjectForWiki(request.params.id, request, ['owner', 'editor', 'viewer']);
    const storage = wikiStorageForProject(project);
    const refs = await storage.listPageRefs();
    const summaries = [];
    for (const ref of refs) {
      const markdown = await storage.readPageMarkdown(ref.category, ref.slug);
      if (!markdown) {
        continue;
      }
      const page = wikiParsePage(markdown, {
        fallbackCategory: ref.category,
        fallbackSlug: ref.slug,
        fallbackTitle: ref.slug,
      });
      summaries.push(wikiPageSummary({ key: storage.pageKey(ref.category, ref.slug), ref, page }));
    }
    summaries.sort((a, b) => String(b.updated ?? '').localeCompare(String(a.updated ?? '')));
    logAuditEvent({
      event: 'wiki.list',
      actor: userSubject(request),
      action: 'read',
      resourceType: 'wiki_page',
      resourceId: project.id,
      outcome: 'success',
      metadata: { pageCount: summaries.length },
    });
    response.json({ pages: summaries, categories: wikiCategories });
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:id/wiki/pages/:category/:slug', requireAuth, async (request, response, next) => {
  try {
    const { category, slug } = request.params;
    if (!isValidWikiCategory(category)) {
      response.status(400).json({ error: 'Unsupported wiki category.' });
      return;
    }
    const project = await requireProjectForWiki(request.params.id, request, ['owner', 'editor', 'viewer']);
    const storage = wikiStorageForProject(project);
    const markdown = await storage.readPageMarkdown(category, slug);
    if (!markdown) {
      response.status(404).json({ error: 'Wiki page not found.' });
      return;
    }
    const page = wikiParsePage(markdown, {
      fallbackCategory: category,
      fallbackSlug: slug,
      fallbackTitle: slug,
    });
    const backlinkIndex = (await storage.readMetadataJson('backlinks.json', { entries: {} }))?.entries ?? {};
    const provenanceIndex = (await storage.readMetadataJson('provenance.json', { entries: {} }))?.entries ?? {};
    const pageKey = wikiPageRefKey({ category, slug });
    logAuditEvent({
      event: 'wiki.read',
      actor: userSubject(request),
      action: 'read',
      resourceType: 'wiki_page',
      resourceId: `${project.id}:${pageKey}`,
      outcome: 'success',
    });
    response.json({
      page: {
        key: storage.pageKey(category, slug),
        category: wikiNormalizeCategory(category),
        slug: wikiSlugifyTitle(slug),
        frontmatter: page.frontmatter,
        body: page.body,
        markdown,
      },
      backlinks: backlinkIndex[pageKey] ?? [],
      provenance: provenanceIndex[pageKey] ?? [],
    });
  } catch (error) {
    next(error);
  }
});

app.put('/api/projects/:id/wiki/pages/:category/:slug', requireAuth, async (request, response, next) => {
  try {
    const { category, slug } = request.params;
    if (!isValidWikiCategory(category)) {
      response.status(400).json({ error: 'Unsupported wiki category.' });
      return;
    }
    const markdown = String(request.body?.markdown ?? '');
    if (!markdown.trim()) {
      response.status(400).json({ error: 'Wiki page markdown is required.' });
      return;
    }
    if (Buffer.byteLength(markdown, 'utf8') > wikiMaxPageBytes) {
      response.status(413).json({ error: `Wiki page exceeds ${wikiMaxPageBytes} bytes.` });
      return;
    }
    const project = await requireProjectForWiki(request.params.id, request, ['owner', 'editor']);
    const storage = wikiStorageForProject(project);
    const page = wikiParsePage(markdown, {
      fallbackCategory: category,
      fallbackSlug: slug,
      fallbackTitle: slug,
    });
    page.frontmatter.updated = new Date().toISOString();
    if (!page.frontmatter.created) {
      page.frontmatter.created = page.frontmatter.updated;
    }
    page.frontmatter.category = wikiNormalizeCategory(category);
    page.frontmatter.slug = wikiSlugifyTitle(slug);
    await storage.writePageMarkdown(category, slug, markdown);
    logAuditEvent({
      event: 'wiki.write',
      actor: userSubject(request),
      action: 'write',
      resourceType: 'wiki_page',
      resourceId: `${project.id}:${wikiPageRefKey({ category, slug })}`,
      outcome: 'success',
      metadata: { bytes: Buffer.byteLength(markdown, 'utf8') },
    });
    response.json({
      page: {
        key: storage.pageKey(category, slug),
        category: wikiNormalizeCategory(category),
        slug: wikiSlugifyTitle(slug),
        frontmatter: page.frontmatter,
        body: page.body,
        markdown,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/projects/:id/wiki/pages/:category/:slug', requireAuth, async (request, response, next) => {
  try {
    const { category, slug } = request.params;
    if (!isValidWikiCategory(category)) {
      response.status(400).json({ error: 'Unsupported wiki category.' });
      return;
    }
    const project = await requireProjectForWiki(request.params.id, request, ['owner', 'editor']);
    const storage = wikiStorageForProject(project);
    await storage.deletePage(category, slug);
    logAuditEvent({
      event: 'wiki.delete',
      actor: userSubject(request),
      action: 'delete',
      resourceType: 'wiki_page',
      resourceId: `${project.id}:${wikiPageRefKey({ category, slug })}`,
      outcome: 'success',
    });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:id/wiki/sources', requireAuth, async (request, response, next) => {
  try {
    const project = await requireProjectForWiki(request.params.id, request, ['owner', 'editor', 'viewer']);
    const client = requireProjectMinio(project);
    const storage = wikiStorageForProject(project);
    const sources = await listWikiProcessedSources({ client, project, storage });
    response.json({
      sources,
      autoIngestOnProcess: paperqaIngestWiki,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects/:id/wiki/sync-processed', requireAuth, async (request, response, next) => {
  try {
    const project = await requireProjectForWiki(request.params.id, request, ['owner', 'editor']);
    const client = requireProjectMinio(project);
    const storage = wikiStorageForProject(project);
    const fileIds = Array.isArray(request.body?.fileIds)
      ? request.body.fileIds.map((id) => String(id).trim()).filter(Boolean)
      : undefined;
    const llmConfig = await loadWikiLlmConfig(request.user);
    const result = await syncProcessedFilesToWiki({
      client,
      project,
      storage,
      fileIds,
      llmConfig,
      callLlmChatEndpoint: llmConfig ? callLlmChatEndpoint : undefined,
      extractLlmAnswer: llmConfig ? extractLlmAnswer : undefined,
      logger: { warn: (message, details) => log(`Wiki sync warning: ${message}`, details ?? {}) },
    });

    logAuditEvent({
      event: 'wiki.sync_processed',
      actor: userSubject(request),
      action: 'ingest',
      resourceType: 'project_file',
      resourceId: project.id,
      outcome: result.errors.length ? 'partial' : 'success',
      metadata: {
        ingested: result.ingested.length,
        skipped: result.skipped.length,
        errors: result.errors.length,
      },
    });

    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects/:id/wiki/ingest/:fileId', requireAuth, async (request, response, next) => {
  try {
    const project = await requireProjectForWiki(request.params.id, request, ['owner', 'editor']);
    const client = requireProjectMinio(project);
    const storage = wikiStorageForProject(project);
    const files = await listProjectFiles(client, project);
    const file = files.find((entry) => entry.id === request.params.fileId);
    if (!file) {
      response.status(404).json({ error: 'File not found in this project.' });
      return;
    }
    const llmConfig = await loadWikiLlmConfig(request.user);
    const result = await ingestProcessedFileToWiki({
      client,
      project,
      file,
      storage,
      llmConfig,
      callLlmChatEndpoint: llmConfig ? callLlmChatEndpoint : undefined,
      extractLlmAnswer: llmConfig ? extractLlmAnswer : undefined,
      logger: { warn: (message, details) => log(`Wiki ingest warning: ${message}`, details ?? {}) },
    });

    logAuditEvent({
      event: 'wiki.ingest_processed',
      actor: userSubject(request),
      action: 'ingest',
      resourceType: 'wiki_page',
      resourceId: `${project.id}:${result.pageKey}`,
      outcome: 'success',
      metadata: { fileId: file.id, sourceId: file.id, fallback: result.suggestion?.fallback },
    });

    response.json({
      pageKey: result.pageKey,
      category: result.category,
      slug: result.slug,
      sectionId: result.sectionId,
      createdStubs: result.createdStubs,
      suggestion: result.suggestion,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects/:id/wiki/ingest', requireAuth, async (request, response, next) => {
  try {
    const project = await requireProjectForWiki(request.params.id, request, ['owner', 'editor']);
    const storage = wikiStorageForProject(project);

    const sourceId = String(request.body?.sourceId ?? '').trim() || `manual-${randomUUID()}`;
    const title = String(request.body?.title ?? '').trim() || sourceId;
    const suggestedCategory = isValidWikiCategory(request.body?.category)
      ? request.body.category
      : defaultWikiCategory;
    const explicitSlug = request.body?.slug ? wikiSlugifyTitle(String(request.body.slug)) : undefined;

    const rawChunks = Array.isArray(request.body?.chunks) ? request.body.chunks : null;
    const rawText = typeof request.body?.text === 'string' ? request.body.text : '';
    if (!rawChunks?.length && !rawText.trim()) {
      response.status(400).json({ error: 'Either chunks[] or text is required for ingest.' });
      return;
    }
    const normalizedChunks = (rawChunks ?? [{ id: 'inline', text: rawText }])
      .slice(0, wikiMaxChunksPerIngest)
      .map((chunk, index) => ({
        id: String(chunk?.id ?? `chunk-${index + 1}`).slice(0, 80),
        text: String(chunk?.text ?? chunk ?? '').slice(0, 24_000),
      }))
      .filter((chunk) => chunk.text.trim());

    if (normalizedChunks.length === 0) {
      response.status(400).json({ error: 'No usable chunk text was provided.' });
      return;
    }

    const llmConfig = await loadWikiLlmConfig(request.user);
    const result = await wikiIngestDocument({
      storage,
      document: {
        sourceId,
        title,
        chunks: normalizedChunks,
        suggestedCategory,
        category: suggestedCategory,
        slug: explicitSlug,
      },
      llmConfig,
      callLlmChatEndpoint: llmConfig ? callLlmChatEndpoint : undefined,
      extractLlmAnswer: llmConfig ? extractLlmAnswer : undefined,
      logger: { warn: (message, details) => log(`Wiki ingest warning: ${message}`, details ?? {}) },
    });

    logAuditEvent({
      event: 'wiki.ingest',
      actor: userSubject(request),
      action: 'ingest',
      resourceType: 'wiki_page',
      resourceId: `${project.id}:${result.pageKey}`,
      outcome: 'success',
      metadata: {
        sourceId,
        chunkCount: normalizedChunks.length,
        stubsCreated: result.createdStubs.length,
        llmUsed: Boolean(llmConfig),
        fallback: result.suggestion.fallback,
        confidence: result.suggestion.confidence,
        category: result.category,
      },
    });

    response.json({
      pageKey: result.pageKey,
      category: result.category,
      slug: result.slug,
      sectionId: result.sectionId,
      createdStubs: result.createdStubs,
      backlinkCount: result.backlinkCount,
      pageCount: result.pageCount,
      llmUsed: Boolean(llmConfig),
      suggestion: {
        title: result.suggestion.title,
        category: result.suggestion.category,
        summary: result.suggestion.summary,
        confidence: result.suggestion.confidence,
        fallback: result.suggestion.fallback,
        related: result.suggestion.related,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/projects/:id/wiki/query', requireAuth, async (request, response, next) => {
  try {
    const question = String(request.body?.question ?? '').trim();
    if (!question) {
      response.status(400).json({ error: 'A question is required.' });
      return;
    }
    const limit = Math.min(Math.max(Number.parseInt(request.body?.limit ?? '6', 10) || 6, 1), 12);
    const project = await requireProjectForWiki(request.params.id, request, ['owner', 'editor', 'viewer']);
    const storage = wikiStorageForProject(project);
    const llmConfig = await loadWikiLlmConfig(request.user);
    const result = await wikiQuery({
      storage,
      question,
      limit,
      llmConfig,
      callLlmChatEndpoint: llmConfig ? callLlmChatEndpoint : undefined,
      extractLlmAnswer: llmConfig ? extractLlmAnswer : undefined,
      logger: { warn: (message, details) => log(`Wiki query warning: ${message}`, details ?? {}) },
    });
    logAuditEvent({
      event: 'wiki.query',
      actor: userSubject(request),
      action: 'query',
      resourceType: 'wiki_page',
      resourceId: project.id,
      outcome: 'success',
      metadata: {
        questionLength: question.length,
        citedPageCount: result.citedPages.length,
        llmUsed: result.llmUsed,
      },
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/api/projects/:id/wiki/backlinks', requireAuth, async (request, response, next) => {
  try {
    const project = await requireProjectForWiki(request.params.id, request, ['owner', 'editor', 'viewer']);
    const storage = wikiStorageForProject(project);
    const backlinks = (await storage.readMetadataJson('backlinks.json', { entries: {} })) ?? { entries: {} };
    const ingestLog = (await storage.readMetadataJson('ingest_log.json', { entries: [] })) ?? { entries: [] };
    response.json({
      backlinks: backlinks.entries ?? {},
      ingestLog: Array.isArray(ingestLog.entries) ? ingestLog.entries.slice(0, 50) : [],
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/agent-executors', requireAuth, (request, response) => {
  logAuditEvent({
    event: 'agent_executor.catalog_read',
    actor: userSubject(request),
    action: 'read',
    resourceType: 'agent_executor',
    outcome: 'success',
    metadata: { count: agentExecutorCatalog.length },
  });
  response.json({ executors: agentExecutorCatalog });
});

app.get('/api/agent-repos', requireAuth, (_request, response) => {
  const catalog = loadAgentRepositories();
  logAuditEvent({
    event: 'agent_repo.read',
    actor: userSubject(_request),
    action: 'read',
    resourceType: 'agent_repo',
    outcome: 'success',
    metadata: { repoCount: catalog.repos.length, skillCount: catalog.skills.length, warningCount: catalog.warnings.length },
  });
  response.json({ repos: catalog.repos, warnings: catalog.warnings });
});

app.get('/api/planner-specs', requireAuth, (request, response) => {
  const catalog = loadPlannerRepositories();
  logAuditEvent({
    event: 'planner_spec.read',
    actor: userSubject(request),
    action: 'read',
    resourceType: 'planner_spec',
    outcome: 'success',
    metadata: { specCount: catalog.specs.length, warningCount: catalog.warnings.length },
  });
  response.json({ specs: catalog.specs, warnings: catalog.warnings });
});

app.get('/api/planner-config', requireAuth, async (request, response, next) => {
  try {
    const projectId = String(request.query.projectId ?? '').trim();
    const catalog = loadPlannerRepositories();
    const merged = await readMergedPlannerConfig(request.user, projectId, catalog.specs);
    response.json({
      config: merged.config,
      globalConfig: merged.globalConfig,
      projectConfig: merged.projectConfig,
      spec: merged.spec,
      modelAliases: plannerModelAliases(),
      warnings: catalog.warnings,
    });
  } catch (error) {
    next(error);
  }
});

app.put('/api/planner-config/default', requireAuth, async (request, response, next) => {
  try {
    const catalog = loadPlannerRepositories();
    const config = normalizePlannerConfig(request.body?.config ?? request.body, catalog.specs);
    await secretStoreWrite(plannerDefaultPath(request.user), { config, updatedAt: new Date().toISOString() });
    logAuditEvent({
      event: 'planner_config.save',
      actor: userSubject(request),
      action: 'save',
      resourceType: 'planner_config',
      resourceId: 'default',
      outcome: 'success',
      metadata: { specId: config.specId },
    });
    response.json({ config });
  } catch (error) {
    next(error);
  }
});

app.put('/api/projects/:id/planner-config', requireAuth, async (request, response, next) => {
  try {
    const projectId = request.params.id;
    const db = await requireProjectDb();
    const client = await db.connect();
    try {
      await requireProjectRole(client, projectId, request, ['owner', 'editor']);
    } finally {
      client.release();
    }

    const catalog = loadPlannerRepositories();
    const config = normalizePlannerConfig(request.body?.config ?? request.body, catalog.specs);
    await secretStoreWrite(plannerProjectPath(request.user, projectId), { projectId, config, updatedAt: new Date().toISOString() });
    logAuditEvent({
      event: 'planner_config.save',
      actor: userSubject(request),
      action: 'save',
      resourceType: 'planner_config',
      resourceId: projectId,
      outcome: 'success',
      metadata: { specId: config.specId, projectId },
    });
    response.json({ config });
  } catch (error) {
    next(error);
  }
});

app.post('/api/planner-config/test', requireAuth, async (request, response, next) => {
  try {
    const catalog = loadPlannerRepositories();
    const config = normalizePlannerConfig(request.body?.config ?? request.body, catalog.specs);
    const spec = catalog.specs.find((item) => item.id === config.specId);
    const adapter = await testGoosePlannerAdapter(spec);
    logAuditEvent({
      event: 'planner_config.test',
      actor: userSubject(request),
      action: 'test',
      resourceType: 'planner_config',
      resourceId: config.specId,
      outcome: adapter.reachable ? 'success' : 'failure',
      metadata: { engine: spec?.engine, restartRequired: adapter.restartRequired },
    });
    response.json({
      ok: adapter.reachable,
      config,
      adapter,
      modelAliases: plannerModelAliases(),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/agent-skills', requireAuth, async (request, response, next) => {
  try {
    const projectId = String(request.query.projectId ?? '').trim();
    const repoCatalog = loadAgentRepositories();
    const userSkills = await readAgentSkills(request.user);
    const packageSkillIds = new Set(repoCatalog.skills.map((skill) => skill.id));
    const skills = [...repoCatalog.skills, ...userSkills.filter((skill) => !packageSkillIds.has(skill.id))];
    const bindings = await readProjectAgentSkillBindings(request.user, projectId, skills);
    log('GET /api/agent-skills', {
      count: skills.length,
      projectId: projectId || undefined,
      bindingCount: bindings.length,
      packageSkillCount: repoCatalog.skills.length,
      userSkillCount: userSkills.length,
    });
    logAuditEvent({
      event: 'agent_repo.read',
      actor: userSubject(request),
      action: 'read',
      resourceType: 'agent_repo',
      outcome: 'success',
      metadata: { repoCount: repoCatalog.repos.length, skillCount: repoCatalog.skills.length, warningCount: repoCatalog.warnings.length },
    });
    response.json({ skills, bindings });
  } catch (error) {
    next(error);
  }
});

app.post('/api/agent-skills', requireAuth, async (request, response, next) => {
  try {
    const input = request.body?.skill ?? {};
    const repoCatalog = loadAgentRepositories();
    const packageSkillIds = new Set(repoCatalog.skills.map((skill) => skill.id));
    if (input.source === 'package' || input.editable === false || packageSkillIds.has(String(input.id ?? ''))) {
      throw Object.assign(new Error('Repository skills are read-only. Duplicate the skill before editing it.'), { status: 400 });
    }
    const existingSecret = input.id ? await secretStoreRead(agentSkillPath(request.user, String(input.id))) : null;
    const existing = existingSecret?.data?.data ?? {};
    const skill = normalizeAgentSkill(input, existing);
    const ids = await readAgentSkillIndex(request.user);
    await secretStoreWrite(agentSkillPath(request.user, skill.id), skill);
    await writeAgentSkillIndex(request.user, [skill.id, ...ids]);
    log('POST /api/agent-skills', { id: skill.id, status: skill.status, executorMode: skill.executable.mode });
    logAuditEvent({
      event: 'agent_skill.save',
      actor: userSubject(request),
      action: 'save',
      resourceType: 'agent_skill',
      resourceId: skill.id,
      outcome: 'success',
      metadata: { status: skill.status, executorMode: skill.executable.mode },
    });
    response.json({ skill });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/agent-skills/:id', requireAuth, async (request, response, next) => {
  try {
    const id = String(request.params.id ?? '');
    if (!agentSkillIdPattern.test(id)) {
      response.status(400).json({ error: 'Skill id contains unsupported characters.' });
      return;
    }
    const repoCatalog = loadAgentRepositories();
    if (repoCatalog.skills.some((skill) => skill.id === id)) {
      response.status(400).json({ error: 'Repository skills are read-only and cannot be deleted.' });
      return;
    }

    const ids = await readAgentSkillIndex(request.user);
    await Promise.all([
      secretStoreDeleteMetadata(agentSkillPath(request.user, id)),
      writeAgentSkillIndex(request.user, ids.filter((skillId) => skillId !== id)),
    ]);
    log('DELETE /api/agent-skills/:id', { id });
    logAuditEvent({
      event: 'agent_skill.delete',
      actor: userSubject(request),
      action: 'delete',
      resourceType: 'agent_skill',
      resourceId: id,
      outcome: 'success',
    });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.put('/api/projects/:id/agent-skills', requireAuth, async (request, response, next) => {
  try {
    const projectId = request.params.id;
    const db = await requireProjectDb();
    const client = await db.connect();
    try {
      await requireProjectRole(client, projectId, request, ['owner', 'editor']);
    } finally {
      client.release();
    }

    const repoCatalog = loadAgentRepositories();
    const userSkills = await readAgentSkills(request.user);
    const packageSkillIds = new Set(repoCatalog.skills.map((skill) => skill.id));
    const skills = [...repoCatalog.skills, ...userSkills.filter((skill) => !packageSkillIds.has(skill.id))];
    const bindings = normalizeProjectSkillBindings(request.body?.bindings, skills);
    await secretStoreWrite(agentProjectSkillBindingsPath(request.user, projectId), {
      projectId,
      bindings,
      updatedAt: new Date().toISOString(),
    });
    log('PUT /api/projects/:id/agent-skills', { projectId, bindingCount: bindings.length });
    logAuditEvent({
      event: 'agent_skill.enable',
      actor: userSubject(request),
      action: 'enable',
      resourceType: 'agent_skill',
      resourceId: projectId,
      outcome: 'success',
      metadata: {
        enabledCount: bindings.filter((binding) => binding.enabled).length,
        bindingCount: bindings.length,
      },
    });
    response.json({ bindings });
  } catch (error) {
    next(error);
  }
});

app.get('/api/llm-config', requireAuth, async (request, response) => {
  log('GET /api/llm-config', { subject: userSubject(request) });
  const configs = await Promise.all(Array.from({ length: llmEndpointCount }, (_, index) => toLlmConfig(request.user, index)));
  log('GET /api/llm-config complete', {
    count: configs.length,
    states: configs.map((config) => config.secretLeaseStatus ?? 'unknown'),
  });
  response.json({ configs });
});

app.post('/api/llm-config', requireAuth, async (request, response, next) => {
  try {
    const configs = Array.isArray(request.body?.configs) ? request.body.configs : [];
    const now = new Date().toISOString();
    log('POST /api/llm-config', {
      count: configs.length,
      endpoints: configs.map((config, index) => ({
        index: index + 1,
        name: systemLlmName(index),
        tier: defaultTier(index),
        hasEndpoint: Boolean(config.endpoint),
        model: config.model,
        hasToken: Boolean(config.token),
      })),
    });

    const preparedConfigs = await Promise.all(
      Array.from({ length: llmEndpointCount }, async (_unused, index) => {
        const config = configs[index] ?? {};
        const path = secretPath(request.user, index);
        const existingSecret = await secretStoreRead(path);
        const existingData = existingSecret?.data?.data ?? {};
        const endpoint = config.endpoint ?? existingData.endpoint ?? '';
        const model = config.model ?? existingData.model ?? '';
        const modelAlias = liteLlmModelAlias(request.user, index);
        let encryptedTokenFields = {
          encryptedToken: existingData.encryptedToken,
          iv: existingData.iv,
          authTag: existingData.authTag,
          keyVersion: existingData.keyVersion,
          tokenFingerprint: existingData.tokenFingerprint,
        };

        if (config.token) {
          encryptedTokenFields = encryptProviderToken(config.token, providerTokenAad(path));
        } else if (!existingData.encryptedToken && existingData.token) {
          encryptedTokenFields = encryptProviderToken(existingData.token, providerTokenAad(path));
        }
        if (endpoint) {
          await validateLlmEndpoint(endpoint);
        }

        const isDisabled = !endpoint && !model && !config.token;
        if (isDisabled) {
          encryptedTokenFields = {
            encryptedToken: undefined,
            iv: undefined,
            authTag: undefined,
            keyVersion: undefined,
            tokenFingerprint: undefined,
          };
        }

        const hasProviderKey = Boolean(encryptedTokenFields.encryptedToken);
        const hasAnyField = Boolean(endpoint || model || hasProviderKey);
        const isComplete = Boolean(endpoint && model && hasProviderKey);

        if (hasAnyField && !isComplete) {
          throw Object.assign(
            new Error(`${systemLlmName(index)} must include a provider base URL, provider model, and provider API key before it can be saved.`),
            { status: 400 },
          );
        }

        return {
          index,
          path,
          id: config.id ?? `secret-llm-${index + 1}`,
          endpoint,
          model,
          modelAlias,
          encryptedTokenFields,
          hasProviderKey,
          isDisabled,
          isComplete,
        };
      }),
    );

    if (!preparedConfigs.some((config) => config.isComplete)) {
      throw Object.assign(
        new Error('Configure at least one complete LiteLLM endpoint: LLM_A, LLM_B, or LLM_C.'),
        { status: 400 },
      );
    }

    await Promise.all(
      preparedConfigs.map(async ({ index, path, id, endpoint, model, modelAlias, encryptedTokenFields, hasProviderKey, isDisabled }) => {
        if (isDisabled) {
          await Promise.all([
            secretStoreDeleteMetadata(path).catch((error) => {
              if (error?.status !== 404) {
                throw error;
              }
            }),
            secretStoreDeleteMetadata(aliasPath(modelAlias)).catch((error) => {
              if (error?.status !== 404) {
                throw error;
              }
            }),
          ]);
          return;
        }

        await secretStoreWrite(path, {
          id,
          name: systemLlmName(index),
          endpoint,
          model,
          modelAlias,
          tier: defaultTier(index),
          ...encryptedTokenFields,
          updatedAt: now,
        });

        await secretStoreWrite(aliasPath(modelAlias), {
          modelAlias,
          secretPath: path,
          userSegment: secretUserSegment(request.user),
          index,
          tier: defaultTier(index),
          updatedAt: now,
        });

        if (endpoint && model && hasProviderKey) {
          await configureLiteLlmModel(request.user, index, { endpoint, model });
        }
      }),
    );

    const savedConfigs = await Promise.all(Array.from({ length: llmEndpointCount }, (_, index) => toLlmConfig(request.user, index)));
    log('POST /api/llm-config complete', {
      count: savedConfigs.length,
      secretNames: savedConfigs.map((config) => config.secretName),
    });
    logAuditEvent({
      event: 'llm_config.save',
      actor: userSubject(request),
      action: 'save',
      resourceType: 'llm_config',
      outcome: 'success',
      metadata: {
        count: savedConfigs.length,
        endpoints: savedConfigs.map((config) => config.name),
        states: savedConfigs.map((config) => config.secretLeaseStatus ?? 'unknown'),
      },
    });
    response.json({ configs: savedConfigs });
  } catch (error) {
    next(error);
  }
});

app.post('/api/llm-config/test', requireAuth, async (request, response, next) => {
  try {
    const llmConfig = await loadRunnableLlmConfig(request.user, request.body?.config ?? {});
    log('POST /api/llm-config/test', {
      index: llmConfig.index + 1,
      name: llmConfig.name,
      modelAlias: llmConfig.modelAlias,
    });
    await callLlmChatEndpoint(llmConfig, 'Reply with only: ok');
    logAuditEvent({
      event: 'llm_config.test',
      actor: userSubject(request),
      action: 'test',
      resourceType: 'llm_config',
      resourceId: llmConfig.modelAlias,
      outcome: 'success',
      metadata: { endpoint: llmConfig.name, index: llmConfig.index + 1 },
    });
    response.json({
      status: 'success',
      message: `Connection test succeeded for ${llmConfig.name}.`,
      lastTestedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/goose/chat', requireAuth, async (request, response, next) => {
  try {
    const messages = sanitizeGooseMessages(request.body?.messages);
    const requestedTier = request.body?.tier;
    const projectId = String(request.body?.projectId ?? '').trim();
    const plannerMode = request.body?.plannerMode === true;
    let plannerContext = null;
    if (plannerMode && !projectId) {
      throw Object.assign(new Error('projectId is required for planner mode.'), { status: 400 });
    }
    if (plannerMode && gooseChatbotBackend !== 'goose') {
      throw Object.assign(new Error('Planner mode requires the Goose backend.'), { status: 400 });
    }
    if (plannerMode && projectId) {
      const db = await requireProjectDb();
      const client = await db.connect();
      try {
        await requireProjectRole(client, projectId, request, ['owner', 'editor', 'viewer']);
      } finally {
        client.release();
      }
      plannerContext = await loadProjectPlannerContext(request.user, projectId);
    }
    const requestedSystemPrompt = String(request.body?.systemPrompt ?? '').trim();
    const systemPrompt = String(
      plannerMode
        ? [gooseChatbotSystemPrompt, plannerContext?.systemPrompt, requestedSystemPrompt].filter(Boolean).join('\n\n')
        : requestedSystemPrompt || gooseChatbotSystemPrompt,
    ).trim();
    const chatMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages.filter((message) => message.role !== 'system')]
      : messages;
    const maxTokens = Number.isFinite(gooseChatbotMaxTokens) && gooseChatbotMaxTokens > 0 ? gooseChatbotMaxTokens : 768;
    const temperature = Number.isFinite(gooseChatbotTemperature) ? gooseChatbotTemperature : 0.2;
    let answer = '';
    let gooseSessionId;
    let backend = 'litellm';
    let activeConfig;
    if (gooseChatbotBackend === 'goose') {
      try {
        const plannerAlias = plannerContext?.config?.roleBindings?.planner;
        const plannerTier = /^LLM_[ABC]$/i.test(plannerAlias ?? '') ? plannerAlias.slice(-1).toLowerCase() : undefined;
        activeConfig = await loadGooseChatbotConfig(request.user, plannerTier);
        const gooseReply = await callGooseChatEndpoint(activeConfig, chatMessages, {
          workingDir: plannerContext?.workspace?.containerPath ?? gooseWorkingDir,
        });
        answer = gooseReply.answer;
        gooseSessionId = gooseReply.sessionId;
        backend = 'goose';
      } catch (error) {
        log('Goose chatbot backend failed; falling back to LiteLLM', {
          error: error instanceof Error ? error.message : 'Unknown Goose error.',
        });
        if (plannerMode) {
          throw error;
        }
      }
    }
    if (!answer) {
      activeConfig = await loadGooseChatbotConfig(request.user, requestedTier);
      const body = await callLlmChatEndpoint(activeConfig, chatMessages, { maxTokens, temperature });
      answer = extractLlmAnswer(body);
    }
    let plannerPayload = null;
    if (plannerMode) {
      plannerPayload = validatePlannerExecutionPayload(answer, { visibleSkills: plannerContext?.visibleSkills ?? [] });
    }
    log('POST /api/goose/chat', {
      backend,
      modelAlias: activeConfig.modelAlias,
      endpoint: activeConfig.name,
      messageCount: chatMessages.length,
      userMessageCount: chatMessages.filter((message) => message.role === 'user').length,
      plannerMode,
      projectId: projectId || undefined,
    });
    logAuditEvent({
      event: 'goose_chatbot.message',
      actor: userSubject(request),
      action: 'chat',
      resourceType: 'goose_chatbot',
      resourceId: activeConfig.modelAlias,
      outcome: 'success',
      metadata: {
        backend,
        endpoint: activeConfig.name,
        messageCount: chatMessages.length,
        userMessageCount: chatMessages.filter((message) => message.role === 'user').length,
        plannerMode,
        projectId: projectId || undefined,
      },
    });
    response.json({
      message: {
        id: randomUUID(),
        role: 'assistant',
        content: answer,
        createdAt: new Date().toISOString(),
      },
      modelAlias: activeConfig.modelAlias,
      tier: activeConfig.tier,
      gooseSessionId,
      plannerPayload,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/llm-config/chat', requireAuth, async (request, response, next) => {
  try {
    const question = String(request.body?.question ?? '').trim();
    if (!question) {
      response.status(400).json({ error: 'Question is required.' });
      return;
    }

    const llmConfig = await loadRunnableLlmConfig(request.user, request.body?.config ?? {});
    log('POST /api/llm-config/chat', {
      index: llmConfig.index + 1,
      name: llmConfig.name,
      modelAlias: llmConfig.modelAlias,
      questionLength: question.length,
    });
    const body = await callLlmChatEndpoint(llmConfig, question);
    logAuditEvent({
      event: 'llm_config.chat',
      actor: userSubject(request),
      action: 'chat',
      resourceType: 'llm_config',
      resourceId: llmConfig.modelAlias,
      outcome: 'success',
      metadata: { endpoint: llmConfig.name, index: llmConfig.index + 1, questionLength: question.length },
    });
    response.json({
      answer: extractLlmAnswer(body),
    });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/llm-config/secrets', requireAuth, async (request, response, next) => {
  try {
    log('DELETE /api/llm-config/secrets', { count: llmEndpointCount });
    await Promise.all(
      Array.from({ length: llmEndpointCount }, async (_unused, index) => {
        try {
          await secretStoreDeleteMetadata(secretPath(request.user, index));
        } catch (error) {
          throw error;
        }
      }),
    );

    log('DELETE /api/llm-config/secrets complete');
    logAuditEvent({
      event: 'llm_config.secrets_delete',
      actor: userSubject(request),
      action: 'delete',
      resourceType: 'llm_config',
      outcome: 'success',
      metadata: { count: llmEndpointCount },
    });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  log('API error', {
    status,
    message: error instanceof Error ? error.message : 'Unexpected API error.',
  });
  response.status(status).json({
    error: status >= 500 ? 'Unexpected API error.' : error instanceof Error ? error.message : 'Request failed.',
  });
});

const startApiServer = async () => {
  if (projectDb) {
    try {
      await requireProjectDb();
      log('Project database schema ready');
    } catch (error) {
      console.error(
        'Project database schema initialization failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  app.listen(apiPort, apiHost, () => {
    console.log(`AISSIStaint API proxy listening on http://${apiHost}:${apiPort}`);
    console.log(`Using Keycloak issuer ${issuer}`);
    console.log(`Using OpenBao ${openBaoUrl}/${openBaoKvMount}/${openBaoPrefix}`);
    console.log(`Using LiteLLM proxy ${liteLlmUrl}`);
    if (appDatabaseUrl) {
      console.log(`Using app database ${appDatabaseUrl.replace(/:[^:@/]+@/, ':***@')}`);
    }
  });
};

void startApiServer();
