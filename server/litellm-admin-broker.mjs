import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { logAuditEvent } from './lib/auditEvents.mjs';
import { isAllowedLiteLlmAlias, isMatchingLiteLlmSecretReference } from './lib/brokerPolicy.mjs';
import { createLlmEndpointValidator, parseAllowedHosts } from './lib/llmEndpointPolicy.mjs';

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
loadEnvFile(process.env.LITELLM_ADMIN_BROKER_ENV_FILE || `${defaultPlatformDir}/secrets/litellm-admin-broker.env`);

const brokerHost = process.env.LITELLM_ADMIN_BROKER_HOST ?? '127.0.0.1';
const brokerPort = Number.parseInt(process.env.LITELLM_ADMIN_BROKER_PORT ?? '8788', 10);
const brokerToken = process.env.LITELLM_ADMIN_BROKER_TOKEN ?? '';
const liteLlmUrl = (process.env.INTERNAL_LITELLM_URL ?? 'http://127.0.0.1:4000').replace(/\/+$/g, '');
const liteLlmAdminKey = process.env.LITELLM_ADMIN_KEY ?? process.env.LITELLM_MASTER_KEY ?? '';
const liteLlmSecretBrokerUrl = (process.env.LITELLM_SECRET_BROKER_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/g, '');
const liteLlmSecretBrokerToken = process.env.LITELLM_SECRET_BROKER_TOKEN ?? '';
const allowedLlmHosts = parseAllowedHosts(process.env.LLM_ALLOWED_HOSTS ?? 'api.cborg.lbl.gov');
const allowAnyLlmHosts = process.env.LLM_ALLOW_ANY_HOSTS === 'true';
const explicitLlmDevMode = process.env.LLM_DEV_MODE === 'true';
const allowPrivateLlmEndpoints = process.env.LLM_ALLOW_PRIVATE_ENDPOINTS === 'true';
const allowHttpLlmEndpoints = process.env.LLM_ALLOW_HTTP_ENDPOINTS === 'true';
const validateLlmEndpoint = createLlmEndpointValidator({
  allowedHosts: allowedLlmHosts,
  allowPrivateEndpoints: allowPrivateLlmEndpoints,
  allowHttpEndpoints: allowHttpLlmEndpoints,
});

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

const toLiteLlmProviderModel = (model) => {
  const trimmed = String(model ?? '').trim();
  return trimmed.startsWith('openai/') ? trimmed : `openai/${trimmed}`;
};

const resolveProviderApiKey = async (modelAlias) => {
  if (!liteLlmSecretBrokerToken) {
    throw new Error('LITELLM_SECRET_BROKER_TOKEN must be configured for provider key resolution.');
  }

  const response = await fetch(`${liteLlmSecretBrokerUrl}/internal/litellm/secrets/${encodeURIComponent(modelAlias)}`, {
    headers: {
      Authorization: `Bearer ${liteLlmSecretBrokerToken}`,
    },
  });
  const body = await jsonResponse(response);
  if (!response.ok || !body.value) {
    throw new Error(body.error ?? `Provider key lookup failed with ${response.status}.`);
  }
  return body.value;
};

const deleteExistingLiteLlmModel = async (modelAlias) => {
  const response = await fetch(`${liteLlmUrl}/model/delete`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${liteLlmAdminKey}`,
    },
    body: JSON.stringify({ id: modelAlias }),
  });

  if ([200, 400, 404].includes(response.status)) {
    return;
  }

  const body = await jsonResponse(response);
  throw new Error(body.error?.message ?? body.error ?? body.raw ?? `LiteLLM model delete returned ${response.status}`);
};

const requireBrokerAuth = (request, response, next) => {
  const header = request.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (token !== brokerToken) {
    logAuditEvent({
      event: 'broker.auth_denied',
      actor: 'api',
      action: 'authorize',
      resourceType: 'litellm_model',
      outcome: 'denied',
      metadata: { route: request.path },
    });
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

    if (!isAllowedLiteLlmAlias(modelAlias)) {
      logAuditEvent({
        event: 'litellm_model.configure',
        actor: 'api',
        action: 'configure',
        resourceType: 'litellm_model',
        resourceId: modelAlias,
        outcome: 'denied',
        metadata: { reason: 'invalid_alias' },
      });
      response.status(400).json({ error: 'Model alias is outside the allowed AIssistAInt namespace.' });
      return;
    }

    if (!isMatchingLiteLlmSecretReference(modelAlias, secretReference)) {
      logAuditEvent({
        event: 'litellm_model.configure',
        actor: 'api',
        action: 'configure',
        resourceType: 'litellm_model',
        resourceId: modelAlias,
        outcome: 'denied',
        metadata: { reason: 'secret_reference_mismatch' },
      });
      response.status(400).json({ error: 'Secret reference must match the model alias namespace.' });
      return;
    }

    if (!model) {
      response.status(400).json({ error: 'Provider model is required.' });
      return;
    }

    await validateLlmEndpoint(endpoint);
    const providerApiKey = await resolveProviderApiKey(modelAlias);
    await deleteExistingLiteLlmModel(modelAlias);

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
          model: toLiteLlmProviderModel(model),
          api_base: endpoint,
          api_key: providerApiKey,
        },
        model_info: {
          id: modelAlias,
        },
      }),
    });
    const body = await jsonResponse(litellmResponse);
    log('LiteLLM model admin request', { modelAlias, status: litellmResponse.status });
    logAuditEvent({
      event: 'litellm_model.configure',
      actor: 'api',
      action: 'configure',
      resourceType: 'litellm_model',
      resourceId: modelAlias,
      outcome: litellmResponse.ok ? 'success' : 'failure',
      metadata: { status: litellmResponse.status },
    });

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
