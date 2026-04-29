const boundedMetadata = (metadata = {}) => {
  const entries = Object.entries(metadata)
    .filter(([, value]) => value !== undefined)
    .slice(0, 24)
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, value.length > 180 ? `${value.slice(0, 180)}...` : value];
      }
      if (Array.isArray(value)) {
        return [key, value.slice(0, 12)];
      }
      return [key, value];
    });

  return Object.fromEntries(entries);
};

export const actorFromPayload = (payload) =>
  String(payload?.sub ?? payload?.preferred_username ?? payload?.email ?? 'unknown-user');

export const auditEvent = ({
  event,
  actor = 'system',
  action,
  resourceType,
  resourceId,
  outcome = 'success',
  metadata = {},
}) => ({
  ts: new Date().toISOString(),
  event,
  actor,
  action,
  resource_type: resourceType,
  resource_id: resourceId,
  outcome,
  metadata: boundedMetadata(metadata),
});

export const logAuditEvent = (event) => {
  console.log(`AUDIT ${JSON.stringify(auditEvent(event))}`);
};
