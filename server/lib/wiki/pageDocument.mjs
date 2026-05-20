// Wiki page document model.
//
// A page document is parsed into:
//   - frontmatter: flat YAML map (title, slug, category, sources, related,
//     created, updated, confidence, verified_at)
//   - sections: ordered list of { heading, content, marker? }
//
// Sections derived from automated ingest are wrapped with HTML comment markers
// so that a later ingest can replace just that section, leaving manually
// edited prose untouched. The marker shape is:
//
//   <!-- aissistaint:section start=<id> source=<sourceId> updated=<iso> -->
//   ...section markdown...
//   <!-- aissistaint:section end=<id> -->
//
// Free-form (human-authored) sections live in the body between markers and
// are preserved verbatim across ingests.

import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';
import { normalizeCategory, slugifyTitle } from './paths.mjs';

const sectionStartPattern = /<!--\s*aissistaint:section\s+start=([A-Za-z0-9_-]+)(?:\s+source=([^\s]+))?(?:\s+updated=([^\s]+))?\s*-->/;
const sectionEndPattern = /<!--\s*aissistaint:section\s+end=([A-Za-z0-9_-]+)\s*-->/;

export const sectionIdFromSource = (sourceId) => {
  const safe = String(sourceId ?? '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `src-${safe || 'unknown'}`;
};

const ensureArray = (value) => (Array.isArray(value) ? value.filter((item) => item !== undefined && item !== null && item !== '') : []);

const dedupePreserveOrder = (values) => {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = String(value);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
};

const isoNow = () => new Date().toISOString();

export const buildEmptyPage = ({ title, category, slug }) => {
  const safeCategory = normalizeCategory(category);
  const safeSlug = slugifyTitle(slug || title || 'page');
  const safeTitle = String(title ?? safeSlug).trim() || safeSlug;
  const now = isoNow();
  return {
    frontmatter: {
      title: safeTitle,
      slug: safeSlug,
      category: safeCategory,
      created: now,
      updated: now,
      sources: [],
      related: [],
      confidence: null,
      verified_at: null,
    },
    body: `# ${safeTitle}\n\n_No content yet. Ingest a source document to populate this page._\n`,
  };
};

export const parsePage = (markdown, { fallbackTitle, fallbackCategory, fallbackSlug } = {}) => {
  const { frontmatter, body } = parseFrontmatter(markdown);
  const stub = buildEmptyPage({
    title: frontmatter.title ?? fallbackTitle,
    category: frontmatter.category ?? fallbackCategory,
    slug: frontmatter.slug ?? fallbackSlug,
  });
  return {
    frontmatter: {
      ...stub.frontmatter,
      ...frontmatter,
      sources: ensureArray(frontmatter.sources),
      related: ensureArray(frontmatter.related),
    },
    body: body || stub.body,
  };
};

export const serializePage = (page) => serializeFrontmatter(page.frontmatter, page.body);

// Upserts a managed section identified by `sectionId`. If a section with that
// id already exists between markers, it is replaced in place. Otherwise it is
// appended to the body. Human-authored prose outside any marker is preserved.
export const upsertManagedSection = (body, { sectionId, sourceId, heading, content, updatedAt }) => {
  const text = String(body ?? '');
  const safeSectionId = String(sectionId ?? sectionIdFromSource(sourceId)).replace(/[^A-Za-z0-9_-]+/g, '-');
  const updated = updatedAt ?? isoNow();
  const sanitizedSource = String(sourceId ?? '').replace(/\s+/g, '_');
  const startMarker = `<!-- aissistaint:section start=${safeSectionId} source=${sanitizedSource || 'unknown'} updated=${updated} -->`;
  const endMarker = `<!-- aissistaint:section end=${safeSectionId} -->`;
  const sectionHeading = heading ? `## ${heading}\n\n` : '';
  const replacement = `${startMarker}\n${sectionHeading}${content.trim()}\n${endMarker}`;

  const startMatch = text.match(new RegExp(`<!--\\s*aissistaint:section\\s+start=${safeSectionId}\\b[^>]*-->`));
  if (startMatch && startMatch.index !== undefined) {
    const endIndex = text.indexOf(endMarker, startMatch.index);
    if (endIndex !== -1) {
      const before = text.slice(0, startMatch.index);
      const after = text.slice(endIndex + endMarker.length);
      return `${before}${replacement}${after}`;
    }
  }

  const separator = text.endsWith('\n') ? '\n' : '\n\n';
  return `${text}${separator}\n${replacement}\n`;
};

// Iterates managed sections in a page body. Returns [{ sectionId, sourceId, content }].
export const listManagedSections = (body) => {
  const text = String(body ?? '');
  const sections = [];
  let cursor = 0;
  while (cursor < text.length) {
    const startMatch = text.slice(cursor).match(sectionStartPattern);
    if (!startMatch || startMatch.index === undefined) {
      break;
    }
    const startIndex = cursor + startMatch.index;
    const endMatch = text.slice(startIndex).match(sectionEndPattern);
    if (!endMatch || endMatch.index === undefined) {
      break;
    }
    const sectionId = startMatch[1];
    const sourceId = startMatch[2] || null;
    const updatedAt = startMatch[3] || null;
    const contentStart = startIndex + startMatch[0].length;
    const contentEnd = startIndex + endMatch.index;
    sections.push({
      sectionId,
      sourceId,
      updatedAt,
      content: text.slice(contentStart, contentEnd).trim(),
    });
    cursor = contentEnd + endMatch[0].length;
  }
  return sections;
};

// Updates frontmatter merges incrementally: source list union, related list
// union (deduped), updated stamp refreshed. Preserves user-authored values.
export const mergeFrontmatter = (existing, additions) => {
  const next = { ...existing };
  if (additions.title !== undefined && additions.title !== null && String(additions.title).trim()) {
    next.title = String(additions.title).trim();
  }
  if (additions.category) {
    next.category = normalizeCategory(additions.category);
  }
  if (additions.slug) {
    next.slug = slugifyTitle(additions.slug);
  }
  if (additions.sources) {
    next.sources = dedupePreserveOrder([...(existing.sources ?? []), ...ensureArray(additions.sources)]);
  }
  if (additions.related) {
    next.related = dedupePreserveOrder([...(existing.related ?? []), ...ensureArray(additions.related)]);
  }
  if (additions.confidence !== undefined) {
    const numeric = Number(additions.confidence);
    next.confidence = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : existing.confidence ?? null;
  }
  if (additions.verified_at) {
    next.verified_at = additions.verified_at;
  }
  next.updated = additions.updated ?? isoNow();
  if (!next.created) {
    next.created = existing.created ?? next.updated;
  }
  return next;
};
