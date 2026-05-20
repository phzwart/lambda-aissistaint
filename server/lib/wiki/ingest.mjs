// Wiki ingest orchestration.
//
// Given a parsed source document (title, sourceId, chunks) we:
//   1. ask the LLM (or heuristic fallback) for a structured suggestion;
//   2. read or stub the target page;
//   3. merge frontmatter additively (source list union, related list union,
//      updated timestamp refreshed);
//   4. upsert a managed Markdown section keyed by the source id so future
//      ingests replace the section in place instead of duplicating prose;
//   5. ensure stub pages exist for related wiki links;
//   6. rebuild the backlinks index and append provenance + ingest log.
//
// The function returns the updated page key, the suggestion the LLM produced,
// and the list of stub pages it created. None of this requires new
// infrastructure: every artifact lives as a Markdown or JSON object in the
// project's existing MinIO bucket.

import { buildBacklinkIndex, extractWikiLinks } from './linker.mjs';
import {
  buildEmptyPage,
  mergeFrontmatter,
  parsePage,
  sectionIdFromSource,
  serializePage,
  upsertManagedSection,
} from './pageDocument.mjs';
import { normalizeCategory, pageRefKey, slugifyTitle, wikiCategories } from './paths.mjs';
import {
  appendIngestLogEntry,
  emptyIngestLog,
  emptyProvenanceIndex,
  recordProvenance,
} from './provenance.mjs';
import { synthesizeWikiSuggestion } from './synthesize.mjs';

const isoNow = () => new Date().toISOString();

const ensureStubPage = async ({ storage, category, slug, title }) => {
  const existing = await storage.readPageMarkdown(category, slug);
  if (existing) {
    return { created: false, key: storage.pageKey(category, slug) };
  }
  const stub = buildEmptyPage({ title: title || slug, category, slug });
  stub.frontmatter.sources = [];
  stub.frontmatter.related = [];
  await storage.writePageMarkdown(category, slug, serializePage(stub));
  return { created: true, key: storage.pageKey(category, slug) };
};

const refreshBacklinks = async (storage) => {
  const refs = await storage.listPageRefs();
  const pages = [];
  for (const ref of refs) {
    const markdown = await storage.readPageMarkdown(ref.category, ref.slug);
    if (!markdown) {
      continue;
    }
    const parsed = parsePage(markdown, {
      fallbackCategory: ref.category,
      fallbackSlug: ref.slug,
      fallbackTitle: ref.slug,
    });
    pages.push({ category: ref.category, slug: ref.slug, body: parsed.body });
  }
  const index = buildBacklinkIndex(pages);
  await storage.writeMetadataJson('backlinks.json', {
    version: 1,
    updatedAt: isoNow(),
    entries: index,
  });
  return index;
};

const sourceListAddition = ({ sourceId, sourceTitle }) => {
  const safe = String(sourceId ?? '').trim();
  if (!safe) {
    return null;
  }
  const label = String(sourceTitle ?? '').trim();
  return label && label !== safe ? `${safe} (${label})` : safe;
};

export const ingestDocument = async ({
  storage,
  document,
  llmConfig,
  callLlmChatEndpoint,
  extractLlmAnswer,
  logger,
}) => {
  if (!storage) {
    throw new Error('Wiki ingest requires storage.');
  }
  if (!document || typeof document !== 'object') {
    throw new Error('Wiki ingest requires a document.');
  }

  const sourceId = String(document.sourceId ?? '').trim() || `manual-${Date.now()}`;
  const sourceTitle = String(document.title ?? '').trim() || sourceId;
  const chunks = Array.isArray(document.chunks)
    ? document.chunks
    : document.text
      ? [{ id: 'inline', text: String(document.text) }]
      : [];

  const suggestion = await synthesizeWikiSuggestion({
    title: sourceTitle,
    sourceId,
    chunks,
    suggestedCategory: document.suggestedCategory,
    llmConfig,
    callLlmChatEndpoint,
    extractLlmAnswer,
    logger,
  });

  const targetCategory = normalizeCategory(document.category ?? suggestion.category);
  const targetSlug = slugifyTitle(document.slug ?? suggestion.title ?? sourceTitle);
  const existingMarkdown = await storage.readPageMarkdown(targetCategory, targetSlug);
  const page = existingMarkdown
    ? parsePage(existingMarkdown, {
        fallbackCategory: targetCategory,
        fallbackSlug: targetSlug,
        fallbackTitle: suggestion.title,
      })
    : buildEmptyPage({ title: suggestion.title, category: targetCategory, slug: targetSlug });

  const sectionId = sectionIdFromSource(sourceId);
  const newBody = upsertManagedSection(page.body || '', {
    sectionId,
    sourceId,
    heading: `Notes from ${sourceTitle}`,
    content: suggestion.section,
    updatedAt: isoNow(),
  });

  const relatedLinks = suggestion.related.map((entry) => ({
    category: entry.category,
    slug: slugifyTitle(entry.title),
    title: entry.title,
  }));

  const additionLabel = sourceListAddition({ sourceId, sourceTitle });
  const mergedFrontmatter = mergeFrontmatter(page.frontmatter, {
    title: suggestion.title || page.frontmatter.title,
    category: targetCategory,
    slug: targetSlug,
    sources: additionLabel ? [additionLabel] : [],
    related: relatedLinks.map((link) => pageRefKey(link)),
    confidence: suggestion.confidence,
    updated: isoNow(),
  });

  const updatedPage = { frontmatter: mergedFrontmatter, body: newBody };
  await storage.writePageMarkdown(targetCategory, targetSlug, serializePage(updatedPage));

  const createdStubs = [];
  const existingRefs = new Set((await storage.listPageRefs()).map((ref) => pageRefKey(ref)));
  for (const link of relatedLinks) {
    const refKey = pageRefKey(link);
    if (existingRefs.has(refKey)) {
      continue;
    }
    const result = await ensureStubPage({ storage, category: link.category, slug: link.slug, title: link.title });
    if (result.created) {
      createdStubs.push({ category: link.category, slug: link.slug, title: link.title });
      existingRefs.add(refKey);
    }
  }

  // Walk through wiki links that appear inside the new section but were not
  // returned by the LLM (e.g. user-authored links inserted by hand) and stub
  // those too, so backlinks stay consistent.
  const inlineLinks = extractWikiLinks(suggestion.section);
  for (const link of inlineLinks) {
    const refKey = pageRefKey(link);
    if (existingRefs.has(refKey)) {
      continue;
    }
    const stubTitle = link.label || link.slug;
    const result = await ensureStubPage({
      storage,
      category: link.category,
      slug: link.slug,
      title: stubTitle,
    });
    if (result.created) {
      createdStubs.push({ category: link.category, slug: link.slug, title: stubTitle });
      existingRefs.add(refKey);
    }
  }

  const pageKey = pageRefKey({ category: targetCategory, slug: targetSlug });
  const provenance = recordProvenance(
    (await storage.readMetadataJson('provenance.json', emptyProvenanceIndex())) ?? emptyProvenanceIndex(),
    {
      pageKey,
      sectionId,
      sourceId,
      sourceTitle,
      chunkIds: chunks.map((chunk, index) => String(chunk?.id ?? `chunk-${index + 1}`)),
      confidence: suggestion.confidence,
    },
  );
  await storage.writeMetadataJson('provenance.json', provenance);

  const ingestLog = appendIngestLogEntry(
    (await storage.readMetadataJson('ingest_log.json', emptyIngestLog())) ?? emptyIngestLog(),
    {
      sourceId,
      sourceTitle,
      affectedPages: [pageKey, ...createdStubs.map((stub) => pageRefKey(stub))],
      action: existingMarkdown ? 'update' : 'create',
      confidence: suggestion.confidence,
      notes: suggestion.fallback ? 'Heuristic fallback (no LLM).' : null,
    },
  );
  await storage.writeMetadataJson('ingest_log.json', ingestLog);

  const backlinks = await refreshBacklinks(storage);

  return {
    pageKey,
    category: targetCategory,
    slug: targetSlug,
    sectionId,
    suggestion,
    createdStubs,
    backlinkCount: Object.keys(backlinks).length,
    pageCount: existingRefs.size,
  };
};

export const supportedIngestCategories = wikiCategories;
