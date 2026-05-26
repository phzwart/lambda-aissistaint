import { createLlmEndpointValidator } from '../lib/llmEndpointPolicy.mjs';
import { actorFromPayload, logAuditEvent } from '../lib/auditEvents.mjs';
import { jsonResponse } from '../lib/serverUtils.mjs';

// Kept for future use; the original code does not call this helper but builds the chat
// URL ad hoc. Preserved so the LiteLLM client surface is complete.
export const chatCompletionsUrl = (baseUrl) => {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
};

export const createLiteLlmClient = ({ config, log }) => {
  const {
    liteLlmUrl,
    liteLlmApiKey,
    liteLlmAdminBrokerUrl,
    liteLlmAdminBrokerToken,
    llmRequestTimeoutMs,
    allowedLlmHosts,
    allowPrivateLlmEndpoints,
    allowHttpLlmEndpoints,
  } = config;

  const validateLlmEndpoint = createLlmEndpointValidator({
    allowedHosts: allowedLlmHosts,
    allowPrivateEndpoints: allowPrivateLlmEndpoints,
    allowHttpEndpoints: allowHttpLlmEndpoints,
  });

  const callChat = async ({ modelAlias }, messages, { maxTokens = 128, temperature = 0 } = {}) => {
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
      throw new Error(
        body.error?.message ?? body.error ?? body.raw ?? `LLM endpoint failed with ${response.status}`,
      );
    }

    return body;
  };

  const configureModelViaAdminBroker = async ({
    modelAlias,
    model,
    endpoint,
    secretReference,
    actor,
    auditMetadata = {},
  }) => {
    if (!liteLlmAdminBrokerToken) {
      throw new Error('LiteLLM admin broker token is not configured on the backend.');
    }

    const response = await fetch(`${liteLlmAdminBrokerUrl}/internal/litellm/models`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${liteLlmAdminBrokerToken}`,
      },
      body: JSON.stringify({ modelAlias, model, endpoint, secretReference }),
    });
    const body = await jsonResponse(response);
    log('LiteLLM model configuration broker request', {
      modelAlias,
      status: response.status,
    });
    logAuditEvent({
      event: 'litellm_model.configure',
      actor: actor ?? actorFromPayload(),
      action: 'configure',
      resourceType: 'litellm_model',
      resourceId: modelAlias,
      outcome: response.ok ? 'success' : 'failure',
      metadata: { status: response.status, ...auditMetadata },
    });

    if (!response.ok) {
      throw new Error(body.error ?? body.raw ?? `LiteLLM model configuration failed with ${response.status}`);
    }

    return modelAlias;
  };

  return {
    validateLlmEndpoint,
    callChat,
    configureModelViaAdminBroker,
    liteLlmUrl,
    liteLlmApiKey,
  };
};
