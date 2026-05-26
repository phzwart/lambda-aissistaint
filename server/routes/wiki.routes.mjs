import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { asyncHandler } from '../middleware/asyncHandler.mjs';
import { logAuditEvent } from '../lib/auditEvents.mjs';
import { listProjectFiles } from '../lib/projectFiles.mjs';
import {
  defaultWikiCategory,
  normalizeCategory as wikiNormalizeCategory,
  pageRefKey as wikiPageRefKey,
  slugifyTitle as wikiSlugifyTitle,
} from '../lib/wiki/paths.mjs';
import { parsePage as wikiParsePage } from '../lib/wiki/pageDocument.mjs';
import { queryWiki as wikiQuery } from '../lib/wiki/query.mjs';
import { ingestDocument as wikiIngestDocument } from '../lib/wiki/ingest.mjs';
import {
  ingestProcessedFileToWiki,
  listWikiProcessedSources,
  syncProcessedFilesToWiki,
} from '../lib/wiki/processedSources.mjs';

export const createWikiRouter = ({ config, middleware, services, deps }) => {
  const router = Router();
  const { requireAuth, userSubject } = middleware;
  const { projects, wiki, llmConfig } = services;
  const { log } = deps;
  const { wikiMaxPageBytes, wikiMaxChunksPerIngest, paperqaIngestWiki } = config;

  router.get(
    '/api/projects/:id/wiki/pages',
    requireAuth,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, [
        'owner',
        'editor',
        'viewer',
      ]);
      const storage = wiki.wikiStorageForProject(project);
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
        summaries.push(
          wiki.wikiPageSummary({ key: storage.pageKey(ref.category, ref.slug), ref, page }),
        );
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
      response.json({ pages: summaries, categories: wiki.wikiCategories });
    }),
  );

  router.get(
    '/api/projects/:id/wiki/pages/:category/:slug',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { category, slug } = request.params;
      if (!wiki.isValidWikiCategory(category)) {
        response.status(400).json({ error: 'Unsupported wiki category.' });
        return;
      }
      const project = await projects.requireProjectAccess(request.params.id, request, [
        'owner',
        'editor',
        'viewer',
      ]);
      const storage = wiki.wikiStorageForProject(project);
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
      const backlinkIndex =
        (await storage.readMetadataJson('backlinks.json', { entries: {} }))?.entries ?? {};
      const provenanceIndex =
        (await storage.readMetadataJson('provenance.json', { entries: {} }))?.entries ?? {};
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
    }),
  );

  router.put(
    '/api/projects/:id/wiki/pages/:category/:slug',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { category, slug } = request.params;
      if (!wiki.isValidWikiCategory(category)) {
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
      const project = await projects.requireProjectAccess(request.params.id, request, ['owner', 'editor']);
      const storage = wiki.wikiStorageForProject(project);
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
    }),
  );

  router.delete(
    '/api/projects/:id/wiki/pages/:category/:slug',
    requireAuth,
    asyncHandler(async (request, response) => {
      const { category, slug } = request.params;
      if (!wiki.isValidWikiCategory(category)) {
        response.status(400).json({ error: 'Unsupported wiki category.' });
        return;
      }
      const project = await projects.requireProjectAccess(request.params.id, request, ['owner', 'editor']);
      const storage = wiki.wikiStorageForProject(project);
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
    }),
  );

  router.get(
    '/api/projects/:id/wiki/sources',
    requireAuth,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, [
        'owner',
        'editor',
        'viewer',
      ]);
      const client = projects.requireProjectMinio(project);
      const storage = wiki.wikiStorageForProject(project);
      const sources = await listWikiProcessedSources({ client, project, storage });
      response.json({
        sources,
        autoIngestOnProcess: paperqaIngestWiki,
      });
    }),
  );

  router.post(
    '/api/projects/:id/wiki/sync-processed',
    requireAuth,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, ['owner', 'editor']);
      const client = projects.requireProjectMinio(project);
      const storage = wiki.wikiStorageForProject(project);
      const fileIds = Array.isArray(request.body?.fileIds)
        ? request.body.fileIds.map((id) => String(id).trim()).filter(Boolean)
        : undefined;
      const wikiLlmConfig = await wiki.loadWikiLlmConfig(request.user);
      const result = await syncProcessedFilesToWiki({
        client,
        project,
        storage,
        fileIds,
        llmConfig: wikiLlmConfig,
        callLlmChatEndpoint: wikiLlmConfig ? llmConfig.callLlmChatEndpoint : undefined,
        extractLlmAnswer: wikiLlmConfig ? llmConfig.extractLlmAnswer : undefined,
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
    }),
  );

  router.post(
    '/api/projects/:id/wiki/ingest/:fileId',
    requireAuth,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, ['owner', 'editor']);
      const client = projects.requireProjectMinio(project);
      const storage = wiki.wikiStorageForProject(project);
      const files = await listProjectFiles(client, project);
      const file = files.find((entry) => entry.id === request.params.fileId);
      if (!file) {
        response.status(404).json({ error: 'File not found in this project.' });
        return;
      }
      const wikiLlmConfig = await wiki.loadWikiLlmConfig(request.user);
      const result = await ingestProcessedFileToWiki({
        client,
        project,
        file,
        storage,
        llmConfig: wikiLlmConfig,
        callLlmChatEndpoint: wikiLlmConfig ? llmConfig.callLlmChatEndpoint : undefined,
        extractLlmAnswer: wikiLlmConfig ? llmConfig.extractLlmAnswer : undefined,
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
    }),
  );

  router.post(
    '/api/projects/:id/wiki/ingest',
    requireAuth,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, ['owner', 'editor']);
      const storage = wiki.wikiStorageForProject(project);

      const sourceId = String(request.body?.sourceId ?? '').trim() || `manual-${randomUUID()}`;
      const title = String(request.body?.title ?? '').trim() || sourceId;
      const suggestedCategory = wiki.isValidWikiCategory(request.body?.category)
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

      const wikiLlmConfig = await wiki.loadWikiLlmConfig(request.user);
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
        llmConfig: wikiLlmConfig,
        callLlmChatEndpoint: wikiLlmConfig ? llmConfig.callLlmChatEndpoint : undefined,
        extractLlmAnswer: wikiLlmConfig ? llmConfig.extractLlmAnswer : undefined,
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
          llmUsed: Boolean(wikiLlmConfig),
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
        llmUsed: Boolean(wikiLlmConfig),
        suggestion: {
          title: result.suggestion.title,
          category: result.suggestion.category,
          summary: result.suggestion.summary,
          confidence: result.suggestion.confidence,
          fallback: result.suggestion.fallback,
          related: result.suggestion.related,
        },
      });
    }),
  );

  router.post(
    '/api/projects/:id/wiki/query',
    requireAuth,
    asyncHandler(async (request, response) => {
      const question = String(request.body?.question ?? '').trim();
      if (!question) {
        response.status(400).json({ error: 'A question is required.' });
        return;
      }
      const limit = Math.min(Math.max(Number.parseInt(request.body?.limit ?? '6', 10) || 6, 1), 12);
      const project = await projects.requireProjectAccess(request.params.id, request, [
        'owner',
        'editor',
        'viewer',
      ]);
      const storage = wiki.wikiStorageForProject(project);
      const wikiLlmConfig = await wiki.loadWikiLlmConfig(request.user);
      const result = await wikiQuery({
        storage,
        question,
        limit,
        llmConfig: wikiLlmConfig,
        callLlmChatEndpoint: wikiLlmConfig ? llmConfig.callLlmChatEndpoint : undefined,
        extractLlmAnswer: wikiLlmConfig ? llmConfig.extractLlmAnswer : undefined,
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
    }),
  );

  router.get(
    '/api/projects/:id/wiki/backlinks',
    requireAuth,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, [
        'owner',
        'editor',
        'viewer',
      ]);
      const storage = wiki.wikiStorageForProject(project);
      const backlinks =
        (await storage.readMetadataJson('backlinks.json', { entries: {} })) ?? { entries: {} };
      const ingestLog = (await storage.readMetadataJson('ingest_log.json', { entries: [] })) ?? {
        entries: [],
      };
      response.json({
        backlinks: backlinks.entries ?? {},
        ingestLog: Array.isArray(ingestLog.entries) ? ingestLog.entries.slice(0, 50) : [],
      });
    }),
  );

  return router;
};
