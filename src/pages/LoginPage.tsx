import { FormEvent, useState } from 'react';
import type { CSSProperties } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { appConfig } from '../config/env';
import { useAuthStore } from '../state/authStore';

export function LoginPage() {
  const [username, setUsername] = useState('researcher');
  const [password, setPassword] = useState('password');
  const user = useAuthStore((state) => state.user);
  const error = useAuthStore((state) => state.error);
  const isAuthenticating = useAuthStore((state) => state.isAuthenticating);
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();
  const location = useLocation();
  const isMockMode = appConfig.useMockServices;

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/preferences';

  if (user) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const success = await login({ username, password });

    if (success) {
      navigate(from, { replace: true });
    }
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: '#f5f7fb',
        backgroundImage:
          'radial-gradient(circle at top left, rgba(31, 78, 121, 0.18), transparent 36%)',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: 520,
          padding: 40,
          border: '1px solid #d6deea',
          borderRadius: 16,
          background: '#ffffff',
          boxShadow: '0 24px 80px rgba(31, 78, 121, 0.22)',
          color: '#172033',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div
            style={{
              width: 56,
              height: 56,
              margin: '0 auto 16px',
              borderRadius: 999,
              display: 'grid',
              placeItems: 'center',
              background: '#1f4e79',
              color: '#ffffff',
              fontWeight: 700,
            }}
          >
            AI
          </div>
          <h1 style={{ margin: 0, fontSize: 32 }}>Sign in</h1>
          <p style={{ margin: '8px 0 0', color: '#5f6b7a' }}>
            Authenticate to access the knowledge workflow.
          </p>
        </div>

        <div
          style={{
            marginBottom: 20,
            padding: 14,
            borderRadius: 10,
            background: '#eaf2fb',
            color: '#1f4e79',
            fontSize: 14,
          }}
        >
          {isMockMode
            ? `Mock login is active. Set VITE_USE_MOCK_SERVICES=false to use Keycloak at ${
                appConfig.keycloakUrl || 'VITE_KEYCLOAK_URL'
              }.`
            : `Keycloak login is active for realm ${appConfig.keycloakRealm}.`}
        </div>

        {error && (
          <div
            style={{
              marginBottom: 20,
              padding: 14,
              borderRadius: 10,
              background: '#fdecec',
              color: '#9f1d1d',
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {isMockMode && (
            <>
              <label style={{ display: 'block', marginBottom: 16, fontWeight: 700 }}>
                Username
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  style={inputStyle}
                />
              </label>
              <label style={{ display: 'block', marginBottom: 24, fontWeight: 700 }}>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  style={inputStyle}
                />
              </label>
            </>
          )}
          <button
            type="submit"
            disabled={isAuthenticating}
            style={{
              width: '100%',
              padding: '14px 18px',
              border: 0,
              borderRadius: 10,
              background: isAuthenticating ? '#8aa7bf' : '#1f4e79',
              color: '#ffffff',
              cursor: isAuthenticating ? 'default' : 'pointer',
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            {isAuthenticating ? 'Signing in...' : isMockMode ? 'Login' : 'Login with Keycloak'}
          </button>
        </form>
      </section>
    </main>
  );
}

const inputStyle = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  marginTop: 8,
  padding: '13px 14px',
  border: '1px solid #b9c4d0',
  borderRadius: 10,
  fontSize: 16,
} satisfies CSSProperties;
