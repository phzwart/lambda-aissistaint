// Provenance and ingest log sidecars.
//
// These JSON files are rebuildable views, not the source of truth. They live
// in the project bucket under the `metadata/` prefix and let the UI surface
// the audit trail for synthesized claims without re-parsing every page.

const isoNow = () => new Date().toISOString();

export const emptyProvenanceIndex = () => ({ version: 1, updatedAt: isoNow(), entries: {} });
export const emptyIngestLog = () => ({ version: 1, updatedAt: isoNow(), entries: [] });

const ensureEntries = (index) => {
  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    return emptyProvenanceIndex();
  }
  if (!index.entries || typeof index.entries !== 'object') {
    return { ...index, entries: {} };
  }
  return index;
};

const ensureLog = (log) => {
  if (!log || typeof log !== 'object' || Array.isArray(log)) {
    return emptyIngestLog();
  }
  if (!Array.isArray(log.entries)) {
    return { ...log, entries: [] };
  }
  return log;
};

// Records that a managed section in a page was derived from a source. We
// dedupe by (pageKey, sectionId, sourceId) so re-ingesting the same source
// just refreshes timestamps.
export const recordProvenance = (index, { pageKey, sectionId, sourceId, sourceTitle, chunkIds, confidence }) => {
  const next = ensureEntries(index);
  const list = next.entries[pageKey] ?? (next.entries[pageKey] = []);
  const filtered = list.filter((entry) => !(entry.sectionId === sectionId && entry.sourceId === sourceId));
  filtered.push({
    sectionId,
    sourceId,
    sourceTitle: sourceTitle ?? null,
    chunkIds: Array.isArray(chunkIds) ? chunkIds.slice(0, 64) : [],
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, Number(confidence))) : null,
    recordedAt: isoNow(),
  });
  next.entries[pageKey] = filtered;
  next.updatedAt = isoNow();
  return next;
};

export const recordProvenanceBatch = (index, records = []) => {
  let next = ensureEntries(index);
  for (const record of records) {
    next = recordProvenance(next, record);
  }
  return next;
};

const ingestLogMaxEntries = 500;

export const appendIngestLogEntry = (log, entry) => {
  const next = ensureLog(log);
  next.entries.unshift({
    at: isoNow(),
    sourceId: entry?.sourceId ?? 'unknown',
    sourceTitle: entry?.sourceTitle ?? null,
    affectedPages: Array.isArray(entry?.affectedPages) ? entry.affectedPages.slice(0, 64) : [],
    action: entry?.action ?? 'ingest',
    confidence: Number.isFinite(entry?.confidence) ? Math.max(0, Math.min(1, Number(entry.confidence))) : null,
    notes: entry?.notes ? String(entry.notes).slice(0, 240) : null,
  });
  next.entries = next.entries.slice(0, ingestLogMaxEntries);
  next.updatedAt = isoNow();
  return next;
};
