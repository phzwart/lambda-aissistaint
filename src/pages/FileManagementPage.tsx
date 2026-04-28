import { ChangeEvent, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { fileService } from '../services/fileService';
import { useWorkflowStore } from '../state/workflowStore';
import type { FileProcessingStatus } from '../types/domain';

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

export function FileManagementPage() {
  const files = useWorkflowStore((state) => state.files);
  const addFiles = useWorkflowStore((state) => state.addFiles);
  const setFiles = useWorkflowStore((state) => state.setFiles);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const selectedFiles = useMemo(
    () => files.filter((file) => selectedIds.includes(file.id)),
    [files, selectedIds],
  );

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files?.length) {
      return;
    }

    const uploaded = await fileService.upload(event.target.files);
    addFiles(uploaded);
    event.target.value = '';
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id],
    );
  };

  const processSelected = async () => {
    setIsProcessing(true);
    setFiles(
      files.map((file) =>
        selectedIds.includes(file.id)
          ? {
              ...file,
              status: 'processing',
            }
          : file,
      ),
    );

    const processed = await fileService.process(selectedFiles);
    const processedById = new Map(processed.map((file) => [file.id, file]));

    setFiles(files.map((file) => processedById.get(file.id) ?? file));
    setSelectedIds([]);
    setIsProcessing(false);
  };

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section>
        <h1 style={{ margin: 0, fontSize: 28 }}>File Management</h1>
        <p style={{ margin: '8px 0 0', color: '#667085', fontSize: 16 }}>
          Upload PDFs to the MinIO-backed document store and trigger summarization workflows.
        </p>
      </section>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <label style={primaryButtonStyle}>
          Upload PDFs
          <input style={{ display: 'none' }} multiple type="file" accept="application/pdf,.pdf" onChange={handleUpload} />
        </label>
        <button
          type="button"
          disabled={selectedIds.length === 0 || isProcessing}
          onClick={() => void processSelected()}
          style={secondaryButtonStyle}
        >
          {isProcessing ? 'Processing...' : `Process ${selectedIds.length || ''}`.trim()}
        </button>
      </div>

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
              {files.map((file) => (
                <tr
                  key={file.id}
                  style={{
                    background: selectedIds.includes(file.id) ? '#eaf2fb' : '#ffffff',
                    borderTop: '1px solid #eef2f6',
                  }}
                >
                  <td style={tableCellStyle}>
                    <input
                      type="checkbox"
                        checked={selectedIds.includes(file.id)}
                        onChange={() => toggleSelection(file.id)}
                      />
                  </td>
                  <td style={tableCellStyle}>{file.name}</td>
                  <td style={tableCellStyle}>{formatBytes(file.size)}</td>
                  <td style={tableCellStyle}>{new Date(file.uploadedAt).toLocaleString()}</td>
                  <td style={tableCellStyle}>
                    <span style={{ ...pillStyle, ...statusStyles[file.status] }}>{file.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

const cardStyle = {
  overflow: 'hidden',
  border: '1px solid #dbe3ee',
  borderRadius: 16,
  background: '#ffffff',
  boxShadow: '0 8px 30px rgba(31, 78, 121, 0.08)',
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
