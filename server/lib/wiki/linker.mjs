// Wiki link parsing and backlink index construction.
//
// We use a `[[Display Text]]` or `[[category:Display Text]]` syntax with an
// optional alias `[[target|label]]`. Resolution is intentionally simple: we
// slugify the target and pair it with either the prefix-declared category or
// the configured default.

import { guessPageRef, normalizeCategory, pageRefKey, slugifyTitle } from './paths.mjs';

const wikiLinkPattern = /\[\[([^\]\n]+)\]\]/g;

export const parseWikiLink = (raw) => {
  const value = String(raw ?? '').trim();
  if (!value) {
    return null;
  }
  const [targetPart, labelPart] = value.split('|').map((part) => part.trim());
  const ref = guessPageRef(targetPart);
  if (!ref) {
    return null;
  }
  return {
    category: ref.category,
    slug: ref.slug,
    label: labelPart || targetPart,
    raw: value,
  };
};

// Returns the unique `category/slug` references mentioned by a page body.
export const extractWikiLinks = (body) => {
  const text = String(body ?? '');
  const seen = new Map();
  let match;
  // Reset stateful regex.
  wikiLinkPattern.lastIndex = 0;
  while ((match = wikiLinkPattern.exec(text)) !== null) {
    const link = parseWikiLink(match[1]);
    if (!link) {
      continue;
    }
    const key = pageRefKey(link);
    if (!seen.has(key)) {
      seen.set(key, link);
    }
  }
  return [...seen.values()];
};

// Rebuilds the backlinks index from the collection of page documents.
//
// Index shape:
//   { [targetCategory/targetSlug]: [{ from: sourceCategory/sourceSlug, label, count }] }
export const buildBacklinkIndex = (pages) => {
  const index = {};
  for (const page of Array.isArray(pages) ? pages : []) {
    if (!page?.body || !page?.slug || !page?.category) {
      continue;
    }
    const fromKey = pageRefKey({ category: page.category, slug: page.slug });
    const links = extractWikiLinks(page.body);
    for (const link of links) {
      const targetKey = pageRefKey(link);
      if (targetKey === fromKey) {
        continue;
      }
      const list = index[targetKey] ?? (index[targetKey] = []);
      const existing = list.find((entry) => entry.from === fromKey);
      if (existing) {
        existing.count += 1;
      } else {
        list.push({ from: fromKey, label: link.label, count: 1 });
      }
    }
  }
  return index;
};

// Returns the slug references that exist in a page body but do not yet have a
// corresponding page document. Useful for stub generation.
export const findUnresolvedLinks = (body, existingPageKeys = []) => {
  const known = new Set(existingPageKeys.map((value) => String(value)));
  return extractWikiLinks(body).filter((link) => !known.has(pageRefKey(link)));
};

export const renderWikiLinkSlug = (category, slug) =>
  pageRefKey({ category: normalizeCategory(category), slug: slugifyTitle(slug) });
