// Task planner runtime (currently Goose-backed via clients/gooseAcp.mjs).
// Designed as a swappable boundary: routes call sanitizeMessages/callChat/testAdapter
// and never touch the underlying engine. Replace the implementation when the engine changes.
import { randomUUID } from 'node:crypto';

export const createTaskPlannerService = ({ config, deps, services }) => {
  const { gooseAcp, log } = deps;
  const { llmConfig } = services;
  const { gooseChatbotMaxMessages, gooseChatbotDefaultTier, gooseWorkingDir, internalGooseUrl } = config;

  const normalizeChatRole = (role) => {
    const normalized = String(role ?? '').toLowerCase();
    return ['system', 'user', 'assistant'].includes(normalized) ? normalized : 'user';
  };

  const sanitizeMessages = (messages) => {
    if (!Array.isArray(messages)) {
      throw Object.assign(new Error('Messages must be an array.'), { status: 400 });
    }

    const boundedMaxMessages =
      Number.isFinite(gooseChatbotMaxMessages) && gooseChatbotMaxMessages > 0 ? gooseChatbotMaxMessages : 24;
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

  const tierIndex = (tier) => {
    const requestedTier = String(tier || gooseChatbotDefaultTier).toLowerCase();
    const index = llmConfig.configuredLlmTiers.indexOf(requestedTier);
    return index >= 0 ? index : 0;
  };

  const loadChatbotConfig = async (user, tier) => {
    const index = tierIndex(tier);
    return llmConfig.loadRunnableLlmConfig(user, { id: `openbao-llm-${index + 1}` });
  };

  // Kept for parity with the original code (currently unused by callers but harmless).
  const messageEnvelope = (message) => ({
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
  void messageEnvelope;

  const callChatEndpoint = async ({ modelAlias }, messages, { workingDir = gooseWorkingDir } = {}) => {
    const client = await gooseAcp.createClient();
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

  const testAdapter = async (spec) => {
    const restartRequiredKeys = spec?.runtime?.restartRequiredKeys ?? [];
    const result = {
      engine: spec?.engine ?? 'goose',
      reachable: false,
      restartRequired: restartRequiredKeys.length > 0,
      restartRequiredKeys,
      message: '',
    };

    if (spec?.engine !== 'goose') {
      return {
        ...result,
        reachable: true,
        restartRequired: false,
        message: 'No Goose validation is required for this planner engine.',
      };
    }
    if (!internalGooseUrl) {
      return { ...result, message: 'INTERNAL_GOOSE_URL is not configured.' };
    }

    let client;
    try {
      client = await gooseAcp.createClient({ timeoutMs: 10000 });
      const session = await client.send('session/new', { cwd: gooseWorkingDir, mcpServers: [] });
      const sessionId = session?.result?.sessionId;
      return {
        ...result,
        reachable: Boolean(sessionId),
        message: sessionId
          ? 'Goose accepted an ACP session/new request.'
          : 'Goose ACP session/new did not return a session id.',
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

  void log;

  return {
    sanitizeMessages,
    callChatEndpoint,
    loadChatbotConfig,
    testAdapter,
    tierIndex,
    gooseWorkingDir,
  };
};
