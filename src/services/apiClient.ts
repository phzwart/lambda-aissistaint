import { appConfig } from '../config/env';
import { authService } from './authService';

const apiBaseUrl = appConfig.apiBaseUrl.replace(/\/$/, '');

export const apiRequest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const token = await authService.getToken();
  if (!token) {
    throw new Error('You must be logged in before using the backend API.');
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `API request failed with ${response.status}`);
  }

  return body as T;
};
