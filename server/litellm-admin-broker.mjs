import express from 'express';
import { lookup } from 'node:dns/promises';
import { existsSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

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

const defaultPlatformDir = `${homedir()}/platform-demo`;
loadEnvFile(resolve('.env.local'), { allowEmpty: false });
loadEnvFile(process.env.PLATFORM_ENV_FILE || `${defaultPlatformDir}/platform-demo-runtime.env`);
loadEnvFile(process.env.LITELLM_ADMIN_BROKER_ENV_FILE || `${defaultPlatformDir}/secrets/litellm-admin-broker.env`);

const brokerHost = process.env.LITELLM_ADMIN_BROKER_HOST ?? '127.0.0.1';
const brokerPort = Number.parseInt(process.env.LITELLM_ADMIN_BROKER_PORT ?? '8788', 10);
const brokerToken = process.env.LITELLM_ADMIN_BROKER_TOKEN ?? '';
const liteLlmUrl = (process.env.INTERNAL_LITELLM_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/g, '');
const liteLlmAdminKey = process.env.LITELLM_ADMIN_KEY ?? process.env.LITELLM_MASTER_KEY ?? '';
const allowedLlmHosts = new Set(
  (process.env.LLM_ALLOWED_HOSTS ?? 'api.cborg.lbl.gov')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);
const allowAnyLlmHosts = process.env.LLM_ALLOW_ANY_HOSTS === 'true';
const explicitLlmDevMode = process.env.LLM_DEV_MODE === 'true';
const allowPrivateLlmEndpoints = process.env.LLM_ALLOW_PRIVATE_ENDPOINTS === 'true';
const allowHttpLlmEndpoints = process.env.LLM_ALLOW_HTTP_ENDPOINTS === 'true';
const allowedAliasPattern = /^aissistaint-[a-z0-9_-]{1,48}-(high|medium|low)$/;

if (!brokerToken) {
  throw new Error('LITELLM_ADMIN_BROKER_TOKEN must be configured for the LiteLLM admin broker.');
}

if (!liteLlmAdminKey) {
  throw new Error('LITELLM_ADMIN_KEY or LITELLM_MASTER_KEY must be configured for the LiteLLM admin broker.');
}

if (allowedLlmHosts.size === 0 && !(allowAnyLlmHosts && explicitLlmDevMode && process.env.NODE_ENV !== 'production')) {
  throw new Error('LLM_ALLOWED_HOSTS must be configured unless LLM_ALLOW_ANY_HOSTS=true and LLM_DEV_MODE=true outside production.');
}

if (process.env.NODE_ENV === 'production' && allowPrivateLlmEndpoints) {
  throw new Error('LLM_ALLOW_PRIVATE_ENDPOINTS cannot be enabled when NODE_ENV=production.');
}

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

const isPrivateAddress = (address) => {
  if (address === '::1' || address === '0:0:0:0:0:0:0:1') {
    return true;
  }

  if (address.includes(':')) {
    const normalized = address.toLowerCase();
    return normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }

  const [a, b] = address.split('.').map((part) => Number.parseInt(part, 10));
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
};

const validateLlmEndpoint = async (baseUrl) => {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('LLM base URL must be a valid URL.');
  }

  if (parsed.protocol !== 'https:' && !(allowHttpLlmEndpoints && parsed.protocol === 'http:')) {
    throw new Error('LLM base URL must use https:// unless LLM_ALLOW_HTTP_ENDPOINTS=true is set for local development.');
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

const requireBrokerAuth = (request, response, next) => {
  const header = request.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (token !== brokerToken) {
    response.status(401).json({ error: 'Unauthorized.' });
    return;
  }
  next();
};

const app = express();
app.use(express.json({ limit: '256kb' }));

app.get('/healthz', (_request, response) => {
  response.json({ ok: true });
});

app.post('/internal/litellm/models', requireBrokerAuth, async (request, response, next) => {
  try {
    const modelAlias = String(request.body?.modelAlias ?? '');
    const model = String(request.body?.model ?? '');
    const endpoint = String(request.body?.endpoint ?? '');
    const secretReference = String(request.body?.secretReference ?? '');

    if (!allowedAliasPattern.test(modelAlias)) {
      response.status(400).json({ error: 'Model alias is outside the allowed AIssistAInt namespace.' });
      return;
    }

    if (!secretReference || secretReference !== `aissistaint://${modelAlias}`) {
      response.status(400).json({ error: 'Secret reference must match the model alias namespace.' });
      return;
    }

    if (!model) {
      response.status(400).json({ error: 'Provider model is required.' });
      return;
    }

    await validateLlmEndpoint(endpoint);

    const litellmResponse = await fetch(`${liteLlmUrl}/model/new`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${liteLlmAdminKey}`,
      },
      body: JSON.stringify({
        model_name: modelAlias,
        litellm_params: {
          model,
          api_base: endpoint,
          api_key: secretReference,
        },
      }),
    });
    const body = await jsonResponse(litellmResponse);
    log('LiteLLM model admin request', { modelAlias, status: litellmResponse.status });

    if (!litellmResponse.ok) {
      response
        .status(litellmResponse.status)
        .json({ error: body.error?.message ?? body.error ?? body.raw ?? `LiteLLM returned ${litellmResponse.status}` });
      return;
    }

    response.json({ modelAlias });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: error.message ?? 'Unexpected LiteLLM admin broker error.' });
});

app.listen(brokerPort, brokerHost, () => {
  log('LiteLLM admin broker listening', { host: brokerHost, port: brokerPort });
});
