import type { CSSProperties, ReactNode } from 'react';

type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'wiki'; target: string; label: string }
  | { kind: 'link'; href: string; label: string }
  | { kind: 'code'; value: string }
  | { kind: 'strong'; value: string }
  | { kind: 'em'; value: string };

const tokenizeInline = (text: string): InlineToken[] => {
  const tokens: InlineToken[] = [];
  let cursor = 0;

  const pushText = (value: string) => {
    if (value) {
      tokens.push({ kind: 'text', value });
    }
  };

  while (cursor < text.length) {
    const wikiMatch = text.slice(cursor).match(/^\[\[([^\]\n]+)\]\]/);
    if (wikiMatch) {
      const [, raw] = wikiMatch;
      const [target, label] = raw.split('|').map((part) => part.trim());
      tokens.push({ kind: 'wiki', target, label: label || target });
      cursor += wikiMatch[0].length;
      continue;
    }
    const linkMatch = text.slice(cursor).match(/^\[([^\]\n]+)\]\(([^)\s]+)\)/);
    if (linkMatch) {
      tokens.push({ kind: 'link', href: linkMatch[2], label: linkMatch[1] });
      cursor += linkMatch[0].length;
      continue;
    }
    const codeMatch = text.slice(cursor).match(/^`([^`\n]+)`/);
    if (codeMatch) {
      tokens.push({ kind: 'code', value: codeMatch[1] });
      cursor += codeMatch[0].length;
      continue;
    }
    const strongMatch = text.slice(cursor).match(/^\*\*([^*\n]+)\*\*/);
    if (strongMatch) {
      tokens.push({ kind: 'strong', value: strongMatch[1] });
      cursor += strongMatch[0].length;
      continue;
    }
    const emMatch = text.slice(cursor).match(/^_([^_\n]+)_/);
    if (emMatch) {
      tokens.push({ kind: 'em', value: emMatch[1] });
      cursor += emMatch[0].length;
      continue;
    }

    const next = text.indexOf('[[', cursor + 1);
    const nextLink = text.indexOf('[', cursor + 1);
    const nextCode = text.indexOf('`', cursor + 1);
    const nextStrong = text.indexOf('**', cursor + 1);
    const nextEm = text.indexOf('_', cursor + 1);
    const candidates = [next, nextLink, nextCode, nextStrong, nextEm].filter((index) => index !== -1);
    const stop = candidates.length ? Math.min(...candidates) : text.length;
    pushText(text.slice(cursor, stop));
    cursor = stop;
  }
  return tokens;
};

const renderInline = (text: string, onWikiLink: (target: string) => void, keyPrefix: string) => {
  const tokens = tokenizeInline(text);
  return tokens.map((token, index) => {
    const childKey = `${keyPrefix}-${index}`;
    switch (token.kind) {
      case 'wiki':
        return (
          <button
            key={childKey}
            type="button"
            onClick={() => onWikiLink(token.target)}
            style={wikiLinkButtonStyle}
            title={token.target}
          >
            {token.label}
          </button>
        );
      case 'link':
        return (
          <a key={childKey} href={token.href} target="_blank" rel="noreferrer" style={{ color: '#1f4e79' }}>
            {token.label}
          </a>
        );
      case 'code':
        return (
          <code key={childKey} style={inlineCodeStyle}>
            {token.value}
          </code>
        );
      case 'strong':
        return <strong key={childKey}>{token.value}</strong>;
      case 'em':
        return <em key={childKey}>{token.value}</em>;
      default:
        return <span key={childKey}>{token.value}</span>;
    }
  });
};

const renderMarkdownBody = (markdown: string, onWikiLink: (target: string) => void) => {
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const elements: ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let codeBuffer: string[] = [];
  let inCode = false;
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    const text = paragraph.join(' ').trim();
    if (text) {
      elements.push(
        <p key={`p-${key++}`} style={paragraphStyle}>
          {renderInline(text, onWikiLink, `p-${key}`)}
        </p>,
      );
    }
    paragraph = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      listItems = [];
      listType = null;
      return;
    }
    const items = listItems.map((item, index) => (
      <li key={`li-${key}-${index}`} style={{ marginBottom: 4 }}>
        {renderInline(item, onWikiLink, `li-${key}-${index}`)}
      </li>
    ));
    if (listType === 'ol') {
      elements.push(
        <ol key={`ol-${key++}`} style={{ paddingLeft: 22, marginBottom: 12 }}>
          {items}
        </ol>,
      );
    } else {
      elements.push(
        <ul key={`ul-${key++}`} style={{ paddingLeft: 22, marginBottom: 12 }}>
          {items}
        </ul>,
      );
    }
    listItems = [];
    listType = null;
  };

  for (const line of lines) {
    if (inCode) {
      if (line.startsWith('```')) {
        elements.push(
          <pre key={`code-${key++}`} style={codeBlockStyle}>
            <code>{codeBuffer.join('\n')}</code>
          </pre>,
        );
        codeBuffer = [];
        inCode = false;
        continue;
      }
      codeBuffer.push(line);
      continue;
    }

    if (line.startsWith('```')) {
      flushParagraph();
      flushList();
      inCode = true;
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const Tag = (`h${Math.min(4, level + 1)}` as 'h2' | 'h3' | 'h4' | 'h5');
      elements.push(
        <Tag key={`h-${key++}`} style={{ marginTop: level === 1 ? 0 : 18, marginBottom: 8 }}>
          {renderInline(text, onWikiLink, `h-${key}`)}
        </Tag>,
      );
      continue;
    }

    const ulMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (ulMatch) {
      flushParagraph();
      if (listType !== 'ul') {
        flushList();
        listType = 'ul';
      }
      listItems.push(ulMatch[1]);
      continue;
    }

    const olMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (olMatch) {
      flushParagraph();
      if (listType !== 'ol') {
        flushList();
        listType = 'ol';
      }
      listItems.push(olMatch[1]);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (inCode && codeBuffer.length) {
    elements.push(
      <pre key={`code-${key++}`} style={codeBlockStyle}>
        <code>{codeBuffer.join('\n')}</code>
      </pre>,
    );
  }
  flushParagraph();
  flushList();

  return elements;
};

export function MarkdownView({
  markdown,
  onWikiLink,
  style,
}: {
  markdown: string;
  onWikiLink?: (target: string) => void;
  style?: CSSProperties;
}) {
  const handleWikiLink = onWikiLink ?? (() => {});
  return <div style={style}>{renderMarkdownBody(markdown, handleWikiLink)}</div>;
}

const paragraphStyle = {
  margin: '0 0 12px',
  lineHeight: 1.6,
} satisfies CSSProperties;

const codeBlockStyle = {
  background: '#f4f6fa',
  border: '1px solid #dbe3ee',
  borderRadius: 8,
  padding: 12,
  overflow: 'auto',
  marginBottom: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 13,
} satisfies CSSProperties;

const inlineCodeStyle = {
  background: '#f4f6fa',
  borderRadius: 4,
  padding: '0 4px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 12,
} satisfies CSSProperties;

const wikiLinkButtonStyle = {
  border: 0,
  background: 'transparent',
  padding: 0,
  color: '#1f4e79',
  fontWeight: 700,
  cursor: 'pointer',
  textDecoration: 'underline',
} satisfies CSSProperties;
