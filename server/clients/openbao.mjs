import { jsonResponse } from '../lib/serverUtils.mjs';

export const createOpenBaoClient = ({ config, log }) => {
  const { openBaoUrl, openBaoToken, openBaoKvMount, secretStoreProvider } = config;

  const fetchRaw = async (path, init = {}) => {
    if (!openBaoToken) {
      throw new Error('OpenBao token is not configured on the backend.');
    }

    const response = await fetch(`${openBaoUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Vault-Token': openBaoToken,
        ...(init.headers ?? {}),
      },
    });
    const body = await jsonResponse(response);
    log('OpenBao request', {
      method: init.method ?? 'GET',
      path,
      status: response.status,
    });

    if (!response.ok) {
      log('OpenBao request failed', {
        method: init.method ?? 'GET',
        path,
        status: response.status,
        detail: body.errors?.join(', ') || body.error || body.raw || 'No response detail.',
      });
      const error = new Error('Secret store request failed.');
      error.status = response.status;
      throw error;
    }

    return body;
  };

  const fetchOptional = async (path, init = {}) => {
    try {
      return await fetchRaw(path, init);
    } catch (error) {
      if (error instanceof Error && error.status === 404) {
        log('OpenBao secret not found', {
          method: init.method ?? 'GET',
          path,
        });
        return null;
      }

      throw error;
    }
  };

  const ensureSupportedProvider = () => {
    if (secretStoreProvider !== 'openbao') {
      throw new Error(`Secret store provider ${secretStoreProvider} is not implemented by this backend.`);
    }
  };

  const dataApiPath = (path) => `/v1/${openBaoKvMount}/data/${path}`;
  const metadataApiPath = (path) => `/v1/${openBaoKvMount}/metadata/${path}`;

  const read = async (path) => {
    ensureSupportedProvider();
    return fetchOptional(dataApiPath(path));
  };

  const write = async (path, data) => {
    ensureSupportedProvider();
    return fetchRaw(dataApiPath(path), {
      method: 'POST',
      body: JSON.stringify({ data }),
    });
  };

  const deleteMetadata = async (path) => {
    ensureSupportedProvider();
    return fetchOptional(metadataApiPath(path), { method: 'DELETE' });
  };

  const readMetadata = async (path) => fetchOptional(metadataApiPath(path));

  return {
    fetch: fetchRaw,
    fetchOptional,
    read,
    write,
    deleteMetadata,
    readMetadata,
    dataApiPath,
    metadataApiPath,
    kvMount: openBaoKvMount,
  };
};
