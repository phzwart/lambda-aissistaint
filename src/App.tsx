import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppShell } from './components/layout/AppShell';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { FileManagementPage } from './pages/FileManagementPage';
import { KnowledgeBasePage } from './pages/KnowledgeBasePage';
import { LoginPage } from './pages/LoginPage';
import { PreferencesPage } from './pages/PreferencesPage';
import { QAPage } from './pages/QAPage';
import { useAuthStore } from './state/authStore';

export function App() {
  const initializeAuth = useAuthStore((state) => state.initializeAuth);

  useEffect(() => {
    void initializeAuth();
  }, [initializeAuth]);

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/preferences" replace />} />
          <Route path="/preferences" element={<PreferencesPage />} />
          <Route path="/files" element={<FileManagementPage />} />
          <Route path="/knowledge" element={<KnowledgeBasePage />} />
          <Route path="/qa" element={<QAPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/preferences" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
