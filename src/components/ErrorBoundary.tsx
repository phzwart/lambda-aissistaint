import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Application render error', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ minHeight: '100vh', padding: 32, background: '#f5f7fb', color: '#172033' }}>
          <section
            style={{
              maxWidth: 820,
              padding: 24,
              border: '1px solid #f1b8b8',
              borderRadius: 14,
              background: '#fff7f7',
            }}
          >
            <h1 style={{ marginTop: 0 }}>Something failed while rendering</h1>
            <p>This visible error replaces the blank page while we finish hardening the UI.</p>
            <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{this.state.error.message}</pre>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
