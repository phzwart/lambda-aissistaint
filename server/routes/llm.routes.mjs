import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { asyncHandler } from '../middleware/asyncHandler.mjs';
import { logAuditEvent } from '../lib/auditEvents.mjs';
import { isAllowedLiteLlmAlias } from '../lib/brokerPolicy.mjs';
import { validatePlannerExecutionPayload } from '../lib/plannerSkillCatalog.mjs';

export const createLlmRouter = ({ config, middleware, services, deps }) => {
  const router = Router();
  const { requireAuth, userSubject } = middleware;
  const { llmConfig, secrets, taskPlanner, planner, repository } = services;
  const { litellm, log } = deps;

  router.get(
    '/internal/litellm/secrets/:modelAlias',
    asyncHandler(async (request, response) => {
      const header = request.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
      if (!config.liteLlmSecretBrokerToken || token !== config.liteLlmSecretBrokerToken) {
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
        response
          .status(400)
          .json({ error: 'Model alias is outside the allowed AIssistAInt namespace.' });
        return;
      }

      const aliasRecord = await secrets.read(secrets.aliasPath(modelAlias));
      const secretPathForAlias = aliasRecord?.data?.data?.secretPath;
      if (!secretPathForAlias) {
        response.status(404).json({ error: 'Secret alias not found.' });
        return;
      }

      const secretRecord = await secrets.read(secretPathForAlias);
      const secretData = secretRecord?.data?.data ?? {};
      const value = secrets.decryptProviderToken(secretData, secrets.providerTokenAad(secretPathForAlias));
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
    }),
  );

  router.get(
    '/api/llm-config',
    requireAuth,
    asyncHandler(async (request, response) => {
      log('GET /api/llm-config', { subject: userSubject(request) });
      const configs = await Promise.all(
        Array.from({ length: llmConfig.llmEndpointCount }, (_, index) =>
          llmConfig.toLlmConfig(request.user, index),
        ),
      );
      log('GET /api/llm-config complete', {
        count: configs.length,
        states: configs.map((cfg) => cfg.secretLeaseStatus ?? 'unknown'),
      });
      response.json({ configs });
    }),
  );

  router.post(
    '/api/llm-config',
    requireAuth,
    asyncHandler(async (request, response) => {
      const configs = Array.isArray(request.body?.configs) ? request.body.configs : [];
      const now = new Date().toISOString();
      log('POST /api/llm-config', {
        count: configs.length,
        endpoints: configs.map((cfg, index) => ({
          index: index + 1,
          name: llmConfig.systemLlmName(index),
          tier: llmConfig.defaultTier(index),
          hasEndpoint: Boolean(cfg.endpoint),
          model: cfg.model,
          hasToken: Boolean(cfg.token),
        })),
      });

      const preparedConfigs = await Promise.all(
        Array.from({ length: llmConfig.llmEndpointCount }, async (_unused, index) => {
          const cfg = configs[index] ?? {};
          const path = secrets.secretPath(request.user, index);
          const existingSecret = await secrets.read(path);
          const existingData = existingSecret?.data?.data ?? {};
          const endpoint = cfg.endpoint ?? existingData.endpoint ?? '';
          const model = cfg.model ?? existingData.model ?? '';
          const modelAlias = llmConfig.liteLlmModelAlias(request.user, index);
          let encryptedTokenFields = {
            encryptedToken: existingData.encryptedToken,
            iv: existingData.iv,
            authTag: existingData.authTag,
            keyVersion: existingData.keyVersion,
            tokenFingerprint: existingData.tokenFingerprint,
          };

          if (cfg.token) {
            encryptedTokenFields = secrets.encryptProviderToken(cfg.token, secrets.providerTokenAad(path));
          } else if (!existingData.encryptedToken && existingData.token) {
            encryptedTokenFields = secrets.encryptProviderToken(
              existingData.token,
              secrets.providerTokenAad(path),
            );
          }
          if (endpoint) {
            await litellm.validateLlmEndpoint(endpoint);
          }

          const isDisabled = !endpoint && !model && !cfg.token;
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
              new Error(
                `${llmConfig.systemLlmName(index)} must include a provider base URL, provider model, and provider API key before it can be saved.`,
              ),
              { status: 400 },
            );
          }

          return {
            index,
            path,
            id: cfg.id ?? `secret-llm-${index + 1}`,
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

      if (!preparedConfigs.some((cfg) => cfg.isComplete)) {
        throw Object.assign(
          new Error('Configure at least one complete LiteLLM endpoint: LLM_A, LLM_B, or LLM_C.'),
          { status: 400 },
        );
      }

      await Promise.all(
        preparedConfigs.map(
          async ({ index, path, id, endpoint, model, modelAlias, encryptedTokenFields, hasProviderKey, isDisabled }) => {
            if (isDisabled) {
              await Promise.all([
                secrets.deleteMetadata(path).catch((error) => {
                  if (error?.status !== 404) {
                    throw error;
                  }
                }),
                secrets.deleteMetadata(secrets.aliasPath(modelAlias)).catch((error) => {
                  if (error?.status !== 404) {
                    throw error;
                  }
                }),
              ]);
              return;
            }

            await secrets.write(path, {
              id,
              name: llmConfig.systemLlmName(index),
              endpoint,
              model,
              modelAlias,
              tier: llmConfig.defaultTier(index),
              ...encryptedTokenFields,
              updatedAt: now,
            });

            await secrets.write(secrets.aliasPath(modelAlias), {
              modelAlias,
              secretPath: path,
              userSegment: secrets.secretUserSegment(request.user),
              index,
              tier: llmConfig.defaultTier(index),
              updatedAt: now,
            });

            if (endpoint && model && hasProviderKey) {
              await llmConfig.configureLiteLlmModel(request.user, index, { endpoint, model });
            }
          },
        ),
      );

      const savedConfigs = await Promise.all(
        Array.from({ length: llmConfig.llmEndpointCount }, (_, index) =>
          llmConfig.toLlmConfig(request.user, index),
        ),
      );
      log('POST /api/llm-config complete', {
        count: savedConfigs.length,
        secretNames: savedConfigs.map((cfg) => cfg.secretName),
      });
      logAuditEvent({
        event: 'llm_config.save',
        actor: userSubject(request),
        action: 'save',
        resourceType: 'llm_config',
        outcome: 'success',
        metadata: {
          count: savedConfigs.length,
          endpoints: savedConfigs.map((cfg) => cfg.name),
          states: savedConfigs.map((cfg) => cfg.secretLeaseStatus ?? 'unknown'),
        },
      });
      response.json({ configs: savedConfigs });
    }),
  );

  router.post(
    '/api/llm-config/test',
    requireAuth,
    asyncHandler(async (request, response) => {
      const cfg = await llmConfig.loadRunnableLlmConfig(request.user, request.body?.config ?? {});
      log('POST /api/llm-config/test', {
        index: cfg.index + 1,
        name: cfg.name,
        modelAlias: cfg.modelAlias,
      });
      await llmConfig.callLlmChatEndpoint(cfg, 'Reply with only: ok');
      logAuditEvent({
        event: 'llm_config.test',
        actor: userSubject(request),
        action: 'test',
        resourceType: 'llm_config',
        resourceId: cfg.modelAlias,
        outcome: 'success',
        metadata: { endpoint: cfg.name, index: cfg.index + 1 },
      });
      response.json({
        status: 'success',
        message: `Connection test succeeded for ${cfg.name}.`,
        lastTestedAt: new Date().toISOString(),
      });
    }),
  );

  router.post(
    '/api/goose/chat',
    requireAuth,
    asyncHandler(async (request, response) => {
      const messages = taskPlanner.sanitizeMessages(request.body?.messages);
      const requestedTier = request.body?.tier;
      const projectId = String(request.body?.projectId ?? '').trim();
      const plannerMode = request.body?.plannerMode === true;
      let plannerContext = null;
      if (plannerMode && !projectId) {
        throw Object.assign(new Error('projectId is required for planner mode.'), { status: 400 });
      }
      if (plannerMode && config.gooseChatbotBackend !== 'goose') {
        throw Object.assign(new Error('Planner mode requires the Goose backend.'), { status: 400 });
      }
      if (plannerMode && projectId) {
        await repository.checkProjectRoleStandalone(projectId, request, ['owner', 'editor', 'viewer']);
        plannerContext = await planner.loadProjectPlannerContext(request.user, projectId);
      }
      const requestedSystemPrompt = String(request.body?.systemPrompt ?? '').trim();
      const systemPrompt = String(
        plannerMode
          ? [config.gooseChatbotSystemPrompt, plannerContext?.systemPrompt, requestedSystemPrompt]
              .filter(Boolean)
              .join('\n\n')
          : requestedSystemPrompt || config.gooseChatbotSystemPrompt,
      ).trim();
      const chatMessages = systemPrompt
        ? [{ role: 'system', content: systemPrompt }, ...messages.filter((message) => message.role !== 'system')]
        : messages;
      const maxTokens =
        Number.isFinite(config.gooseChatbotMaxTokens) && config.gooseChatbotMaxTokens > 0
          ? config.gooseChatbotMaxTokens
          : 768;
      const temperature = Number.isFinite(config.gooseChatbotTemperature)
        ? config.gooseChatbotTemperature
        : 0.2;
      let answer = '';
      let gooseSessionId;
      let backend = 'litellm';
      let activeConfig;
      if (config.gooseChatbotBackend === 'goose') {
        try {
          const plannerAlias = plannerContext?.config?.roleBindings?.planner;
          const plannerTier = /^LLM_[ABC]$/i.test(plannerAlias ?? '')
            ? plannerAlias.slice(-1).toLowerCase()
            : undefined;
          activeConfig = await taskPlanner.loadChatbotConfig(request.user, plannerTier);
          const gooseReply = await taskPlanner.callChatEndpoint(activeConfig, chatMessages, {
            workingDir: plannerContext?.workspace?.containerPath ?? taskPlanner.gooseWorkingDir,
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
        activeConfig = await taskPlanner.loadChatbotConfig(request.user, requestedTier);
        const body = await llmConfig.callLlmChatEndpoint(activeConfig, chatMessages, {
          maxTokens,
          temperature,
        });
        answer = llmConfig.extractLlmAnswer(body);
      }
      let plannerPayload = null;
      if (plannerMode) {
        plannerPayload = validatePlannerExecutionPayload(answer, {
          visibleSkills: plannerContext?.visibleSkills ?? [],
        });
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
    }),
  );

  router.post(
    '/api/llm-config/chat',
    requireAuth,
    asyncHandler(async (request, response) => {
      const question = String(request.body?.question ?? '').trim();
      if (!question) {
        response.status(400).json({ error: 'Question is required.' });
        return;
      }

      const cfg = await llmConfig.loadRunnableLlmConfig(request.user, request.body?.config ?? {});
      log('POST /api/llm-config/chat', {
        index: cfg.index + 1,
        name: cfg.name,
        modelAlias: cfg.modelAlias,
        questionLength: question.length,
      });
      const body = await llmConfig.callLlmChatEndpoint(cfg, question);
      logAuditEvent({
        event: 'llm_config.chat',
        actor: userSubject(request),
        action: 'chat',
        resourceType: 'llm_config',
        resourceId: cfg.modelAlias,
        outcome: 'success',
        metadata: { endpoint: cfg.name, index: cfg.index + 1, questionLength: question.length },
      });
      response.json({
        answer: llmConfig.extractLlmAnswer(body),
      });
    }),
  );

  router.delete(
    '/api/llm-config/secrets',
    requireAuth,
    asyncHandler(async (request, response) => {
      log('DELETE /api/llm-config/secrets', { count: llmConfig.llmEndpointCount });
      await Promise.all(
        Array.from({ length: llmConfig.llmEndpointCount }, async (_unused, index) => {
          await secrets.deleteMetadata(secrets.secretPath(request.user, index));
        }),
      );

      log('DELETE /api/llm-config/secrets complete');
      logAuditEvent({
        event: 'llm_config.secrets_delete',
        actor: userSubject(request),
        action: 'delete',
        resourceType: 'llm_config',
        outcome: 'success',
        metadata: { count: llmConfig.llmEndpointCount },
      });
      response.status(204).send();
    }),
  );

  return router;
};
