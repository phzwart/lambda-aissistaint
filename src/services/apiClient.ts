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

  const text = await response.text();
  let body: unknown = {};

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      const preview = text.replace(/\s+/g, ' ').trim().slice(0, 180);
      throw new Error(
        `Backend returned a non-JSON response (${response.status}). ${
          preview ? `Response preview: ${preview}` : 'No response body was returned.'
        }`,
      );
    }
  }

  if (!response.ok) {
    const errorBody = body as { error?: string };
    throw new Error(errorBody.error ?? `API request failed with ${response.status}`);
  }

  return body as T;
};
