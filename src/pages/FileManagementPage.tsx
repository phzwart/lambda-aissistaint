import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ProcessedFilesInspectPanel } from '../components/files/ProcessedFilesInspectPanel';
import { fileService } from '../services/fileService';
import { useFileProcessStore } from '../state/fileProcessStore';
import { useWorkflowStore } from '../state/workflowStore';
import type { FileProcessingStatus } from '../types/domain';
import type { FileProcessJob } from '../types/fileProcess';

const statusStyles: Record<FileProcessingStatus, { background: string; color: string }> = {
  uploaded: { background: '#eef2f6', color: '#475467' },
  processing: { background: '#eaf2fb', color: '#1f4e79' },
  completed: { background: '#eaf8ef', color: '#1f7a3f' },
  failed: { background: '#fdecec', color: '#9f1d1d' },
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const applyJobToStore = (projectId: string, job: FileProcessJob) => {
  const store = useFileProcessStore.getState();
  if (job.fileLogs?.length) {
    store.mergeFileLogsFromJob(projectId, job.fileLogs);
  }
  for (const fileLog of job.fileLogs ?? []) {
    store.upsertFileLog(projectId, {
      fileId: fileLog.fileId,
      fileName: fileLog.fileName,
      status: fileLog.status,
      lines: fileLog.lines,
      updatedAt: fileLog.updatedAt,
    });
  }
};

export function FileManagementPage() {
  const activeProject = useWorkflowStore((state) => state.activeProject);
  const parsedPrefixLabel = activeProject?.parsedPrefix ?? 'parsed';
  const files = useWorkflowStore((state) => state.files);
  const setFiles = useWorkflowStore((state) => state.setFiles);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoadingLog, setIsLoadingLog] = useState(false);
  const [mainTab, setMainTab] = useState<'upload' | 'processed'>('upload');
  const [inspectFileId, setInspectFileId] = useState<string | null>(null);

  const selectedLogFileId = useFileProcessStore((state) => state.selectedLogFileId);
  const setSelectedLogFileId = useFileProcessStore((state) => state.setSelectedLogFileId);
  const activeJob = useFileProcessStore((state) => state.activeJob);
  const setActiveJob = useFileProcessStore((state) => state.setActiveJob);
  const logsByProject = useFileProcessStore((state) => state.logsByProject);

  const processLogRef = useRef<HTMLPreElement>(null);
  const projectId = activeProject?.id ?? '';

  const projectLogs = projectId ? logsByProject[projectId] ?? {} : {};
  const selectedLogEntry = selectedLogFileId && projectId ? projectLogs[selectedLogFileId] : undefined;
  const selectedFile = files.find((file) => file.id === selectedLogFileId);

  const logDisplayText = useMemo(() => {
    if (!selectedLogEntry?.lines?.length) {
      return '';
    }
    return selectedLogEntry.lines.join('\n');
  }, [selectedLogEntry]);

  useEffect(() => {
    if (processLogRef.current) {
      processLogRef.current.scrollTop = processLogRef.current.scrollHeight;
    }
  }, [logDisplayText, selectedLogFileId]);

  const refreshFiles = useCallback(async () => {
    if (!projectId) {
      setFiles([]);
      return;
    }
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const listed = await fileService.list(projectId);
      setFiles(listed);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load project files.');
    } finally {
      setIsLoading(false);
    }
  }, [projectId, setFiles]);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  const pollActiveJob = useCallback(async () => {
    if (!activeJob || activeJob.projectId !== projectId) {
      return;
    }
    try {
      const job = await fileService.getProcessJob(projectId, activeJob.jobId);
      applyJobToStore(projectId, job);
      if (job.status !== 'running') {
        setActiveJob(null);
        setIsProcessing(false);
        await refreshFiles();
      }
    } catch {
      setActiveJob(null);
      setIsProcessing(false);
    }
  }, [activeJob, projectId, refreshFiles, setActiveJob]);

  useEffect(() => {
    if (!activeJob || activeJob.projectId !== projectId) {
      return;
    }
    setIsProcessing(true);
    const timer = setInterval(() => {
      void pollActiveJob();
    }, 1500);
    void pollActiveJob();
    return () => clearInterval(timer);
  }, [activeJob, projectId, pollActiveJob]);

  const selectFileForLog = useCallback(
    async (fileId: string) => {
      setSelectedLogFileId(fileId);
      setInspectFileId(fileId);
      if (!projectId) {
        return;
      }
      setIsLoadingLog(true);
      try {
        const file = files.find((entry) => entry.id === fileId);
        const stored = await fileService.getStoredProcessLog(projectId, fileId);
        if ('log' in stored) {
          useFileProcessStore.getState().upsertFileLog(projectId, {
            fileId,
            fileName: file?.name ?? fileId,
            status: file?.status === 'completed' ? 'completed' : file?.status === 'failed' ? 'failed' : 'idle',
            lines: stored.log.split(/\r?\n/).filter((line) => line.length > 0),
            updatedAt: Date.now(),
          });
        } else {
          useFileProcessStore.getState().upsertFileLog(projectId, {
            fileId,
            fileName: file?.name ?? fileId,
            status: 'failed',
            lines: [stored.error],
            updatedAt: Date.now(),
          });
        }

        if (activeJob?.projectId === projectId) {
          try {
            const job = await fileService.getProcessJob(projectId, activeJob.jobId);
            applyJobToStore(projectId, job);
          } catch {
            // job expired on server (restart); persisted browser logs may still help
          }
        }
      } finally {
        setIsLoadingLog(false);
      }
    },
    [activeJob, files, projectId, setSelectedLogFileId],
  );

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length || !projectId) {
      return;
    }
    try {
      setIsUploading(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      await fileService.upload(projectId, event.target.files);
      event.target.value = '';
      await refreshFiles();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const toggleSelection = (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id],
    );
  };

  const processTargets = useMemo(() => {
    if (selectedIds.length > 0) {
      return files.filter((file) => selectedIds.includes(file.id));
    }
    return files.filter((file) => file.status === 'uploaded');
  }, [files, selectedIds]);

  const processSelected = async () => {
    if (!projectId || processTargets.length === 0) {
      setErrorMessage(
        processTargets.length === 0
          ? 'No uploaded files to process. Upload PDFs first, or select specific rows.'
          : null,
      );
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    const targetIds = new Set(processTargets.map((file) => file.id));
    setFiles(
      files.map((file) =>
        targetIds.has(file.id)
          ? {
              ...file,
              status: 'processing',
            }
          : file,
      ),
    );

    for (const file of processTargets) {
      useFileProcessStore.getState().upsertFileLog(projectId, {
        fileId: file.id,
        fileName: file.name,
        status: 'pending',
        lines: [],
        updatedAt: Date.now(),
      });
    }

    if (processTargets[0]) {
      setSelectedLogFileId(processTargets[0].id);
      setInspectFileId(processTargets[0].id);
    }

    try {
      const processed = await fileService.process(projectId, processTargets, {
        onJobStarted: (jobId) => setActiveJob({ projectId, jobId }),
        onJobUpdate: (job) => {
          applyJobToStore(projectId, job);
          if (job.currentFileId) {
            setSelectedLogFileId(job.currentFileId);
          }
        },
      });

      setActiveJob(null);
      const completed = processed.filter((file) => file.status === 'completed').length;
      const failed = processed.filter((file) => file.status === 'failed').length;
      setSelectedIds([]);

      for (const file of processed) {
        if (file.status === 'completed' || file.status === 'failed') {
          void fileService.getStoredProcessLog(projectId, file.id).then((stored) => {
            if (!('log' in stored)) {
              return;
            }
            useFileProcessStore.getState().upsertFileLog(projectId, {
              fileId: file.id,
              fileName: file.name,
              status: file.status === 'completed' ? 'completed' : 'failed',
              lines: stored.log.split(/\r?\n/).filter((line) => line.length > 0),
              updatedAt: Date.now(),
            });
          });
        }
      }

      if (failed > 0 && completed === 0) {
        setErrorMessage(`Processing failed for ${failed} file(s). Select a file below to read its log.`);
      } else {
        setSuccessMessage(
          `Processed ${completed} file(s)${failed ? ` (${failed} failed)` : ''}. Click any row to view its log.`,
        );
      }
      await refreshFiles();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Processing failed.');
      setActiveJob(null);
      await refreshFiles();
    } finally {
      setIsProcessing(false);
    }
  };

  const processButtonLabel = useMemo(() => {
    if (isProcessing) {
      return 'Processing…';
    }
    if (selectedIds.length > 0) {
      return `Process ${selectedIds.length} selected`;
    }
    const uploadedCount = files.filter((file) => file.status === 'uploaded').length;
    return uploadedCount > 0 ? `Process ${uploadedCount} uploaded` : 'Process';
  }, [files, isProcessing, selectedIds.length]);

  if (!projectId) {
    return (
      <PageLayout>
        <section>
          <h1 style={{ margin: 0, fontSize: 28 }}>File Management</h1>
          <p style={{ margin: '8px 0 0', color: '#667085', fontSize: 16 }}>
            Select a project to upload PDFs and run the paper processor.
          </p>
        </section>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <section>
        <h1 style={{ margin: 0, fontSize: 28 }}>File Management</h1>
        <p style={{ margin: '8px 0 0', color: '#667085', fontSize: 16 }}>
          Upload PDFs, run PaperQA summarization, view process logs, and inspect parsed outputs (.txt as plain text,
          .md rendered).
        </p>
      </section>

      <div style={fileTabsStyle} role="tablist" aria-label="File management views">
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === 'upload'}
          onClick={() => setMainTab('upload')}
          style={{
            ...fileTabButtonStyle,
            ...(mainTab === 'upload' ? activeFileTabButtonStyle : undefined),
          }}
        >
          Upload &amp; process
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === 'processed'}
          onClick={() => setMainTab('processed')}
          style={{
            ...fileTabButtonStyle,
            ...(mainTab === 'processed' ? activeFileTabButtonStyle : undefined),
          }}
        >
          Processed outputs
        </button>
      </div>

      {errorMessage && <ErrorBanner message={errorMessage} />}
      {successMessage && <SuccessBanner message={successMessage} />}

      {mainTab === 'processed' ? (
        <ProcessedFilesInspectPanel
          projectId={projectId}
          files={files}
          inspectFileId={inspectFileId}
          onInspectFileIdChange={setInspectFileId}
        />
      ) : (
        <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ ...primaryButtonStyle, opacity: isUploading ? 0.7 : 1 }}>
          {isUploading ? 'Uploading…' : 'Upload PDFs'}
          <input
            style={{ display: 'none' }}
            multiple
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => void handleUpload(event)}
            disabled={isUploading}
          />
        </label>
        <button
          type="button"
          disabled={processTargets.length === 0 || isProcessing}
          onClick={() => void processSelected()}
          style={secondaryButtonStyle}
        >
          {processButtonLabel}
        </button>
        {isLoading && <span style={{ color: '#667085', alignSelf: 'center' }}>Refreshing file list…</span>}
      </div>

      <section style={logPanelStyle}>
        <div style={logPanelHeaderStyle}>
          <strong>Process log</strong>
          {selectedFile || selectedLogEntry ? (
            <span style={{ color: '#475467', fontWeight: 500 }}>
              {selectedFile?.name ?? selectedLogEntry?.fileName}
              {selectedLogEntry?.status ? ` · ${selectedLogEntry.status}` : ''}
              {isLoadingLog ? ' · loading…' : ''}
            </span>
          ) : (
            <span style={{ color: '#94a3b8', fontWeight: 500 }}>Click a file row to view its log</span>
          )}
        </div>
        <pre ref={processLogRef} style={logPreStyle}>
          {logDisplayText || (selectedLogFileId ? 'No log lines yet for this file.' : 'Select a file to view its log.')}
        </pre>
        <p style={logHintStyle}>
          Logs are written to MinIO under{' '}
          <code>
            {parsedPrefixLabel}/&lt;file-stem&gt;/process.log
          </code>{' '}
          (the parsing output folder) and cached in the browser for quick access.
        </p>
      </section>

      <section style={cardStyle}>
        {files.length === 0 ? (
          <div style={{ padding: '64px 24px', textAlign: 'center' }}>
            <h2 style={{ margin: 0 }}>No files uploaded yet</h2>
            <p style={{ color: '#667085' }}>
              Upload PDF research documents to begin building the knowledge base.
            </p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={tableHeaderStyle} />
                <th style={tableHeaderStyle}>Name</th>
                <th style={tableHeaderStyle}>Size</th>
                <th style={tableHeaderStyle}>Uploaded</th>
                <th style={tableHeaderStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => {
                const hasLog = Boolean(projectLogs[file.id]?.lines?.length);
                const isLogSelected = selectedLogFileId === file.id;
                return (
                  <tr
                    key={file.id}
                    onClick={() => void selectFileForLog(file.id)}
                    style={{
                      cursor: 'pointer',
                      background: isLogSelected ? '#dbeafe' : selectedIds.includes(file.id) ? '#eaf2fb' : '#ffffff',
                      borderTop: '1px solid #eef2f6',
                    }}
                  >
                    <td style={tableCellStyle}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(file.id)}
                        onClick={(event) => toggleSelection(file.id, event)}
                        onChange={() => {}}
                      />
                    </td>
                    <td style={tableCellStyle}>
                      {file.name}
                      {hasLog ? (
                        <span style={{ marginLeft: 8, fontSize: 12, color: '#1f4e79' }}>log</span>
                      ) : null}
                    </td>
                    <td style={tableCellStyle}>{formatBytes(file.size)}</td>
                    <td style={tableCellStyle}>{new Date(file.uploadedAt).toLocaleString()}</td>
                    <td style={tableCellStyle}>
                      <span style={{ ...pillStyle, ...statusStyles[file.status] }}>{file.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
        </>
      )}
    </PageLayout>
  );
}

function PageLayout({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gap: 24 }}>{children}</div>;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: 12,
        border: '1px solid #f7c6c6',
        borderRadius: 10,
        background: '#fdecec',
        color: '#9f1d1d',
      }}
    >
      {message}
    </div>
  );
}

function SuccessBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: 12,
        border: '1px solid #b8e6c8',
        borderRadius: 10,
        background: '#eaf8ef',
        color: '#1f7a3f',
      }}
    >
      {message}
    </div>
  );
}

const fileTabsStyle = {
  display: 'flex',
  gap: 4,
  alignItems: 'flex-end',
  borderBottom: '2px solid #6d93b3',
  marginBottom: -8,
} satisfies CSSProperties;

const fileTabButtonStyle = {
  padding: '12px 22px',
  border: '1px solid #b8d8ef',
  borderBottom: '2px solid #6d93b3',
  borderTopLeftRadius: 12,
  borderTopRightRadius: 12,
  background: '#d9ecfb',
  color: '#2f5f87',
  cursor: 'pointer',
  fontSize: 15,
  fontWeight: 700,
  marginBottom: -2,
} satisfies CSSProperties;

const activeFileTabButtonStyle = {
  background: '#ffffff',
  color: '#1f4e79',
  borderBottomColor: '#ffffff',
  marginBottom: -2,
} satisfies CSSProperties;

const cardStyle = {
  overflow: 'hidden',
  border: '1px solid #dbe3ee',
  borderRadius: 16,
  background: '#ffffff',
  boxShadow: '0 8px 30px rgba(31, 78, 121, 0.08)',
} satisfies CSSProperties;

const logPanelStyle = {
  display: 'grid',
  gap: 8,
  padding: 16,
  border: '1px solid #dbe3ee',
  borderRadius: 16,
  background: '#0f172a',
  color: '#e2e8f0',
} satisfies CSSProperties;

const logPanelHeaderStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  alignItems: 'baseline',
  justifyContent: 'space-between',
} satisfies CSSProperties;

const logPreStyle = {
  margin: 0,
  maxHeight: 320,
  overflow: 'auto',
  padding: 12,
  borderRadius: 8,
  background: '#020617',
  color: '#cbd5e1',
  fontSize: 12,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} satisfies CSSProperties;

const logHintStyle = {
  margin: 0,
  fontSize: 12,
  color: '#94a3b8',
} satisfies CSSProperties;

const primaryButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '10px 16px',
  border: 0,
  borderRadius: 10,
  background: '#1f4e79',
  color: '#ffffff',
  cursor: 'pointer',
  fontWeight: 700,
} satisfies CSSProperties;

const secondaryButtonStyle = {
  padding: '10px 16px',
  border: '1px solid #1f4e79',
  borderRadius: 10,
  background: '#ffffff',
  color: '#1f4e79',
  cursor: 'pointer',
  fontWeight: 700,
} satisfies CSSProperties;

const tableHeaderStyle = {
  padding: '14px 16px',
  color: '#475467',
  textAlign: 'left',
  fontSize: 13,
  background: '#f8fafc',
} satisfies CSSProperties;

const tableCellStyle = {
  padding: '14px 16px',
  textAlign: 'left',
} satisfies CSSProperties;

const pillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 26,
  padding: '0 10px',
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 700,
  textTransform: 'capitalize',
} satisfies CSSProperties;