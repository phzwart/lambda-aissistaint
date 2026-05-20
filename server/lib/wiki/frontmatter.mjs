// Minimal YAML frontmatter parser/serializer for wiki pages.
//
// We intentionally do not pull in a YAML dependency. Wiki frontmatter is a
// flat map of strings, numbers, booleans, and string arrays. Anything richer
// belongs in JSON sidecars, not the page header.

const fenceLine = '---';

const parseScalar = (raw) => {
  const value = raw.trim();
  if (value === '' || value === '~' || value === 'null') {
    return null;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) {
    const n = Number.parseInt(value, 10);
    return Number.isSafeInteger(n) ? n : value;
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return Number.parseFloat(value);
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
};

// Returns { frontmatter, body }. If the document does not start with a YAML
// fence, frontmatter is an empty object and body is the input verbatim.
export const parseFrontmatter = (input) => {
  const text = String(input ?? '');
  if (!text.startsWith(`${fenceLine}\n`) && !text.startsWith(`${fenceLine}\r\n`)) {
    return { frontmatter: {}, body: text };
  }

  const lines = text.split(/\r?\n/);
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === fenceLine) {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex === -1) {
    return { frontmatter: {}, body: text };
  }

  const headerLines = lines.slice(1, closingIndex);
  const frontmatter = {};
  let currentArrayKey = null;
  for (const line of headerLines) {
    if (!line.trim()) {
      currentArrayKey = null;
      continue;
    }
    const arrayItemMatch = line.match(/^\s*-\s+(.*)$/);
    if (arrayItemMatch && currentArrayKey) {
      frontmatter[currentArrayKey].push(parseScalar(arrayItemMatch[1]));
      continue;
    }
    const keyValueMatch = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!keyValueMatch) {
      currentArrayKey = null;
      continue;
    }
    const [, key, rawValue] = keyValueMatch;
    if (rawValue.trim() === '') {
      frontmatter[key] = [];
      currentArrayKey = key;
      continue;
    }
    if (rawValue.trim().startsWith('[') && rawValue.trim().endsWith(']')) {
      const inner = rawValue.trim().slice(1, -1);
      frontmatter[key] = inner.length === 0
        ? []
        : inner.split(',').map((item) => parseScalar(item));
      currentArrayKey = null;
      continue;
    }
    frontmatter[key] = parseScalar(rawValue);
    currentArrayKey = null;
  }

  const body = lines.slice(closingIndex + 1).join('\n').replace(/^\n+/, '');
  return { frontmatter, body };
};

const needsQuoting = (value) => /[:#\n\r"'\[\]{}&*!|>%@`,]/.test(value) || /^\s|\s$/.test(value);

const formatScalar = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  const string = String(value);
  if (string === '') {
    return '""';
  }
  if (needsQuoting(string)) {
    return JSON.stringify(string);
  }
  return string;
};

const formatArray = (key, values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return `${key}: []`;
  }
  const lines = [`${key}:`];
  for (const value of values) {
    lines.push(`  - ${formatScalar(value)}`);
  }
  return lines.join('\n');
};

// Serializes a flat frontmatter object plus a Markdown body into a single
// `---\n...\n---\n\n<body>` string. Field order is preserved.
export const serializeFrontmatter = (frontmatter, body) => {
  const entries = Object.entries(frontmatter ?? {}).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return String(body ?? '').replace(/^\n+/, '');
  }

  const headerLines = entries.map(([key, value]) => {
    if (Array.isArray(value)) {
      return formatArray(key, value);
    }
    return `${key}: ${formatScalar(value)}`;
  });

  const bodyText = String(body ?? '').replace(/^\n+/, '');
  return `${fenceLine}\n${headerLines.join('\n')}\n${fenceLine}\n\n${bodyText}`;
};
