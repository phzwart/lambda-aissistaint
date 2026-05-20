// Document-to-wiki synthesis.
//
// Produces a single structured JSON suggestion per document ingest. The
// expected shape is:
//
//   {
//     "title": "<human readable title>",
//     "category": "<one of the wiki categories>",
//     "summary": "<one paragraph>",
//     "section": "<markdown body to insert under a managed section>",
//     "related": [{ "category": "<cat>", "title": "<other page title>" }],
//     "confidence": 0.0-1.0
//   }
//
// The LLM is asked to return only JSON. We parse defensively and fall back to
// a deterministic heuristic extractor if the LLM is unavailable or returns
// non-JSON. The fallback keeps the wiki layer inspectable even without a
// configured LLM tier.

import { normalizeCategory, slugifyTitle, wikiCategories } from './paths.mjs';

const maxChunkBytes = 6000;
const maxChunksConsidered = 12;
const summaryFallbackSentences = 3;
const sentenceSplitPattern = /(?<=[.!?])\s+(?=[A-Z\[])/;

const truncate = (text, limit) => {
  const value = String(text ?? '');
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
};

const flattenChunks = (chunks) => {
  if (!Array.isArray(chunks)) {
    return '';
  }
  const accepted = chunks.slice(0, maxChunksConsidered).map((chunk, index) => {
    const id = chunk?.id ?? `chunk-${index + 1}`;
    const text = truncate(chunk?.text ?? '', maxChunkBytes);
    return `### Chunk ${id}\n${text}`;
  });
  return accepted.join('\n\n');
};

const buildSynthesisPrompt = ({ title, sourceId, chunks, suggestedCategory }) => {
  const corpus = flattenChunks(chunks);
  const categoryList = wikiCategories.join(', ');
  const fallbackCategory = normalizeCategory(suggestedCategory);
  return [
    {
      role: 'system',
      content: [
        'You compile institutional knowledge into a persistent Markdown wiki.',
        'Read the source document chunks below and return ONLY a JSON object.',
        'Do not include code fences, prose, or commentary outside the JSON.',
        `JSON schema: { "title": string, "category": one of [${categoryList}], "summary": string, "section": string, "related": Array<{"category": string, "title": string}>, "confidence": number between 0 and 1 }`,
        'Use [[Wiki Link]] syntax inside "section" for cross-references.',
        'Prefer concise, additive prose suitable for accumulation over time.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `# Source document\n\nTitle: ${title ?? sourceId ?? 'Untitled'}\nSource id: ${sourceId ?? 'unknown'}\nSuggested category: ${fallbackCategory}`,
        `# Chunks\n\n${corpus || '(no chunks provided)'}`,
        '# Instructions\n\nReturn a single JSON object that summarizes this source as a wiki page. Use the category that best fits the document. Suggest 0-5 related concepts as wiki links (cross-page references), favoring entities, datasets, instruments, protocols, projects, or people that appear in the text.',
      ].join('\n\n'),
    },
  ];
};

const stripJsonFences = (value) => {
  const trimmed = String(value ?? '').trim();
  if (trimmed.startsWith('```')) {
    const closingFence = trimmed.lastIndexOf('```');
    if (closingFence > 3) {
      return trimmed.slice(trimmed.indexOf('\n') + 1, closingFence).trim();
    }
  }
  return trimmed;
};

const tryParseJson = (raw) => {
  const stripped = stripJsonFences(raw);
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(stripped.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
};

const normalizeRelated = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const entry of value.slice(0, 12)) {
    const title = String(entry?.title ?? entry?.name ?? entry?.label ?? '').trim();
    if (!title) {
      continue;
    }
    const category = normalizeCategory(entry?.category);
    const key = `${category}/${slugifyTitle(title)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ title, category });
  }
  return result;
};

const heuristicSynthesis = ({ title, sourceId, chunks, suggestedCategory }) => {
  const corpus = (Array.isArray(chunks) ? chunks : [])
    .slice(0, maxChunksConsidered)
    .map((chunk) => String(chunk?.text ?? ''))
    .join('\n\n')
    .trim();
  const sentences = corpus.split(sentenceSplitPattern).filter((sentence) => sentence.trim());
  const summary = sentences.slice(0, summaryFallbackSentences).join(' ').trim() || 'No automatic summary available.';
  return {
    title: String(title ?? sourceId ?? 'Untitled').trim() || 'Untitled',
    category: normalizeCategory(suggestedCategory),
    summary,
    section: corpus
      ? `${summary}\n\n_Heuristic extraction; refine manually or re-ingest with an LLM tier configured._`
      : 'No content extracted from the supplied chunks.',
    related: [],
    confidence: 0.2,
    fallback: true,
  };
};

const normalizeSuggestion = (suggestion, { title, sourceId, suggestedCategory }) => {
  const safeTitle = String(suggestion?.title ?? title ?? sourceId ?? 'Untitled').trim() || 'Untitled';
  const category = normalizeCategory(suggestion?.category ?? suggestedCategory);
  const summary = String(suggestion?.summary ?? '').trim();
  const section = String(suggestion?.section ?? summary).trim() || 'No section content provided.';
  const confidenceRaw = Number(suggestion?.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5;
  return {
    title: safeTitle,
    category,
    summary: summary || 'No summary provided.',
    section,
    related: normalizeRelated(suggestion?.related),
    confidence,
    fallback: Boolean(suggestion?.fallback),
  };
};

// Runs the LLM-driven extraction. `callLlmChatEndpoint` and `extractLlmAnswer`
// are injected so the wiki layer never has to know about LiteLLM details, and
// so tests can substitute a deterministic stub.
export const synthesizeWikiSuggestion = async ({
  title,
  sourceId,
  chunks,
  suggestedCategory,
  llmConfig,
  callLlmChatEndpoint,
  extractLlmAnswer,
  logger,
}) => {
  const heuristic = () => heuristicSynthesis({ title, sourceId, chunks, suggestedCategory });

  if (!llmConfig || typeof callLlmChatEndpoint !== 'function') {
    return normalizeSuggestion(heuristic(), { title, sourceId, suggestedCategory });
  }

  try {
    const messages = buildSynthesisPrompt({ title, sourceId, chunks, suggestedCategory });
    const body = await callLlmChatEndpoint(llmConfig, messages, { maxTokens: 1024, temperature: 0.1 });
    const rawAnswer = typeof extractLlmAnswer === 'function' ? extractLlmAnswer(body) : '';
    const parsed = tryParseJson(rawAnswer);
    if (!parsed) {
      logger?.warn?.('Wiki synthesis fell back to heuristic; LLM returned non-JSON.');
      return normalizeSuggestion({ ...heuristic(), fallback: true }, { title, sourceId, suggestedCategory });
    }
    return normalizeSuggestion(parsed, { title, sourceId, suggestedCategory });
  } catch (error) {
    logger?.warn?.('Wiki synthesis fell back to heuristic.', {
      error: error instanceof Error ? error.message : 'Unknown synthesis error.',
    });
    return normalizeSuggestion({ ...heuristic(), fallback: true }, { title, sourceId, suggestedCategory });
  }
};

export const buildSynthesisChatMessages = buildSynthesisPrompt;
export const parseSynthesisResponse = tryParseJson;
export const heuristicWikiSuggestion = heuristicSynthesis;
