import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { wikiService } from '../services/wikiService';
import { useWorkflowStore } from '../state/workflowStore';
import type {
  FileProcessingStatus,
  WikiBacklink,
  WikiCategory,
  WikiPageDetail,
  WikiPageSummary,
  WikiProcessedSource,
  WikiProvenanceEntry,
  WikiQueryCitedPage,
} from '../types/domain';

type ActivePage = {
  detail: WikiPageDetail;
  backlinks: WikiBacklink[];
  provenance: WikiProvenanceEntry[];
};

type IngestForm = {
  title: string;
  category: WikiCategory;
  text: string;
};

const wikiCategoryList: WikiCategory[] = [
  'entities',
  'concepts',
  'projects',
  'protocols',
  'datasets',
  'people',
];

const parsePageKey = (key: string): { category: WikiCategory; slug: string } | null => {
  const [category, slug] = key.split('/');
  if (!category || !slug) {
    return null;
  }
  if (!wikiCategoryList.includes(category as WikiCategory)) {
    return null;
  }
  return { category: category as WikiCategory, slug };
};

const slugifyClient = (input: string) =>
  input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'page';

// Minimal Markdown renderer. We support headings, paragraphs, bullet/numbered
// lists, fenced code blocks, inline code, bold, italics, and [[wiki links]].
// Anything richer should be reviewed against the "no framework soup" rule.
const renderMarkdown = (markdown: string, onWikiLink: (target: string) => void) => {
  const lines = markdown.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const elements: JSX.Element[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let codeBuffer: string[] = [];
  let inCode = false;
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
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
      elements.push(<ol key={`ol-${key++}`} style={{ paddingLeft: 22, marginBottom: 12 }}>{items}</ol>);
    } else {
      elements.push(<ul key={`ul-${key++}`} style={{ paddingLeft: 22, marginBottom: 12 }}>{items}</ul>);
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
    if (value) tokens.push({ kind: 'text', value });
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

const formatTimestamp = (value: string | null | undefined) => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
};

export function WikiPage() {
  const activeProject = useWorkflowStore((state) => state.activeProject);
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<ActivePage | null>(null);
  const [view, setView] = useState<'rendered' | 'source'>('rendered');
  const [draftMarkdown, setDraftMarkdown] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ingestForm, setIngestForm] = useState<IngestForm>({ title: '', category: 'concepts', text: '' });
  const [ingestStatus, setIngestStatus] = useState<string | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const [processedSources, setProcessedSources] = useState<WikiProcessedSource[]>([]);
  const [autoIngestOnProcess, setAutoIngestOnProcess] = useState(true);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [queryAnswer, setQueryAnswer] = useState<string | null>(null);
  const [queryCitedPages, setQueryCitedPages] = useState<WikiQueryCitedPage[]>([]);
  const [queryUsedLlm, setQueryUsedLlm] = useState<boolean | null>(null);
  const [isQuerying, setIsQuerying] = useState(false);

  const projectId = activeProject?.id ?? '';

  const refreshPages = useCallback(async () => {
    if (!projectId) {
      setPages([]);
      return;
    }
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const result = await wikiService.list(projectId);
      setPages(result.pages);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to list wiki pages.');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  const refreshSources = useCallback(async () => {
    if (!projectId) {
      setProcessedSources([]);
      return;
    }
    try {
      setIsLoadingSources(true);
      const result = await wikiService.listSources(projectId);
      setProcessedSources(result.sources);
      setAutoIngestOnProcess(result.autoIngestOnProcess);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load processed sources.');
    } finally {
      setIsLoadingSources(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refreshPages();
    void refreshSources();
  }, [refreshPages, refreshSources]);

  const openPage = useCallback(
    async (key: string) => {
      if (!projectId) return;
      const parsed = parsePageKey(key);
      if (!parsed) return;
      try {
        setIsLoading(true);
        setErrorMessage(null);
        const result = await wikiService.get(projectId, parsed.category, parsed.slug);
        setActiveKey(key);
        setActivePage({ detail: result.page, backlinks: result.backlinks, provenance: result.provenance });
        setDraftMarkdown(result.page.markdown);
        setView('rendered');
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load wiki page.');
      } finally {
        setIsLoading(false);
      }
    },
    [projectId],
  );

  const handleWikiLink = useCallback(
    async (target: string) => {
      const [maybeCategory, ...rest] = target.split(':');
      const hasCategory = wikiCategoryList.includes(maybeCategory.trim().toLowerCase() as WikiCategory);
      const category = hasCategory ? (maybeCategory.trim().toLowerCase() as WikiCategory) : 'concepts';
      const titleSource = hasCategory ? rest.join(':').trim() : target.trim();
      const slug = slugifyClient(titleSource || target);
      const key = `${category}/${slug}`;
      const existing = pages.find((page) => page.key === key);
      if (existing) {
        await openPage(key);
        return;
      }
      setErrorMessage(
        `No wiki page yet for "${titleSource || target}". Process a PDF on File Management, then sync it into the wiki.`,
      );
    },
    [openPage, pages],
  );

  const handleSave = async () => {
    if (!projectId || !activePage) return;
    try {
      setIsSaving(true);
      setErrorMessage(null);
      await wikiService.upsert(projectId, activePage.detail.category, activePage.detail.slug, draftMarkdown);
      await refreshPages();
      await openPage(`${activePage.detail.category}/${activePage.detail.slug}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save wiki page.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncProcessed = async (fileIds?: string[]) => {
    if (!projectId) return;
    try {
      setIsSyncing(true);
      setSyncStatus(null);
      setErrorMessage(null);
      const result = await wikiService.syncProcessed(projectId, fileIds);
      const parts = [
        result.ingested.length ? `${result.ingested.length} ingested` : null,
        result.skipped.length ? `${result.skipped.length} skipped` : null,
        result.errors.length ? `${result.errors.length} failed` : null,
      ].filter(Boolean);
      setSyncStatus(parts.join(', ') || 'Nothing to sync.');
      await refreshPages();
      await refreshSources();
      if (result.ingested[0]) {
        await openPage(result.ingested[0].pageKey);
      }
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : 'Sync failed.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleIngestOne = async (fileId: string) => {
    if (!projectId) return;
    try {
      setIsSyncing(true);
      setSyncStatus(null);
      const result = await wikiService.ingestProcessedFile(projectId, fileId);
      setSyncStatus(`Ingested ${result.pageKey}${result.suggestion.fallback ? ' (heuristic)' : ''}.`);
      await refreshPages();
      await refreshSources();
      await openPage(result.pageKey);
    } catch (error) {
      setSyncStatus(error instanceof Error ? error.message : 'Ingest failed.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleIngest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId) return;
    if (!ingestForm.title.trim() || !ingestForm.text.trim()) {
      setIngestStatus('Title and content are required.');
      return;
    }
    try {
      setIsIngesting(true);
      setIngestStatus(null);
      const sourceId = `manual-${Date.now()}`;
      const result = await wikiService.ingest(projectId, {
        sourceId,
        title: ingestForm.title.trim(),
        category: ingestForm.category,
        text: ingestForm.text,
      });
      setIngestStatus(
        `${result.suggestion.fallback ? 'Heuristic' : 'LLM'} ingest created/updated ${result.pageKey}` +
          (result.createdStubs.length ? ` plus ${result.createdStubs.length} linked stub(s)` : '') +
          '.',
      );
      setIngestForm({ title: '', category: 'concepts', text: '' });
      await refreshPages();
      await openPage(result.pageKey);
    } catch (error) {
      setIngestStatus(error instanceof Error ? error.message : 'Ingest failed.');
    } finally {
      setIsIngesting(false);
    }
  };

  const handleQuery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!projectId || !question.trim()) return;
    try {
      setIsQuerying(true);
      setErrorMessage(null);
      const result = await wikiService.query(projectId, question.trim());
      setQueryAnswer(result.answer);
      setQueryCitedPages(result.citedPages);
      setQueryUsedLlm(result.llmUsed);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Query failed.');
    } finally {
      setIsQuerying(false);
    }
  };

  const pendingWikiSources = useMemo(
    () => processedSources.filter((source) => source.status === 'completed' && source.hasSummary && !source.wikiPageKey),
    [processedSources],
  );

  const pagesByCategory = useMemo(() => {
    const groups = new Map<WikiCategory, WikiPageSummary[]>();
    for (const category of wikiCategoryList) {
      groups.set(category, []);
    }
    for (const page of pages) {
      const bucket = groups.get(page.category) ?? [];
      bucket.push(page);
      groups.set(page.category, bucket);
    }
    return groups;
  }, [pages]);

  if (!projectId) {
    return (
      <div style={emptyStateStyle}>
        <h1 style={{ margin: 0, fontSize: 28 }}>Wiki</h1>
        <p style={{ color: '#667085' }}>
          Select an active project to view its persistent wiki. Pages, backlinks, and provenance live
          inside the project's existing MinIO bucket under the <code>wiki/</code> and{' '}
          <code>metadata/</code> prefixes.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section>
        <h1 style={{ margin: 0, fontSize: 28 }}>Wiki</h1>
        <p style={{ margin: '8px 0 0', color: '#667085', fontSize: 16 }}>
          Knowledge compiled from <strong>processed PDF summaries</strong> in this project. Run Process on{' '}
          <Link to="/files" style={{ color: '#1f4e79' }}>
            File Management
          </Link>
          ; summaries under <code>parsed/</code> are synthesized into wiki pages here.
          {autoIngestOnProcess
            ? ' New completions are ingested automatically when processing finishes.'
            : ' Automatic wiki ingest on process is disabled — use Sync below.'}
        </p>
      </section>

      {errorMessage && <div style={errorStyle}>{errorMessage}</div>}

      <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'minmax(240px, 320px) 1fr' }}>
        <aside style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Pages</h2>
            <button type="button" onClick={() => void refreshPages()} style={ghostButtonStyle} disabled={isLoading}>
              Refresh
            </button>
          </div>
          {pages.length === 0 && (
            <p style={{ color: '#667085', fontSize: 14 }}>
              No wiki pages yet. Process PDFs on File Management, then sync summaries below.
            </p>
          )}
          {wikiCategoryList.map((category) => {
            const items = pagesByCategory.get(category) ?? [];
            if (items.length === 0) return null;
            return (
              <div key={category} style={{ marginBottom: 14 }}>
                <div style={categoryHeaderStyle}>{category}</div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {items.map((page) => (
                    <li key={page.key}>
                      <button
                        type="button"
                        onClick={() => void openPage(page.key)}
                        style={{
                          ...pageButtonStyle,
                          background: activeKey === page.key ? '#eaf2fb' : '#ffffff',
                          borderColor: activeKey === page.key ? '#1f4e79' : '#dbe3ee',
                        }}
                      >
                        <div style={{ fontWeight: 700 }}>{page.title}</div>
                        <div style={{ fontSize: 12, color: '#667085' }}>
                          {page.sources.length} source(s) · updated {formatTimestamp(page.updated)}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </aside>

        <section style={{ display: 'grid', gap: 16 }}>
          {activePage ? (
            <article style={cardStyle}>
              <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <div>
                  <h2 style={{ margin: 0 }}>{String(activePage.detail.frontmatter.title ?? activePage.detail.slug)}</h2>
                  <p style={{ margin: '4px 0 0', color: '#667085', fontSize: 13 }}>
                    {activePage.detail.category} / {activePage.detail.slug} · updated{' '}
                    {formatTimestamp(String(activePage.detail.frontmatter.updated ?? ''))}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setView(view === 'rendered' ? 'source' : 'rendered')}
                    style={ghostButtonStyle}
                  >
                    {view === 'rendered' ? 'Edit source' : 'View rendered'}
                  </button>
                  {view === 'source' && (
                    <button type="button" onClick={() => void handleSave()} disabled={isSaving} style={primaryButtonStyle}>
                      {isSaving ? 'Saving…' : 'Save'}
                    </button>
                  )}
                </div>
              </header>

              {Array.isArray(activePage.detail.frontmatter.sources) &&
                activePage.detail.frontmatter.sources.length > 0 && (
                  <div style={metadataRowStyle}>
                    <strong>Sources:</strong>
                    {(activePage.detail.frontmatter.sources as string[]).map((source) => (
                      <span key={source} style={pillStyle}>{source}</span>
                    ))}
                  </div>
                )}

              {view === 'rendered' ? (
                <div>{renderMarkdown(activePage.detail.body, handleWikiLink)}</div>
              ) : (
                <textarea
                  value={draftMarkdown}
                  onChange={(event) => setDraftMarkdown(event.target.value)}
                  rows={20}
                  style={textareaStyle}
                  spellCheck={false}
                />
              )}

              <details style={detailsBoxStyle}>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
                  Backlinks ({activePage.backlinks.length})
                </summary>
                {activePage.backlinks.length === 0 ? (
                  <p style={{ color: '#667085', margin: '8px 0 0' }}>No other pages link here yet.</p>
                ) : (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                    {activePage.backlinks.map((backlink) => (
                      <li key={backlink.from}>
                        <button
                          type="button"
                          onClick={() => void openPage(backlink.from)}
                          style={wikiLinkButtonStyle}
                        >
                          {backlink.from}
                        </button>{' '}
                        ({backlink.count})
                      </li>
                    ))}
                  </ul>
                )}
              </details>

              <details style={detailsBoxStyle}>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
                  Provenance ({activePage.provenance.length})
                </summary>
                {activePage.provenance.length === 0 ? (
                  <p style={{ color: '#667085', margin: '8px 0 0' }}>
                    No ingest provenance recorded for this page yet.
                  </p>
                ) : (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                    {activePage.provenance.map((entry) => (
                      <li key={`${entry.sectionId}-${entry.sourceId}-${entry.recordedAt}`}>
                        <code>{entry.sectionId}</code> ← {entry.sourceTitle || entry.sourceId} ·{' '}
                        {entry.chunkIds.length} chunk(s) · confidence {entry.confidence ?? '—'} ·{' '}
                        {formatTimestamp(entry.recordedAt)}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            </article>
          ) : (
            <article style={cardStyle}>
              <p style={{ color: '#667085', margin: 0 }}>
                Select a page from the left, sync a processed summary, or ask a question to get started.
              </p>
            </article>
          )}

          <section style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Processed documents</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={isSyncing || pendingWikiSources.length === 0}
                  onClick={() => void handleSyncProcessed()}
                  style={primaryButtonStyle}
                >
                  {isSyncing ? 'Syncing…' : `Sync ${pendingWikiSources.length || 'all'} to wiki`}
                </button>
                <button
                  type="button"
                  onClick={() => void refreshSources()}
                  disabled={isLoadingSources}
                  style={ghostButtonStyle}
                >
                  Refresh
                </button>
              </div>
            </div>
            <p style={{ color: '#667085', margin: '4px 0 12px', fontSize: 14 }}>
              Wiki pages are built from PaperQA <code>summary.md</code> in the project parsing folder, not pasted text.
            </p>
            {syncStatus && <p style={{ color: '#475467', fontSize: 13, margin: '0 0 12px' }}>{syncStatus}</p>}
            {processedSources.length === 0 ? (
              <p style={{ color: '#667085', margin: 0 }}>
                No project files yet.{' '}
                <Link to="/files" style={{ color: '#1f4e79' }}>
                  Upload and process PDFs
                </Link>{' '}
                first.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr>
                    <th style={tableHeaderStyle}>Document</th>
                    <th style={tableHeaderStyle}>Process</th>
                    <th style={tableHeaderStyle}>Wiki</th>
                    <th style={tableHeaderStyle} />
                  </tr>
                </thead>
                <tbody>
                  {processedSources.map((source) => (
                    <tr key={source.fileId} style={{ borderTop: '1px solid #eef2f6' }}>
                      <td style={tableCellStyle}>{source.fileName}</td>
                      <td style={tableCellStyle}>
                        <span style={statusPillStyle(source.status)}>{source.status}</span>
                      </td>
                      <td style={tableCellStyle}>
                        {source.wikiPageKey ? (
                          <button
                            type="button"
                            onClick={() => void openPage(source.wikiPageKey!)}
                            style={wikiLinkButtonStyle}
                          >
                            {source.wikiPageKey}
                          </button>
                        ) : source.hasSummary ? (
                          <span style={{ color: '#b54708' }}>summary ready</span>
                        ) : (
                          <span style={{ color: '#667085' }}>—</span>
                        )}
                      </td>
                      <td style={{ ...tableCellStyle, textAlign: 'right' }}>
                        {source.status === 'completed' && source.hasSummary && !source.wikiPageKey ? (
                          <button
                            type="button"
                            disabled={isSyncing}
                            onClick={() => void handleIngestOne(source.fileId)}
                            style={ghostButtonStyle}
                          >
                            Ingest
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <details style={{ marginTop: 16 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
                Advanced: manual text ingest
              </summary>
              <p style={{ color: '#667085', margin: '8px 0', fontSize: 13 }}>
                For ad-hoc notes only. Normal workflow: File Management → Process → sync above.
              </p>
              <form onSubmit={handleIngest} style={{ display: 'grid', gap: 10 }}>
                <input
                  type="text"
                  value={ingestForm.title}
                  onChange={(event) => setIngestForm({ ...ingestForm, title: event.target.value })}
                  placeholder="Source title"
                  style={inputStyle}
                />
                <select
                  value={ingestForm.category}
                  onChange={(event) => setIngestForm({ ...ingestForm, category: event.target.value as WikiCategory })}
                  style={inputStyle}
                >
                  {wikiCategoryList.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <textarea
                  value={ingestForm.text}
                  onChange={(event) => setIngestForm({ ...ingestForm, text: event.target.value })}
                  rows={4}
                  placeholder="Extracted text (non-PDF sources)…"
                  style={textareaStyle}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="submit" disabled={isIngesting} style={ghostButtonStyle}>
                    {isIngesting ? 'Ingesting…' : 'Manual ingest'}
                  </button>
                  {ingestStatus && <span style={{ color: '#667085', fontSize: 13 }}>{ingestStatus}</span>}
                </div>
              </form>
            </details>
          </section>

          <section style={cardStyle}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Ask the wiki</h2>
            <p style={{ color: '#667085', margin: '4px 0 12px', fontSize: 14 }}>
              Wiki-first retrieval: candidate pages are ranked by token overlap, then the configured LLM
              answers only from those pages. Existing raw-doc Q&A is unchanged.
            </p>
            <form onSubmit={handleQuery} style={{ display: 'grid', gap: 10 }}>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={3}
                placeholder="What protocols cover detector calibration at ALS?"
                style={textareaStyle}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" disabled={isQuerying || !question.trim()} style={primaryButtonStyle}>
                  {isQuerying ? 'Querying…' : 'Ask'}
                </button>
              </div>
            </form>
            {queryAnswer && (
              <div style={{ marginTop: 14 }}>
                <div style={{ ...metadataRowStyle, marginBottom: 8 }}>
                  <strong>Answer</strong>
                  <span style={pillStyle}>{queryUsedLlm ? 'LLM-grounded' : 'Heuristic'}</span>
                </div>
                <p style={{ lineHeight: 1.6, margin: 0 }}>{queryAnswer}</p>
                {queryCitedPages.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <strong style={{ fontSize: 13, color: '#667085' }}>Cited pages</strong>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {queryCitedPages.map((cited) => (
                        <li key={cited.key}>
                          <button type="button" onClick={() => void openPage(cited.key)} style={wikiLinkButtonStyle}>
                            {cited.title}
                          </button>{' '}
                          <span style={{ color: '#667085', fontSize: 12 }}>
                            ({cited.category}, score {cited.score.toFixed(2)})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        </section>
      </div>
    </div>
  );
}

const cardStyle = {
  padding: 20,
  border: '1px solid #dbe3ee',
  borderRadius: 16,
  background: '#ffffff',
  boxShadow: '0 8px 30px rgba(31, 78, 121, 0.08)',
} satisfies CSSProperties;

const emptyStateStyle = {
  padding: 24,
  border: '1px solid #dbe3ee',
  borderRadius: 16,
  background: '#ffffff',
} satisfies CSSProperties;

const errorStyle = {
  padding: 12,
  border: '1px solid #f7c6c6',
  borderRadius: 10,
  background: '#fdecec',
  color: '#9f1d1d',
} satisfies CSSProperties;

const categoryHeaderStyle = {
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  fontSize: 11,
  color: '#667085',
  marginBottom: 6,
} satisfies CSSProperties;

const pageButtonStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '10px 12px',
  border: '1px solid #dbe3ee',
  borderRadius: 10,
  cursor: 'pointer',
  marginBottom: 6,
} satisfies CSSProperties;

const primaryButtonStyle = {
  padding: '10px 16px',
  border: 0,
  borderRadius: 10,
  background: '#1f4e79',
  color: '#ffffff',
  cursor: 'pointer',
  fontWeight: 700,
} satisfies CSSProperties;

const ghostButtonStyle = {
  padding: '8px 12px',
  border: '1px solid #1f4e79',
  borderRadius: 10,
  background: '#ffffff',
  color: '#1f4e79',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: 13,
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

const inputStyle = {
  padding: '10px 12px',
  border: '1px solid #b9c4d0',
  borderRadius: 10,
  fontSize: 14,
} satisfies CSSProperties;

const textareaStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 14px',
  border: '1px solid #b9c4d0',
  borderRadius: 10,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 13,
  resize: 'vertical',
} satisfies CSSProperties;

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

const metadataRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  fontSize: 13,
  color: '#475467',
  margin: '8px 0',
} satisfies CSSProperties;

const pillStyle = {
  display: 'inline-flex',
  padding: '4px 10px',
  borderRadius: 999,
  background: '#eef2f6',
  color: '#475467',
  fontSize: 12,
  fontWeight: 700,
} satisfies CSSProperties;

const detailsBoxStyle = {
  marginTop: 14,
  padding: 12,
  border: '1px solid #dbe3ee',
  borderRadius: 12,
  background: '#f8fafc',
} satisfies CSSProperties;

const tableHeaderStyle = {
  padding: '10px 8px',
  textAlign: 'left',
  color: '#475467',
  fontSize: 12,
  fontWeight: 700,
} satisfies CSSProperties;

const tableCellStyle = {
  padding: '10px 8px',
  verticalAlign: 'middle',
} satisfies CSSProperties;

const statusPillStyle = (status: FileProcessingStatus): CSSProperties => {
  const palette: Record<FileProcessingStatus, { background: string; color: string }> = {
    uploaded: { background: '#eef2f6', color: '#475467' },
    processing: { background: '#eaf2fb', color: '#1f4e79' },
    completed: { background: '#eaf8ef', color: '#1f7a3f' },
    failed: { background: '#fdecec', color: '#9f1d1d' },
  };
  const colors = palette[status];
  return {
    display: 'inline-flex',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'capitalize',
    ...colors,
  };
};
