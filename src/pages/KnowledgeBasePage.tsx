import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { knowledgeService } from '../services/knowledgeService';
import type { KnowledgeDocument } from '../types/domain';

export function KnowledgeBasePage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);

  useEffect(() => {
    void knowledgeService.list().then(setDocuments);
  }, []);

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section>
        <h1 style={{ margin: 0, fontSize: 28 }}>Knowledge Base</h1>
        <p style={{ margin: '8px 0 0', color: '#667085', fontSize: 16 }}>
          Review document summaries and inspect links discovered across processed sources.
        </p>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        {documents.map((document) => (
          <article key={document.id} style={cardStyle}>
            <div>
              <h2 style={{ margin: 0 }}>{document.title}</h2>
              <p style={{ margin: '6px 0 0', color: '#667085', fontSize: 13 }}>
                Updated {new Date(document.updatedAt).toLocaleString()}
              </p>
            </div>
            <p style={{ lineHeight: 1.6 }}>{document.summary}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {document.linkedDocumentIds.map((linkedDocumentId) => (
                <span key={linkedDocumentId} style={pillStyle}>
                  Linked: {linkedDocumentId}
                </span>
              ))}
            </div>
            <details style={detailsStyle}>
              <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Details</summary>
              <p style={{ color: '#667085', lineHeight: 1.6 }}>
                This mock record represents a processed document node. The production version can render
                extracted entities, citations, graph neighbors, and provenance metadata here.
              </p>
            </details>
          </article>
        ))}
      </div>
    </div>
  );
}

const cardStyle = {
  display: 'grid',
  gap: 16,
  padding: 24,
  border: '1px solid #dbe3ee',
  borderRadius: 16,
  background: '#ffffff',
  boxShadow: '0 8px 30px rgba(31, 78, 121, 0.08)',
} satisfies CSSProperties;

const pillStyle = {
  display: 'inline-flex',
  padding: '6px 10px',
  borderRadius: 999,
  background: '#eef2f6',
  color: '#475467',
  fontSize: 13,
  fontWeight: 700,
} satisfies CSSProperties;

const detailsStyle = {
  padding: 14,
  border: '1px solid #dbe3ee',
  borderRadius: 12,
  background: '#f8fafc',
} satisfies CSSProperties;
