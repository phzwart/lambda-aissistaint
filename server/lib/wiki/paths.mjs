// Path and slug conventions for the persistent wiki layer.
//
// Pages live inside the existing per-project MinIO bucket under a
// `wiki/<category>/<slug>.md` key. Derived sidecars (backlinks, provenance,
// ingest log) live under `metadata/`. Both prefixes are configurable via
// environment variables but default to filesystem-friendly names.
//
// Categories are an enumerated set kept deliberately small. The prompt asks us
// not to overdesign metadata schemas; we keep this list flat and extend it
// only when a real ingestion source demands it.

export const wikiCategories = Object.freeze([
  'entities',
  'concepts',
  'projects',
  'protocols',
  'datasets',
  'people',
]);

export const defaultWikiCategory = 'concepts';
export const wikiPageExtension = '.md';

const slugCharPattern = /[^a-z0-9]+/g;
const trimDashesPattern = /^-+|-+$/g;
const slugMaxLength = 80;

export const slugifyTitle = (title) => {
  const normalized = String(title ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(slugCharPattern, '-')
    .replace(trimDashesPattern, '');
  return normalized.slice(0, slugMaxLength) || 'page';
};

export const normalizeCategory = (category) => {
  const value = String(category ?? '').trim().toLowerCase();
  return wikiCategories.includes(value) ? value : defaultWikiCategory;
};

export const wikiPageKey = ({ prefix, category, slug }) => {
  const safeCategory = normalizeCategory(category);
  const safeSlug = slugifyTitle(slug);
  return `${prefix}/${safeCategory}/${safeSlug}${wikiPageExtension}`;
};

export const wikiMetadataKey = ({ prefix, name }) => {
  const safeName = String(name ?? '').replace(/[^A-Za-z0-9_.-]+/g, '-');
  return `${prefix}/${safeName}`;
};

// Parses a stored S3 key like `wiki/concepts/beamline-alignment.md` into a
// page identity. Returns null for keys that aren't valid wiki page keys.
export const parseWikiPageKey = (key, { prefix } = {}) => {
  const normalizedPrefix = String(prefix ?? 'wiki').replace(/^\/+|\/+$/g, '');
  const normalizedKey = String(key ?? '').replace(/^\/+/, '');
  if (!normalizedKey.startsWith(`${normalizedPrefix}/`)) {
    return null;
  }
  const remainder = normalizedKey.slice(normalizedPrefix.length + 1);
  const parts = remainder.split('/');
  if (parts.length !== 2 || !parts[1].endsWith(wikiPageExtension)) {
    return null;
  }
  const [category, file] = parts;
  if (!wikiCategories.includes(category)) {
    return null;
  }
  return {
    category,
    slug: file.slice(0, -wikiPageExtension.length),
  };
};

// `Entity Name` -> `entities/entity-name`. Used by wikilink resolution when
// the target page's category is unknown; defaults to the configured default.
export const guessPageRef = (target, { defaultCategory = defaultWikiCategory } = {}) => {
  const raw = String(target ?? '').trim();
  if (!raw) {
    return null;
  }
  const explicit = raw.match(/^([a-z]+)\s*[:/]\s*(.+)$/i);
  if (explicit) {
    return {
      category: normalizeCategory(explicit[1]),
      slug: slugifyTitle(explicit[2]),
    };
  }
  return {
    category: defaultCategory,
    slug: slugifyTitle(raw),
  };
};

export const pageRefKey = ({ category, slug }) => `${normalizeCategory(category)}/${slugifyTitle(slug)}`;
