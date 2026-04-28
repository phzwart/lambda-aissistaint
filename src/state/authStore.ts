import { create } from 'zustand';
import { authService, type LoginCredentials } from '../services/authService';
import type { UserSession } from '../types/domain';

interface AuthState {
  user: UserSession | null;
  isInitialized: boolean;
  isAuthenticating: boolean;
  error: string | null;
  initializeAuth: () => Promise<void>;
  login: (credentials: LoginCredentials) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isInitialized: false,
  isAuthenticating: false,
  error: null,

  initializeAuth: async () => {
    set({ isAuthenticating: true, error: null });

    try {
      const user = await authService.initialize();
      set({ user, isInitialized: true, isAuthenticating: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Authentication initialization failed.',
        isInitialized: true,
        isAuthenticating: false,
      });
    }
  },

  login: async (credentials) => {
    set({ isAuthenticating: true, error: null });

    try {
      const user = await authService.login(credentials);
      if (!user) {
        set({ isAuthenticating: false });
        return false;
      }

      set({ user, isAuthenticating: false });
      return true;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Login failed.',
        isAuthenticating: false,
      });
      return false;
    }
  },

  logout: async () => {
    await authService.logout();
    set({ user: null, error: null });
  },
}));
