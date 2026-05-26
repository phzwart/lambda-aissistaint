import { jwtVerify } from 'jose';
import { logAuditEvent } from '../lib/auditEvents.mjs';

export const createRequireAuth = ({ config, deps }) => {
  const { issuer, keycloakClientId } = config;
  const { jwks, log } = deps;

  return async (request, response, next) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

    if (!token) {
      response.status(401).json({ error: 'Missing bearer token.' });
      return;
    }

    try {
      const { payload } = await jwtVerify(token, jwks, { issuer });
      const audience = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
      if (payload.azp !== keycloakClientId && !audience.includes(keycloakClientId)) {
        response.status(403).json({ error: 'Token was not issued for this application client.' });
        return;
      }

      request.user = payload;
      next();
    } catch (error) {
      log('Invalid Keycloak token', {
        detail: error instanceof Error ? error.message : 'Unknown verification error.',
      });
      logAuditEvent({
        event: 'auth.token_invalid',
        actor: 'anonymous',
        action: 'verify',
        resourceType: 'auth',
        outcome: 'denied',
        metadata: { reason: error instanceof Error ? error.name : 'unknown' },
      });
      response.status(401).json({
        error: 'Invalid Keycloak token.',
      });
    }
  };
};
