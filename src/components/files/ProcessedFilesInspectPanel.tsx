import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { MarkdownView } from '../markdown/MarkdownView';
import { fileService } from '../../services/fileService';
import type { ManagedFile } from '../../types/domain';
import type { ParsedArtifactEntry, ParsedArtifactKind } from '../../types/parsedArtifact';

const ARTIFACT_SORT_ORDER: Record<string, number> = {
  'summary.md': 0,
  'extended_abstract.md': 1,
  'abstract.txt': 2,
  'extracted.txt': 3,
  'summary.json': 4,
  'follow_up_questions.json': 5,
  'knowledge_graph.json': 6,
  'paper_metadata.json': 7,
  'extraction_metadata.json': 8,
  'figures_manifest.json': 9,
  'processing.status.json': 10,
  'process.log': 11,
};

const artifactSortOrder = (name: string) => {
  if (name in ARTIFACT_SORT_ORDER) {
    return ARTIFACT_SORT_ORDER[name];
  }
  if (name.startsWith('figures/')) {
    return 9.5;
  }
  return 50;
};

const sortArtifacts = (artifacts: ParsedArtifactEntry[]) =>
  [...artifacts].sort((left, right) => {
    const leftOrder = artifactSortOrder(left.name);
    const rightOrder = artifactSortOrder(right.name);
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.name.localeCompare(right.name);
  });

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDisplayContent = (kind: ParsedArtifactKind, raw: string) => {
  if (kind !== 'json') {
    return raw;
  }
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
};

const kindLabel: Record<ParsedArtifactKind, string> = {
  text: 'Plain text',
  markdown: 'Markdown',
  json: 'JSON',
  log: 'Log',
  image: 'PNG image',
};

export function ProcessedFilesInspectPanel({
  projectId,
  files,
  inspectFileId,
  onInspectFileIdChange,
}: {
  projectId: string;
  files: ManagedFile[];
  inspectFileId: string | null;
  onInspectFileIdChange: (fileId: string | null) => void;
}) {
  const [artifacts, setArtifacts] = useState<ParsedArtifactEntry[]>([]);
  const [selectedArtifactName, setSelectedArtifactName] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [contentKind, setContentKind] = useState<ParsedArtifactKind | null>(null);
  const [isListing, setIsListing] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inspectableFiles = useMemo(
    () =>
      files.filter(
        (file) => file.status === 'completed' || file.status === 'failed' || file.status === 'processing',
      ),
    [files],
  );

  const selectedFile = inspectableFiles.find((file) => file.id === inspectFileId) ?? null;
  const isFileProcessing = selectedFile?.status === 'processing';

  const selectedArtifactEntry = useMemo(
    () => artifacts.find((entry) => entry.name === selectedArtifactName) ?? null,
    [artifacts, selectedArtifactName],
  );

  const loadArtifacts = useCallback(async () => {
    if (!projectId || !inspectFileId) {
      setArtifacts([]);
      setSelectedArtifactName(null);
      setContent(null);
      setContentKind(null);
      return;
    }
    setIsListing(true);
    setErrorMessage(null);
    try {
      const listing = await fileService.listParsedArtifacts(projectId, inspectFileId);
      const sorted = sortArtifacts(listing.artifacts);
      setArtifacts(sorted);
      const preferred =
        sorted.find((entry) => entry.name === 'summary.md') ??
        sorted.find((entry) => entry.kind === 'markdown') ??
        sorted[0];
      setSelectedArtifactName((current) => {
        if (current && sorted.some((entry) => entry.name === current)) {
          return current;
        }
        return preferred?.name ?? null;
      });
    } catch (error) {
      setArtifacts([]);
      setSelectedArtifactName(null);
      setContent(null);
      setContentKind(null);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to list processed artifacts.');
    } finally {
      setIsListing(false);
    }
  }, [inspectFileId, projectId]);

  useEffect(() => {
    void loadArtifacts();
  }, [loadArtifacts]);

  useEffect(() => {
    if (!isFileProcessing) {
      return;
    }
    const timer = setInterval(() => {
      void loadArtifacts();
    }, 5000);
    return () => clearInterval(timer);
  }, [isFileProcessing, loadArtifacts]);

  useEffect(() => {
    if (!projectId || !inspectFileId || !selectedArtifactName || isListing || !selectedArtifactEntry) {
      if (!isListing && selectedArtifactName && !selectedArtifactEntry) {
        setContent(null);
        setContentKind(null);
      }
      return;
    }

    let cancelled = false;
    const loadContent = async () => {
      setIsLoadingContent(true);
      setErrorMessage(null);
      try {
        const artifact = await fileService.getParsedArtifact(projectId, inspectFileId, selectedArtifactName);
        if (cancelled) {
          return;
        }
        setContent(artifact.content);
        setContentKind(artifact.kind);
      } catch (error) {
        if (!cancelled) {
          setContent(null);
          setContentKind(null);
          const message = error instanceof Error ? error.message : 'Failed to load artifact.';
          const pendingArtifact =
            isFileProcessing && message.toLowerCase().includes('not found');
          if (!pendingArtifact) {
            setErrorMessage(message);
          }
        }
      } finally {
        if (!cancelled) {
          setIsLoadingContent(false);
        }
      }
    };

    void loadContent();
    return () => {
      cancelled = true;
    };
  }, [
    inspectFileId,
    isFileProcessing,
    isListing,
    projectId,
    selectedArtifactEntry,
    selectedArtifactName,
  ]);

  useEffect(() => {
    if (inspectFileId || inspectableFiles.length === 0) {
      return;
    }
    const firstCompleted = inspectableFiles.find((file) => file.status === 'completed');
    onInspectFileIdChange((firstCompleted ?? inspectableFiles[0]).id);
  }, [inspectFileId, inspectableFiles, onInspectFileIdChange]);

  const displayContent = content && contentKind ? formatDisplayContent(contentKind, content) : '';

  const handleDownloadZip = async () => {
    if (!projectId || !inspectFileId || !selectedFile) {
      return;
    }
    setIsDownloadingZip(true);
    setErrorMessage(null);
    try {
      await fileService.downloadParsedArtifactsZip(projectId, inspectFileId, selectedFile.name);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to download artifacts zip.');
    } finally {
      setIsDownloadingZip(false);
    }
  };

  return (
    <section style={panelStyle}>
      <p style={introStyle}>
        Inspect outputs stored under the project parsed prefix. Plain text and logs render as monospace; Markdown
        renders as formatted prose.
      </p>

      {errorMessage && <div style={errorBannerStyle}>{errorMessage}</div>}
      {isFileProcessing && (
        <div style={infoBannerStyle}>
          Processing in progress. Artifacts appear in MinIO as they are written; this view refreshes every few
          seconds. <code>summary.md</code> is usually last.
        </div>
      )}

      <div style={toolbarStyle}>
        <label style={fileSelectLabelStyle}>
          Processed file
          <select
            value={inspectFileId ?? ''}
            onChange={(event) => onInspectFileIdChange(event.target.value || null)}
            style={selectStyle}
            disabled={inspectableFiles.length === 0}
          >
            {inspectableFiles.length === 0 ? (
              <option value="">No processed files yet</option>
            ) : (
              inspectableFiles.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.name} ({file.status})
                </option>
              ))
            )}
          </select>
        </label>
        <button
          type="button"
          style={ghostButtonStyle}
          disabled={!inspectFileId || isListing}
          onClick={() => void loadArtifacts()}
        >
          {isListing ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          type="button"
          style={primaryButtonStyle}
          disabled={!inspectFileId || isListing || isDownloadingZip || artifacts.length === 0}
          onClick={() => void handleDownloadZip()}
        >
          {isDownloadingZip ? 'Preparing zip…' : 'Download all as zip'}
        </button>
      </div>

      {inspectableFiles.length === 0 ? (
        <div style={emptyStyle}>
          <p style={{ margin: 0, color: '#667085' }}>
            Process at least one PDF on the Upload &amp; process tab, then return here to read summary.md, abstract.txt,
            and related artifacts.
          </p>
        </div>
      ) : (
        <div style={inspectLayoutStyle}>
          <aside style={artifactListStyle}>
            <div style={artifactListHeaderStyle}>
              <strong>Artifacts</strong>
              {isListing ? <span style={{ color: '#667085', fontWeight: 500 }}>loading…</span> : null}
            </div>
            {artifacts.length === 0 ? (
              <p style={{ margin: 12, color: '#667085', fontSize: 14 }}>
                {isListing ? 'Loading artifact list…' : 'No artifacts found for this file yet.'}
              </p>
            ) : (
              <ul style={artifactUlStyle}>
                {artifacts.map((artifact) => {
                  const isActive = artifact.name === selectedArtifactName;
                  return (
                    <li key={artifact.name}>
                      <button
                        type="button"
                        onClick={() => setSelectedArtifactName(artifact.name)}
                        style={{
                          ...artifactButtonStyle,
                          ...(isActive ? artifactButtonActiveStyle : undefined),
                        }}
                      >
                        <span style={{ fontWeight: 700 }}>{artifact.name}</span>
                        <span style={artifactMetaStyle}>
                          {kindLabel[artifact.kind]} · {formatBytes(artifact.size)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <div style={viewerStyle}>
            <div style={viewerHeaderStyle}>
              <strong>{selectedArtifactName ?? 'Select an artifact'}</strong>
              {selectedFile ? (
                <span style={{ color: '#667085', fontWeight: 500 }}>{selectedFile.name}</span>
              ) : null}
              {isLoadingContent ? <span style={{ color: '#667085' }}>loading…</span> : null}
            </div>
            <div style={viewerBodyStyle}>
              {!selectedArtifactName ? (
                <p style={{ color: '#667085', margin: 0 }}>Choose an artifact from the list.</p>
              ) : contentKind === 'markdown' && content ? (
                <MarkdownView markdown={content} style={{ fontSize: 15 }} />
              ) : contentKind === 'image' && content ? (
                <img
                  alt={selectedArtifactName ?? 'Figure'}
                  src={`data:image/png;base64,${content}`}
                  style={{ maxWidth: '100%', height: 'auto', borderRadius: 8, border: '1px solid #dbe3ee' }}
                />
              ) : displayContent ? (
                <pre style={plainPreStyle}>{displayContent}</pre>
              ) : (
                <p style={{ color: '#667085', margin: 0 }}>
                  {isLoadingContent
                    ? 'Loading content…'
                    : isFileProcessing && selectedArtifactName && !selectedArtifactEntry
                      ? `${selectedArtifactName} is not available yet. Choose another artifact or wait for processing to finish.`
                      : 'No content for this artifact.'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const panelStyle = {
  display: 'grid',
  gap: 16,
} satisfies CSSProperties;

const introStyle = {
  margin: 0,
  color: '#667085',
  fontSize: 15,
  lineHeight: 1.5,
} satisfies CSSProperties;

const toolbarStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'flex-end',
} satisfies CSSProperties;

const fileSelectLabelStyle = {
  display: 'grid',
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  color: '#344054',
  minWidth: 280,
  flex: '1 1 280px',
} satisfies CSSProperties;

const selectStyle = {
  padding: '10px 12px',
  border: '1px solid #b9c4d0',
  borderRadius: 10,
  fontSize: 14,
  background: '#ffffff',
} satisfies CSSProperties;

const ghostButtonStyle = {
  padding: '10px 16px',
  border: '1px solid #1f4e79',
  borderRadius: 10,
  background: '#ffffff',
  color: '#1f4e79',
  cursor: 'pointer',
  fontWeight: 700,
} satisfies CSSProperties;

const primaryButtonStyle = {
  padding: '10px 16px',
  border: '1px solid #1f4e79',
  borderRadius: 10,
  background: '#1f4e79',
  color: '#ffffff',
  cursor: 'pointer',
  fontWeight: 700,
} satisfies CSSProperties;

const inspectLayoutStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)',
  gap: 16,
  alignItems: 'stretch',
} satisfies CSSProperties;

const artifactListStyle = {
  border: '1px solid #dbe3ee',
  borderRadius: 12,
  background: '#f8fafc',
  overflow: 'hidden',
} satisfies CSSProperties;

const artifactListHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  padding: '12px 14px',
  borderBottom: '1px solid #dbe3ee',
  background: '#ffffff',
} satisfies CSSProperties;

const artifactUlStyle = {
  listStyle: 'none',
  margin: 0,
  padding: 8,
  display: 'grid',
  gap: 6,
  maxHeight: 480,
  overflow: 'auto',
} satisfies CSSProperties;

const artifactButtonStyle = {
  display: 'grid',
  gap: 4,
  width: '100%',
  textAlign: 'left',
  padding: '10px 12px',
  border: '1px solid #dbe3ee',
  borderRadius: 8,
  background: '#ffffff',
  cursor: 'pointer',
} satisfies CSSProperties;

const artifactButtonActiveStyle = {
  borderColor: '#1f4e79',
  background: '#eaf2fb',
} satisfies CSSProperties;

const artifactMetaStyle = {
  fontSize: 12,
  color: '#667085',
  fontWeight: 500,
} satisfies CSSProperties;

const viewerStyle = {
  border: '1px solid #dbe3ee',
  borderRadius: 12,
  background: '#ffffff',
  overflow: 'hidden',
  minHeight: 360,
  display: 'grid',
  gridTemplateRows: 'auto 1fr',
} satisfies CSSProperties;

const viewerHeaderStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'baseline',
  justifyContent: 'space-between',
  padding: '12px 16px',
  borderBottom: '1px solid #eef2f6',
  background: '#f8fafc',
} satisfies CSSProperties;

const viewerBodyStyle = {
  padding: 16,
  overflow: 'auto',
  maxHeight: 520,
} satisfies CSSProperties;

const plainPreStyle = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.5,
  color: '#1e293b',
} satisfies CSSProperties;

const emptyStyle = {
  padding: 24,
  border: '1px dashed #cbd5e1',
  borderRadius: 12,
  background: '#f8fafc',
} satisfies CSSProperties;

const errorBannerStyle = {
  padding: 12,
  border: '1px solid #f7c6c6',
  borderRadius: 10,
  background: '#fdecec',
  color: '#9f1d1d',
} satisfies CSSProperties;

const infoBannerStyle = {
  padding: 12,
  border: '1px solid #b9d4f0',
  borderRadius: 10,
  background: '#eaf2fb',
  color: '#1f4e79',
  fontSize: 14,
  lineHeight: 1.5,
} satisfies CSSProperties;
