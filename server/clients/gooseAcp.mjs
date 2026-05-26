import { jsonResponse } from '../lib/serverUtils.mjs';

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

export const createGooseAcpClientFactory = ({ config }) => {
  const { internalGooseUrl, gooseSecretKey } = config;

  const gooseAcpUrl = () => `${internalGooseUrl}/acp`;

  const gooseAcpHeaders = (extra = {}) => ({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(gooseSecretKey ? { 'X-Secret-Key': gooseSecretKey } : {}),
    ...extra,
  });

  const createClient = async ({ timeoutMs = 120000 } = {}) => {
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
      throw new Error(
        initializeBody.error?.message ?? initializeBody.error ?? `Goose ACP initialize failed with ${initializeResponse.status}`,
      );
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

  return { createClient };
};
