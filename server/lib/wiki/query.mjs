// Wiki-first grounded retrieval and Q&A.
//
// The query path explicitly avoids embeddings and vector stores. Wiki pages
// are small enough (and deliberately structured) that token-overlap scoring
// against the question gives reasonable results while keeping the system
// inspectable.
//
// We:
//   1. score every existing wiki page against the question by overlap and by
//      mentions of any [[wikilink]] target the question text references;
//   2. take the top K pages and build a grounded prompt for the LLM;
//   3. ask the LLM to answer ONLY using the wiki context and cite the page
//      titles it consulted.
//
// If no LLM is configured the function still returns the candidate pages so
// the user can read them directly - the wiki remains useful without AI.

import { parsePage } from './pageDocument.mjs';
import { pageRefKey } from './paths.mjs';

const stopWords = new Set([
  'a', 'an', 'and', 'or', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'of', 'in', 'on',
  'to', 'from', 'for', 'with', 'by', 'as', 'at', 'this', 'that', 'these', 'those', 'it', 'its',
  'what', 'which', 'who', 'when', 'where', 'why', 'how', 'do', 'does', 'did', 'about', 'any',
  'into', 'over', 'under', 'than', 'then', 'so', 'such', 'we', 'you', 'they', 'i', 'me', 'my',
  'our', 'your', 'their', 'has', 'have', 'had', 'can', 'could', 'should', 'would', 'will',
]);

const tokenize = (text) => {
  const matches = String(text ?? '').toLowerCase().match(/[a-z0-9][a-z0-9-]+/g);
  if (!matches) {
    return [];
  }
  return matches.filter((token) => token.length > 2 && !stopWords.has(token));
};

const tokenSet = (text) => {
  const set = new Set();
  for (const token of tokenize(text)) {
    set.add(token);
  }
  return set;
};

const scorePage = ({ questionTokens, page }) => {
  if (!questionTokens.size) {
    return 0;
  }
  const titleTokens = tokenSet(page.frontmatter?.title ?? page.slug ?? '');
  const bodyTokens = tokenSet(page.body ?? '');
  let score = 0;
  for (const token of questionTokens) {
    if (titleTokens.has(token)) {
      score += 3;
    }
    if (bodyTokens.has(token)) {
      score += 1;
    }
  }
  if (page.frontmatter?.sources?.length) {
    score += 0.5;
  }
  return score;
};

const truncateBody = (body, limit) => {
  const text = String(body ?? '');
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 1)}…`;
};

export const rankWikiPages = async ({ storage, question, limit = 6 }) => {
  const refs = await storage.listPageRefs();
  const candidates = [];
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
    candidates.push({
      key: pageRefKey(ref),
      category: ref.category,
      slug: ref.slug,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
    });
  }

  const questionTokens = tokenSet(question);
  const scored = candidates
    .map((page) => ({ page, score: scorePage({ questionTokens, page }) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
};

const buildAnswerPrompt = ({ question, rankedPages, contextBudget }) => {
  const perPageBudget = Math.max(800, Math.floor(contextBudget / Math.max(1, rankedPages.length)));
  const contextSections = rankedPages.map(({ page }, index) => {
    const title = page.frontmatter?.title ?? page.slug;
    const category = page.frontmatter?.category ?? page.category;
    const sources = Array.isArray(page.frontmatter?.sources) ? page.frontmatter.sources : [];
    const heading = `## [${index + 1}] ${title} (${category})`;
    const sourcesLine = sources.length ? `Sources: ${sources.join(', ')}` : 'Sources: (none recorded)';
    return `${heading}\n${sourcesLine}\nKey: ${page.key}\n\n${truncateBody(page.body, perPageBudget)}`;
  });

  return [
    {
      role: 'system',
      content: [
        'You answer questions strictly using the persistent wiki pages supplied by the user.',
        'Cite the page titles you used in parentheses, e.g. "(Beamline Alignment)".',
        'If the wiki context does not contain the answer, say so and recommend ingesting more sources.',
        'Do not invent facts that are not present in the wiki context.',
      ].join(' '),
    },
    {
      role: 'user',
      content: `# Question\n\n${String(question ?? '').trim()}\n\n# Wiki Context\n\n${contextSections.join('\n\n')}\n\n# Instructions\n\nAnswer the question using only the wiki context. Cite page titles. If the wiki has no relevant information, state that explicitly.`,
    },
  ];
};

export const queryWiki = async ({
  storage,
  question,
  limit = 6,
  contextBudget = 6000,
  llmConfig,
  callLlmChatEndpoint,
  extractLlmAnswer,
  logger,
}) => {
  const rankedPages = await rankWikiPages({ storage, question, limit });
  const citedPages = rankedPages.map(({ page, score }) => ({
    key: page.key,
    category: page.category,
    slug: page.slug,
    title: page.frontmatter?.title ?? page.slug,
    score,
    sources: Array.isArray(page.frontmatter?.sources) ? page.frontmatter.sources : [],
  }));

  if (rankedPages.length === 0) {
    return {
      answer: 'The wiki does not yet contain anything relevant to this question. Ingest source documents to populate it.',
      citedPages: [],
      llmUsed: false,
    };
  }

  if (!llmConfig || typeof callLlmChatEndpoint !== 'function') {
    const titles = citedPages.map((page) => page.title).join(', ');
    return {
      answer: `No LLM tier is configured for wiki query; returning the most relevant pages: ${titles}.`,
      citedPages,
      llmUsed: false,
    };
  }

  try {
    const messages = buildAnswerPrompt({ question, rankedPages, contextBudget });
    const body = await callLlmChatEndpoint(llmConfig, messages, { maxTokens: 768, temperature: 0.1 });
    const answer = typeof extractLlmAnswer === 'function' ? extractLlmAnswer(body) : '';
    return {
      answer: String(answer ?? '').trim() || 'The model did not return an answer for this question.',
      citedPages,
      llmUsed: true,
    };
  } catch (error) {
    logger?.warn?.('Wiki query LLM call failed; returning ranked pages only.', {
      error: error instanceof Error ? error.message : 'Unknown query error.',
    });
    return {
      answer: 'Wiki query could not reach the configured LLM. Showing the most relevant pages instead.',
      citedPages,
      llmUsed: false,
      error: error instanceof Error ? error.message : 'Unknown query error.',
    };
  }
};

export const tokenizeQuestion = tokenize;
