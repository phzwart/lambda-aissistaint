import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const parseAllowedHosts = (value = '') =>
  new Set(
    String(value)
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );

export const isPrivateAddress = (address) => {
  const normalized = String(address).trim().toLowerCase();
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') {
    return true;
  }

  if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }

  const parts = normalized.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
};

export const createLlmEndpointValidator = ({
  allowedHosts = new Set(),
  allowPrivateEndpoints = false,
  allowHttpEndpoints = false,
  lookup = dnsLookup,
} = {}) => {
  const normalizedAllowedHosts = allowedHosts instanceof Set ? allowedHosts : parseAllowedHosts(allowedHosts);

  return async (baseUrl) => {
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new Error('LLM base URL must be a valid URL.');
    }

    if (parsed.protocol !== 'https:' && !(allowHttpEndpoints && parsed.protocol === 'http:')) {
      throw new Error('LLM base URL must use https:// unless LLM_ALLOW_HTTP_ENDPOINTS=true is set for local development.');
    }

    const hostname = parsed.hostname.toLowerCase();
    if (normalizedAllowedHosts.size > 0 && !normalizedAllowedHosts.has(hostname)) {
      throw new Error(`LLM host ${hostname} is not allowed.`);
    }

    if (!allowPrivateEndpoints) {
      const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
      if (addresses.some(({ address }) => isPrivateAddress(address))) {
        throw new Error('LLM endpoint cannot resolve to a private or loopback address.');
      }
    }
  };
};
