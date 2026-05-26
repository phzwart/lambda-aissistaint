import { actorFromPayload } from '../lib/auditEvents.mjs';

export const createRoleHelpers = ({ config }) => {
  const { keycloakClientId } = config;

  const userRoles = (payload = {}) => {
    const realmRoles = Array.isArray(payload.realm_access?.roles) ? payload.realm_access.roles : [];
    const clientRoles = Array.isArray(payload.resource_access?.[keycloakClientId]?.roles)
      ? payload.resource_access[keycloakClientId].roles
      : [];
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    return new Set(
      [...realmRoles, ...clientRoles, ...groups].map((role) => String(role).replace(/^\//, '').toLowerCase()),
    );
  };

  const hasAnyRole = (payload, roles) => {
    const assignedRoles = userRoles(payload);
    return roles.some((role) => assignedRoles.has(role));
  };

  const isAdmin = (payload) => hasAnyRole(payload, ['aissistaint-admin']);
  const isRemovalAgent = (payload) => hasAnyRole(payload, ['removal-agent']);

  const requireAdmin = (request, response, next) => {
    if (isAdmin(request.user)) {
      next();
      return;
    }
    response.status(403).json({ error: 'Administrator access is required.' });
  };

  const requireProjectDeletionRole = (request, response, next) => {
    if (isAdmin(request.user) || isRemovalAgent(request.user)) {
      next();
      return;
    }
    response.status(403).json({ error: 'Administrator or removal-agent access is required.' });
  };

  const userSubject = (request) => actorFromPayload(request.user);

  return {
    userRoles,
    hasAnyRole,
    isAdmin,
    isRemovalAgent,
    requireAdmin,
    requireProjectDeletionRole,
    userSubject,
  };
};
