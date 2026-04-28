import cors from 'cors';
import express from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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
const keycloakUrl = process.env.VITE_KEYCLOAK_URL ?? `http://${process.env.HOST_IP ?? '127.0.0.1'}:8080`;
const keycloakRealm = process.env.VITE_KEYCLOAK_REALM ?? process.env.KC_REALM ?? 'minio';
const keycloakClientId = process.env.VITE_KEYCLOAK_CLIENT_ID ?? process.env.AISSISTAINT_UI_CLIENT_ID ?? 'aissistaint-ui';
const issuer = `${keycloakUrl}/realms/${keycloakRealm}`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`));

const openBaoUrl = process.env.VITE_OPENBAO_URL ?? 'http://127.0.0.1:8200';
const openBaoToken = process.env.OPENBAO_ROOT_TOKEN;
const openBaoKvMount = process.env.OPENBAO_KV_MOUNT ?? 'secret';
const openBaoPrefix = process.env.OPENBAO_RW_PREFIX ?? 'app-tokens';
const appDatabaseUrl = process.env.APP_DATABASE_URL ?? '';
const llmTiers = (process.env.VITE_LLM_TIERS ?? 'high,medium,low')
  .split(',')
  .map((tier) => tier.trim().toLowerCase())
  .filter((tier) => ['high', 'medium', 'low'].includes(tier));
const configuredLlmTiers = llmTiers.length > 0 ? llmTiers : ['high', 'medium', 'low'];
const llmEndpointCount = configuredLlmTiers.length;

if (!openBaoToken) {
  console.warn('OPENBAO_ROOT_TOKEN is not set. OpenBao API calls will fail until the platform env file is available.');
}

if (!appDatabaseUrl) {
  console.warn('APP_DATABASE_URL is not set. Project API calls will fail until the app database is configured.');
}

const projectDb = appDatabaseUrl ? new pg.Pool({ connectionString: appDatabaseUrl }) : null;
let projectDbReady = false;

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

const log = (message, details = {}) => {
  const suffix = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
  console.log(`[${new Date().toISOString()}] ${message}${suffix}`);
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
    response.status(401).json({
      error: 'Invalid Keycloak token.',
      detail: error instanceof Error ? error.message : 'Unknown verification error.',
    });
  }
};

const requireProjectDb = async () => {
  if (!projectDb) {
    throw new Error('App database is not configured on the backend.');
  }

  if (projectDbReady) {
    return projectDb;
  }

  await projectDb.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id uuid PRIMARY KEY,
      name text NOT NULL CHECK (length(trim(name)) > 0),
      description text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'active',
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await projectDb.query(`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_subject text NOT NULL,
      role text NOT NULL DEFAULT 'owner',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (project_id, user_subject)
    )
  `);
  projectDbReady = true;
  return projectDb;
};

const toProject = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  status: row.status,
  createdBy: row.created_by,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
});

const userSubject = (request) => String(request.user?.sub ?? request.user?.preferred_username ?? 'unknown-user');

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

const secretPath = (index) => `${openBaoPrefix}/llm/endpoints/${index + 1}`;
const dataApiPath = (index) => `/v1/${openBaoKvMount}/data/${secretPath(index)}`;
const metadataApiPath = (index) => `/v1/${openBaoKvMount}/metadata/${secretPath(index)}`;

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

const indexFromConfig = (config) => {
  const source = `${config.secretName ?? ''} ${config.id ?? ''}`;
  const match = source.match(/endpoints\/(\d+)|openbao-llm-(\d+)/);
  const parsed = Number.parseInt(match?.[1] ?? match?.[2] ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed - 1 : 0;
};

const loadRunnableLlmConfig = async (config) => {
  const index = Math.min(indexFromConfig(config), llmEndpointCount - 1);
  const existingSecret = await openBaoFetchOptional(dataApiPath(index));
  const existingData = existingSecret?.data?.data ?? {};
  const endpoint = config.endpoint || existingData.endpoint || '';
  const model = config.model || existingData.model || '';
  const token = config.token || existingData.token || '';

  if (!endpoint.startsWith('http')) {
    throw new Error('LLM base URL must start with http:// or https://.');
  }

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
  const response = await fetch(url, {
    method: 'POST',
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
  });
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

const toLlmConfig = async (index) => {
  const path = secretPath(index);

  try {
    const [secret, metadata] = await Promise.all([
      openBaoFetchOptional(dataApiPath(index)),
      openBaoFetchOptional(metadataApiPath(index)),
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
  response.json({
    ok: true,
    issuer,
    openBaoUrl,
    openBaoKvMount,
    openBaoPrefix,
    appDatabaseConfigured: Boolean(appDatabaseUrl),
  });
});

app.get('/api/projects', requireAuth, async (_request, response, next) => {
  try {
    const db = await requireProjectDb();
    const result = await db.query(`
      SELECT id, name, description, status, created_by, created_at, updated_at
      FROM projects
      ORDER BY updated_at DESC, created_at DESC
    `);
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

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `
          INSERT INTO projects (id, name, description, created_by)
          VALUES ($1, $2, $3, $4)
          RETURNING id, name, description, status, created_by, created_at, updated_at
        `,
        [randomUUID(), name, description, subject],
      );
      await client.query(
        `
          INSERT INTO project_members (project_id, user_subject, role)
          VALUES ($1, $2, 'owner')
          ON CONFLICT (project_id, user_subject) DO UPDATE SET role = EXCLUDED.role
        `,
        [result.rows[0].id, subject],
      );
      await client.query('COMMIT');
      log('POST /api/projects', { id: result.rows[0].id, name });
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

    const result = await db.query(
      `
        UPDATE projects
        SET
          name = COALESCE($2, name),
          description = COALESCE($3, description),
          status = COALESCE($4, status),
          updated_at = now()
        WHERE id = $1
        RETURNING id, name, description, status, created_by, created_at, updated_at
      `,
      [id, name, description, status],
    );

    if (result.rowCount === 0) {
      response.status(404).json({ error: 'Project not found.' });
      return;
    }

    log('PATCH /api/projects/:id', { id });
    response.json({ project: toProject(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/llm-config', requireAuth, async (_request, response) => {
  log('GET /api/llm-config');
  const configs = await Promise.all(Array.from({ length: llmEndpointCount }, (_, index) => toLlmConfig(index)));
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
        const existingSecret = await openBaoFetchOptional(dataApiPath(index));
        const existingData = existingSecret?.data?.data ?? {};
        const nextToken = config.token || existingData.token || '';

        return openBaoFetch(dataApiPath(index), {
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

    const savedConfigs = await Promise.all(Array.from({ length: llmEndpointCount }, (_, index) => toLlmConfig(index)));
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
    const llmConfig = await loadRunnableLlmConfig(request.body?.config ?? {});
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

    const llmConfig = await loadRunnableLlmConfig(request.body?.config ?? {});
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

app.delete('/api/llm-config/secrets', requireAuth, async (_request, response, next) => {
  try {
    log('DELETE /api/llm-config/secrets', { count: llmEndpointCount });
    await Promise.all(
      Array.from({ length: llmEndpointCount }, async (_unused, index) => {
        try {
          await openBaoFetchOptional(metadataApiPath(index), { method: 'DELETE' });
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
  response.status(500).json({
    error: error instanceof Error ? error.message : 'Unexpected API error.',
  });
});

app.listen(apiPort, () => {
  console.log(`AISSIStaint API proxy listening on http://127.0.0.1:${apiPort}`);
  console.log(`Using Keycloak issuer ${issuer}`);
  console.log(`Using OpenBao ${openBaoUrl}/${openBaoKvMount}/${openBaoPrefix}`);
});
