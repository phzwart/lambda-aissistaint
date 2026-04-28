import type { UserSession } from '../types/domain';
import Keycloak, { type KeycloakProfile } from 'keycloak-js';
import { appConfig } from '../config/env';
import { mockDelay } from './mockDelay';

export interface LoginCredentials {
  username: string;
  password: string;
}

let keycloak: Keycloak | null = null;
let initPromise: Promise<UserSession | null> | null = null;

const getKeycloak = () => {
  if (!keycloak) {
    if (!appConfig.keycloakUrl || !appConfig.keycloakRealm || !appConfig.keycloakClientId) {
      throw new Error('Keycloak is not configured. Check VITE_KEYCLOAK_URL, VITE_KEYCLOAK_REALM, and VITE_KEYCLOAK_CLIENT_ID.');
    }

    keycloak = new Keycloak({
      url: appConfig.keycloakUrl,
      realm: appConfig.keycloakRealm,
      clientId: appConfig.keycloakClientId,
    });
  }

  return keycloak;
};

const profileName = (profile?: KeycloakProfile) => {
  const fullName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
  return fullName || profile?.username || profile?.email || 'Keycloak User';
};

const toUserSession = async (client: Keycloak): Promise<UserSession> => {
  let profile: KeycloakProfile | undefined;

  try {
    profile = await client.loadUserProfile();
  } catch {
    profile = undefined;
  }

  return {
    id: client.subject ?? profile?.id ?? client.tokenParsed?.sub ?? 'keycloak-user',
    name: profileName(profile),
    email: profile?.email ?? String(client.tokenParsed?.email ?? ''),
    accessToken: client.token ?? '',
  };
};

export const authService = {
  async initialize(): Promise<UserSession | null> {
    if (appConfig.useMockServices) {
      return null;
    }

    if (!initPromise) {
      initPromise = getKeycloak()
        .init({
          onLoad: 'check-sso',
          pkceMethod: 'S256',
          checkLoginIframe: false,
        })
        .then(async (authenticated) => {
          if (!authenticated || !keycloak) {
            return null;
          }

          keycloak.onTokenExpired = () => {
            void keycloak?.updateToken(30);
          };

          return toUserSession(keycloak);
        });
    }

    return initPromise;
  },

  async login(credentials: LoginCredentials): Promise<UserSession | null> {
    if (!appConfig.useMockServices) {
      await getKeycloak().login({
        redirectUri: `${window.location.origin}/preferences`,
      });
      return null;
    }

    await mockDelay();

    if (!credentials.username.trim() || !credentials.password.trim()) {
      throw new Error('Enter a username and password to continue.');
    }

    return {
      id: 'mock-keycloak-user',
      name: credentials.username,
      email: `${credentials.username}@local.dev`,
      accessToken: 'mock-keycloak-access-token',
    };
  },

  async logout(): Promise<void> {
    if (!appConfig.useMockServices) {
      await getKeycloak().logout({
        redirectUri: `${window.location.origin}/login`,
      });
      return;
    }

    await mockDelay(150);
  },

  async getToken(): Promise<string | null> {
    if (appConfig.useMockServices) {
      return 'mock-keycloak-access-token';
    }

    const client = getKeycloak();
    if (!client.authenticated) {
      return null;
    }

    await client.updateToken(30);
    return client.token ?? null;
  },
};
