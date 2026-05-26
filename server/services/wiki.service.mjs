import { createWikiStorage } from '../lib/wiki/storage.mjs';
import { wikiCategories } from '../lib/wiki/paths.mjs';

export const createWikiService = ({ config, deps, services }) => {
  const { minio, log } = deps;
  const { llmConfig } = services;
  const { wikiBucketPrefix, wikiMetadataPrefix, wikiDefaultTier } = config;

  const wikiStorageForProject = (project) => {
    if (!minio.app) {
      throw Object.assign(new Error('MinIO credentials are not configured on the backend.'), { status: 503 });
    }
    if (!project?.bucketName) {
      throw Object.assign(new Error('Project does not have a MinIO bucket configured.'), { status: 400 });
    }
    return createWikiStorage({
      client: minio.app,
      bucket: project.bucketName,
      wikiPrefix: wikiBucketPrefix,
      metadataPrefix: wikiMetadataPrefix,
    });
  };

  const loadWikiLlmConfig = async (user) => {
    const tier = wikiDefaultTier;
    const index = llmConfig.configuredLlmTiers.indexOf(tier);
    const safeIndex = index >= 0 ? index : 0;
    try {
      return await llmConfig.loadRunnableLlmConfig(user, { id: `openbao-llm-${safeIndex + 1}` });
    } catch (error) {
      log('Wiki LLM tier unavailable; falling back to heuristic synthesis', {
        tier,
        detail: error instanceof Error ? error.message : 'Unknown LLM lookup error.',
      });
      return null;
    }
  };

  const wikiPageSummary = ({ key, ref, page }) => ({
    key,
    category: ref.category,
    slug: ref.slug,
    title: page.frontmatter?.title ?? ref.slug,
    updated: page.frontmatter?.updated ?? null,
    created: page.frontmatter?.created ?? null,
    sources: Array.isArray(page.frontmatter?.sources) ? page.frontmatter.sources : [],
    related: Array.isArray(page.frontmatter?.related) ? page.frontmatter.related : [],
    confidence: page.frontmatter?.confidence ?? null,
  });

  const isValidWikiCategory = (value) => wikiCategories.includes(String(value ?? '').toLowerCase());

  return {
    wikiStorageForProject,
    loadWikiLlmConfig,
    wikiPageSummary,
    isValidWikiCategory,
    wikiCategories,
  };
};
