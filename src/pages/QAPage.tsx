import { FormEvent, useState } from 'react';
import type { CSSProperties } from 'react';
import { qaService } from '../services/qaService';
import { useWorkflowStore } from '../state/workflowStore';

export function QAPage() {
  const [question, setQuestion] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const latestAnswer = useWorkflowStore((state) => state.latestAnswer);
  const setLatestAnswer = useWorkflowStore((state) => state.setLatestAnswer);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!question.trim()) {
      return;
    }

    setSaveMessage(null);
    setIsSubmitting(true);
    const answer = await qaService.ask(question.trim());
    setLatestAnswer(answer);
    setIsSubmitting(false);
  };

  const saveToKnowledgeBase = async () => {
    if (!latestAnswer) {
      return;
    }

    await qaService.saveToKnowledgeBase(latestAnswer);
    setSaveMessage('Answer saved to the mock knowledge base.');
  };

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section>
        <h1 style={{ margin: 0, fontSize: 28 }}>Q&A</h1>
        <p style={{ margin: '8px 0 0', color: '#667085', fontSize: 16 }}>
          Ask questions against processed documents and preserve useful answers as knowledge records.
        </p>
      </section>

      <section style={cardStyle}>
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
          <label style={{ display: 'grid', gap: 8, fontWeight: 700 }}>
            Question
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={5}
              placeholder="What relationships exist between the uploaded synthesis notes and spectroscopy results?"
              style={textareaStyle}
            />
          </label>
          <button
            type="submit"
            disabled={isSubmitting || !question.trim()}
            style={{ ...primaryButtonStyle, justifySelf: 'start' }}
          >
            {isSubmitting ? 'Asking...' : 'Submit Question'}
          </button>
        </form>
      </section>

      {latestAnswer && (
        <section style={cardStyle}>
          <div style={{ display: 'grid', gap: 14 }}>
            <h2 style={{ margin: 0 }}>Latest Answer</h2>
            <p style={{ margin: 0, color: '#667085' }}>{latestAnswer.question}</p>
            <hr style={{ width: '100%', border: 0, borderTop: '1px solid #dbe3ee' }} />
            <p style={{ margin: 0, lineHeight: 1.6 }}>{latestAnswer.answer}</p>
            <button
              type="button"
              onClick={() => void saveToKnowledgeBase()}
              style={{ ...secondaryButtonStyle, justifySelf: 'start' }}
            >
              Save to Knowledge Base
            </button>
            {saveMessage && <div style={successMessageStyle}>{saveMessage}</div>}
          </div>
        </section>
      )}
    </div>
  );
}

const cardStyle = {
  padding: 24,
  border: '1px solid #dbe3ee',
  borderRadius: 16,
  background: '#ffffff',
  boxShadow: '0 8px 30px rgba(31, 78, 121, 0.08)',
} satisfies CSSProperties;

const textareaStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 14px',
  border: '1px solid #b9c4d0',
  borderRadius: 10,
  fontSize: 15,
  resize: 'vertical',
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

const secondaryButtonStyle = {
  padding: '10px 16px',
  border: '1px solid #1f4e79',
  borderRadius: 10,
  background: '#ffffff',
  color: '#1f4e79',
  cursor: 'pointer',
  fontWeight: 700,
} satisfies CSSProperties;

const successMessageStyle = {
  padding: 14,
  borderRadius: 10,
  background: '#eaf8ef',
  color: '#1f7a3f',
} satisfies CSSProperties;
