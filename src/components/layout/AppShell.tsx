import { useState, type CSSProperties, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { appConfig } from '../../config/env';
import { useAuthStore } from '../../state/authStore';

const navigationItems = [
  {
    label: 'Preferences / Setup',
    path: '/preferences',
    description: 'LLM tiers and secrets',
    icon: <PreferencesIcon />,
  },
  {
    label: 'File Management',
    path: '/files',
    description: 'PDF storage and processing',
    icon: <FilesIcon />,
  },
  {
    label: 'Knowledge Base',
    path: '/knowledge',
    description: 'Summaries and links',
    icon: <KnowledgeIcon />,
  },
  {
    label: 'Q&A',
    path: '/qa',
    description: 'Ask grounded questions',
    icon: <QaIcon />,
  },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#f5f7fb', color: '#172033' }}>
      <aside
        style={{
          width: 104,
          flexShrink: 0,
          height: '100vh',
          overflow: 'visible',
          borderRight: '1px solid #dbe3ee',
          background: '#dff0ff',
        }}
      >
        <div style={{ padding: 18, borderBottom: '1px solid #dbe3ee', textAlign: 'center' }}>
          <div
            style={{
              width: 56,
              height: 56,
              margin: '0 auto',
              borderRadius: 14,
              display: 'grid',
              placeItems: 'center',
              background: '#1f4e79',
              color: '#ffffff',
              fontWeight: 800,
              letterSpacing: 0.5,
            }}
            title="AISSIStaint knowledge and data management platform"
          >
            AI
          </div>
        </div>
        <nav style={{ position: 'relative', display: 'grid', gap: 12, justifyItems: 'center', padding: '18px 12px' }}>
          {navigationItems.map((item) => {
            const selected = location.pathname.startsWith(item.path);
            const hovered = hoveredPath === item.path;

            return (
              <div key={item.path} style={{ position: 'relative' }}>
                <button
                  type="button"
                  aria-label={`${item.label}: ${item.description}`}
                  title={`${item.label}: ${item.description}`}
                  onClick={() => navigate(item.path)}
                  onMouseEnter={() => setHoveredPath(item.path)}
                  onMouseLeave={() => setHoveredPath(null)}
                  onFocus={() => setHoveredPath(item.path)}
                  onBlur={() => setHoveredPath(null)}
                  style={{
                    width: 64,
                    height: 64,
                    display: 'grid',
                    placeItems: 'center',
                    border: selected ? '2px solid #1f4e79' : '1px solid #b8d8ef',
                    borderRadius: 14,
                    background: selected ? '#eaf2fb' : '#b5dbf4',
                    color: selected ? '#1f4e79' : '#2f6f9f',
                    cursor: 'pointer',
                    boxShadow: selected ? '0 10px 24px rgba(31, 78, 121, 0.16)' : 'none',
                  }}
                >
                  {item.icon}
                </button>
                {hovered && (
                  <div style={tooltipStyle} role="tooltip">
                    <strong style={{ display: 'block', marginBottom: 4 }}>{item.label}</strong>
                    <span>{item.description}</span>
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      <div style={{ flex: 1, minWidth: 0, height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header
          style={{
            minHeight: 76,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '12px 32px',
            borderBottom: '1px solid #dbe3ee',
            background: '#dff0ff',
          }}
        >
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: 30 }}>{appConfig.appTitle}</h2>
            <p style={{ margin: '4px 0 0', color: '#667085' }}>{appConfig.appSubtitle}</p>
          </div>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 999,
              display: 'grid',
              placeItems: 'center',
              background: '#1f4e79',
              color: '#ffffff',
              fontWeight: 700,
            }}
          >
            {user?.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <strong>{user?.name}</strong>
            <div style={{ color: '#667085', fontSize: 12 }}>Keycloak session</div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              padding: '9px 14px',
              border: '1px solid #1f4e79',
              borderRadius: 10,
              background: '#ffffff',
              color: '#1f4e79',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            Logout
          </button>
        </header>

        <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 32 }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function IconSvg({ children }: { children: ReactNode }) {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

function PreferencesIcon() {
  return (
    <IconSvg>
      <path d="M6 9h18M6 15h18M6 21h18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="9" r="2.5" fill="currentColor" />
      <circle cx="19" cy="15" r="2.5" fill="currentColor" />
      <circle cx="10" cy="21" r="2.5" fill="currentColor" />
    </IconSvg>
  );
}

function FilesIcon() {
  return (
    <IconSvg>
      <path
        d="M5 10.5h7l2.5 3H25v10H5v-13Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M5 9V6.5h7l2.5 3H22" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </IconSvg>
  );
}

function KnowledgeIcon() {
  return (
    <IconSvg>
      <circle cx="8" cy="9" r="3" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="22" cy="10" r="3" stroke="currentColor" strokeWidth="2.2" />
      <circle cx="15" cy="22" r="3" stroke="currentColor" strokeWidth="2.2" />
      <path d="m10.5 11 2.8 7M19.5 12.5 16.8 19M11 9.2l8 .6" stroke="currentColor" strokeWidth="2.2" />
    </IconSvg>
  );
}

function QaIcon() {
  return (
    <IconSvg>
      <path
        d="M6 7h18v12H12l-6 5V7Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path d="M11 12h8M11 16h5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </IconSvg>
  );
}

const tooltipStyle = {
  position: 'absolute',
  zIndex: 20,
  left: 76,
  top: '50%',
  transform: 'translateY(-50%)',
  width: 220,
  padding: '12px 14px',
  border: '1px solid #dbe3ee',
  borderRadius: 12,
  background: '#ffffff',
  color: '#172033',
  boxShadow: '0 16px 40px rgba(31, 78, 121, 0.18)',
  fontSize: 13,
  lineHeight: 1.35,
} satisfies CSSProperties;
