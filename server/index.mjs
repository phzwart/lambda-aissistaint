import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import cors from 'cors';
import express from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { existsSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import pg from 'pg';

const loadEnvFile = (path) => {
  if (!path || !existsSync(path)) {
    return;
  }

  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) {
      continue;
    }

    const [key, ...valueParts] = line.split('=');
    if (!process.env[key]) {
      process.env[key] = valueParts.join('=');
    }
  }
};

loadEnvFile(resolve('.env.local'));
loadEnvFile(process.env.PLATFORM_ENV_FILE ?? `${homedir()}/platform-demo/platform-demo.env`);

const apiPort = Number.parseInt(process.env.API_PORT ?? '8787', 10);
const keycloakPublicUrl =
  process.env.PUBLIC_KEYCLOAK_URL ?? process.env.VITE_KEYCLOAK_URL ?? `http://${process.env.HOST_IP ?? '127.0.0.1'}:8080`;
const keycloakInternalUrl = process.env.INTERNAL_KEYCLOAK_URL ?? keycloakPublicUrl;
const keycloakRealm = process.env.VITE_KEYCLOAK_REALM ?? process.env.KC_REALM ?? 'minio';
const keycloakClientId = process.env.VITE_KEYCLOAK_CLIENT_ID ?? process.env.AISSISTAINT_UI_CLIENT_ID ?? 'aissistaint-ui';
const issuer = `${keycloakPublicUrl}/realms/${keycloakRealm}`;
const jwks = createRemoteJWKSet(new URL(`${keycloakInternalUrl}/realms/${keycloakRealm}/protocol/openid-connect/certs`));

const openBaoUrl = process.env.INTERNAL_OPENBAO_URL ?? process.env.VITE_OPENBAO_URL ?? 'http://127.0.0.1:8200';
const openBaoToken = process.env.OPENBAO_APP_TOKEN ?? process.env.OPENBAO_ROOT_TOKEN;
const openBaoKvMount = process.env.OPENBAO_KV_MOUNT ?? 'secret';
const openBaoPrefix = process.env.OPENBAO_RW_PREFIX ?? 'app-tokens';
const appDatabaseUrl = process.env.APP_DATABASE_URL ?? '';
const minioEndpoint = process.env.INTERNAL_MINIO_ENDPOINT ?? process.env.MINIO_ENDPOINT ?? 'http://127.0.0.1:9000';
const minioAccessKey = process.env.MINIO_APP_ACCESS_KEY ?? process.env.MINIO_ROOT_USER ?? '';
const minioSecretKey = process.env.MINIO_APP_SECRET_KEY ?? process.env.MINIO_ROOT_PASSWORD ?? '';
const minioRemovalPolicyName = process.env.MINIO_REMOVAL_POLICY_NAME ?? 'project-removal-rw';
const projectBucketPrefix = process.env.PROJECT_BUCKET_PREFIX ?? 'aissistaint-project';
const projectLoadedPrefix = process.env.PROJECT_LOADED_PREFIX ?? 'loaded';
const projectParsedPrefix = process.env.PROJECT_PARSED_PREFIX ?? 'parsed';
const projectMetadataObjectKey = process.env.PROJECT_METADATA_OBJECT_KEY ?? 'project.json';
const publicAppUrl = process.env.PUBLIC_APP_URL ?? 'https://aissistaint.localhost:8443';
const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ?? `${publicAppUrl},http://localhost:5173,http://127.0.0.1:5173`)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const allowedLlmHosts = new Set(
  (process.env.LLM_ALLOWED_HOSTS ?? 'api.cborg.lbl.gov')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);
const allowPrivateLlmEndpoints = process.env.LLM_ALLOW_PRIVATE_ENDPOINTS === 'true';
const llmRequestTimeoutMs = Number.parseInt(process.env.LLM_REQUEST_TIMEOUT_MS ?? '30000', 10);
const llmTiers = (process.env.VITE_LLM_TIERS ?? 'high,medium,low')
  .split(',')
  .map((tier) => tier.trim().toLowerCase())
  .filter((tier) => ['high', 'medium', 'low'].includes(tier));
const configuredLlmTiers = llmTiers.length > 0 ? llmTiers : ['high', 'medium', 'low'];
const llmEndpointCount = configuredLlmTiers.length;

if (!openBaoToken) {
  console.warn('OPENBAO_APP_TOKEN or OPENBAO_ROOT_TOKEN is not set. OpenBao API calls will fail until a scoped app token is available.');
}

if (!appDatabaseUrl) {
  console.warn('APP_DATABASE_URL is not set. Project API calls will fail until the app database is configured.');
}

const projectDb = appDatabaseUrl ? new pg.Pool({ connectionString: appDatabaseUrl }) : null;
const minioClient =
  minioAccessKey && minioSecretKey
    ? new S3Client({
        endpoint: minioEndpoint,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: {
          accessKeyId: minioAccessKey,
          secretAccessKey: minioSecretKey,
        },
      })
    : null;
let projectDbReady = false;
let projectDbInitPromise = null;

if (!minioClient) {
  console.warn('MINIO_APP_ACCESS_KEY/MINIO_APP_SECRET_KEY or MinIO root credentials are not set. Project bucket creation will fail.');
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

const isAdmin = (payload) => hasAnyRole(payload, ['aissistaint-admin', 'admin', 'administrator']);
const isRemovalAgent = (payload) => hasAnyRole(payload, ['removal-agent', 'removal-agents']);

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
    response.status(401).json({
      error: 'Invalid Keycloak token.',
    });
  }
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
    return projectDb;
  }

  projectDbInitPromise ??= initializeProjectDb().catch((error) => {
    projectDbInitPromise = null;
    throw error;
  });
  await projectDbInitPromise;
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

const userSubject = (request) => String(request.user?.sub ?? request.user?.preferred_username ?? 'unknown-user');

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

  await Promise.all(
    [loadedPrefix, parsedPrefix].map((prefix) =>
      minioClient.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: `${objectPrefix(prefix)}/`,
          Body: '',
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
  if (!minioClient) {
    throw new Error('MinIO credentials are not configured on the backend.');
  }

  await minioClient.send(
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
    const error = new Error(body.errors?.join(', ') || body.error || `OpenBao request failed with ${response.status}`);
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

const secretUserSegment = (user) =>
  encodeURIComponent(String(user?.sub ?? user?.preferred_username ?? 'unknown-user')).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
const secretPath = (user, index) => `${openBaoPrefix}/users/${secretUserSegment(user)}/llm/endpoints/${index + 1}`;
const dataApiPath = (user, index) => `/v1/${openBaoKvMount}/data/${secretPath(user, index)}`;
const metadataApiPath = (user, index) => `/v1/${openBaoKvMount}/metadata/${secretPath(user, index)}`;

const defaultTier = (index) => configuredLlmTiers[index] ?? 'medium';
const systemLlmName = (index) => `LLM_${defaultTier(index)}`;

const tokenPreview = (token) => {
  if (!token) {
    return undefined;
  }

  if (token.length <= 4) {
    return '****';
  }

  return `****${token.slice(-4)}`;
};

const chatCompletionsUrl = (baseUrl) => {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }

  return `${trimmed}/chat/completions`;
};

const isPrivateAddress = (address) => {
  if (address === '::1' || address === '0:0:0:0:0:0:0:1') {
    return true;
  }

  if (address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) {
    return true;
  }

  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
};

const validateLlmEndpoint = async (baseUrl) => {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('LLM base URL must be a valid URL.');
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('LLM base URL must use http or https.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (allowedLlmHosts.size > 0 && !allowedLlmHosts.has(hostname)) {
    throw new Error(`LLM host ${hostname} is not allowed.`);
  }

  if (!allowPrivateLlmEndpoints) {
    const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
    if (addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error('LLM endpoint cannot resolve to a private or loopback address.');
    }
  }
};

const indexFromConfig = (config) => {
  const source = `${config.secretName ?? ''} ${config.id ?? ''}`;
  const match = source.match(/endpoints\/(\d+)|openbao-llm-(\d+)/);
  const parsed = Number.parseInt(match?.[1] ?? match?.[2] ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed - 1 : 0;
};

const loadRunnableLlmConfig = async (user, config) => {
  const index = Math.min(indexFromConfig(config), llmEndpointCount - 1);
  const existingSecret = await openBaoFetchOptional(dataApiPath(user, index));
  const existingData = existingSecret?.data?.data ?? {};
  const endpoint = config.endpoint || existingData.endpoint || '';
  const model = config.model || existingData.model || '';
  const token = config.token || existingData.token || '';

  if (!endpoint.startsWith('http')) {
    throw new Error('LLM base URL must start with http:// or https://.');
  }

  await validateLlmEndpoint(endpoint);

  if (!model) {
    throw new Error('No model is configured for this endpoint.');
  }

  if (!token) {
    throw new Error('No API token is available in the input or OpenBao for this endpoint.');
  }

  return {
    index,
    endpoint,
    model,
    token,
    name: systemLlmName(index),
    tier: defaultTier(index),
  };
};

const callLlmChatEndpoint = async ({ endpoint, model, token }, question) => {
  const url = chatCompletionsUrl(endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), llmRequestTimeoutMs);
  const response = await fetch(url, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: question,
        },
      ],
      max_tokens: 128,
      temperature: 0,
    }),
  }).finally(() => clearTimeout(timeout));
  const body = await jsonResponse(response);
  log('LLM endpoint request', {
    endpoint: url,
    model,
    status: response.status,
  });

  if (!response.ok) {
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

const toLlmConfig = async (user, index) => {
  const path = secretPath(user, index);

  try {
    const [secret, metadata] = await Promise.all([
      openBaoFetchOptional(dataApiPath(user, index)),
      openBaoFetchOptional(metadataApiPath(user, index)),
    ]);
    if (!secret && !metadata) {
      return {
        id: `openbao-llm-${index + 1}`,
        name: systemLlmName(index),
        endpoint: '',
        model: '',
        token: '',
        tier: defaultTier(index),
        status: 'idle',
        secretName: `${openBaoKvMount}/data/${path}`,
        secretLeaseStatus: 'none',
      };
    }

    const data = secret?.data?.data ?? {};
    const meta = metadata?.data ?? {};
    const storedToken = typeof data.token === 'string' ? data.token : '';

    return {
      id: data.id ?? `openbao-llm-${index + 1}`,
      name: systemLlmName(index),
      endpoint: data.endpoint ?? '',
      model: data.model ?? '',
      token: '',
      tier: defaultTier(index),
      status: 'idle',
      secretName: `${openBaoKvMount}/data/${path}`,
      secretVersion: meta.current_version,
      secretCreatedAt: meta.created_time,
      secretUpdatedAt: meta.updated_time,
      secretLastRetrievedAt: new Date().toISOString(),
      secretLeaseStatus: secret ? 'retrieved' : 'none',
      tokenStored: Boolean(storedToken),
      tokenPreview: tokenPreview(storedToken),
    };
  } catch (error) {
    return {
      id: `openbao-llm-${index + 1}`,
      name: systemLlmName(index),
      endpoint: '',
      model: '',
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
    appDatabaseConfigured: Boolean(appDatabaseUrl),
  });
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

    await Promise.all(
      configs.slice(0, llmEndpointCount).map(async (config, index) => {
        const existingSecret = await openBaoFetchOptional(dataApiPath(request.user, index));
        const existingData = existingSecret?.data?.data ?? {};
        const nextToken = config.token || existingData.token || '';

        return openBaoFetch(dataApiPath(request.user, index), {
          method: 'POST',
          body: JSON.stringify({
            data: {
              id: config.id ?? `openbao-llm-${index + 1}`,
              name: systemLlmName(index),
              endpoint: config.endpoint ?? '',
              model: config.model ?? '',
              tier: defaultTier(index),
              token: nextToken,
              updatedAt: now,
            },
          }),
        });
      }),
    );

    const savedConfigs = await Promise.all(Array.from({ length: llmEndpointCount }, (_, index) => toLlmConfig(request.user, index)));
    log('POST /api/llm-config complete', {
      count: savedConfigs.length,
      secretNames: savedConfigs.map((config) => config.secretName),
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
      hasStoredToken: true,
    });
    await callLlmChatEndpoint(llmConfig, 'Reply with only: ok');
    response.json({
      status: 'success',
      message: `Connection test succeeded for ${llmConfig.name}.`,
      lastTestedAt: new Date().toISOString(),
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
      questionLength: question.length,
    });
    const body = await callLlmChatEndpoint(llmConfig, question);
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
          await openBaoFetchOptional(metadataApiPath(request.user, index), { method: 'DELETE' });
        } catch (error) {
          throw error;
        }
      }),
    );

    log('DELETE /api/llm-config/secrets complete');
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

app.listen(apiPort, () => {
  console.log(`AISSIStaint API proxy listening on http://127.0.0.1:${apiPort}`);
  console.log(`Using Keycloak issuer ${issuer}`);
  console.log(`Using OpenBao ${openBaoUrl}/${openBaoKvMount}/${openBaoPrefix}`);
});
