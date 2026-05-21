const LLM_TIERS = new Set(['llm-tier-a', 'llm-tier-b', 'llm-tier-c']);

const isNull = (value) => value === null || value === undefined;

export const validateClaim = (record) => {
  const errors = [];
  if (!record || typeof record !== 'object') {
    return { ok: false, errors: ['claim must be an object'] };
  }

  const required = [
    'claim_id',
    'text',
    'extraction_step_id',
    'provenance_kind',
    'parent_claim_ids',
    'root_sources',
    'ingest_id',
  ];
  for (const field of required) {
    if (record[field] === undefined || record[field] === null || record[field] === '') {
      if (field !== 'parent_claim_ids' && field !== 'root_sources') {
        errors.push(`missing required field: ${field}`);
      }
    }
  }

  if (!Array.isArray(record.parent_claim_ids)) {
    errors.push('parent_claim_ids must be an array');
  }
  if (!Array.isArray(record.root_sources) || record.root_sources.length === 0) {
    errors.push('root_sources must be a non-empty array');
  }

  const kind = String(record.provenance_kind ?? '');
  if (!kind) {
    errors.push('provenance_kind is required');
    return { ok: false, errors };
  }

  if (LLM_TIERS.has(kind)) {
    if (isNull(record.confidence)) {
      errors.push(`${kind} requires confidence`);
    } else {
      const confidence = Number(record.confidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        errors.push(`${kind} confidence must be a number in [0, 1]`);
      }
    }
    if (!record.source_span_id || typeof record.source_span_id !== 'object') {
      errors.push(`${kind} requires source_span_id`);
    }
  } else if (kind === 'heuristic') {
    if (!isNull(record.confidence)) {
      errors.push('heuristic claims must have confidence null');
    }
  } else if (kind === 'human-edited') {
    if (!isNull(record.confidence)) {
      errors.push('human-edited claims must have confidence null');
    }
    if (!record.verified_by) {
      errors.push('human-edited requires verified_by');
    }
  } else if (kind === 'derived') {
    if (!Array.isArray(record.derived_from) || record.derived_from.length === 0) {
      errors.push('derived requires derived_from');
    }
  } else {
    errors.push(`unknown provenance_kind: ${kind}`);
  }

  if (!isNull(record.confidence) && !LLM_TIERS.has(kind) && kind !== 'derived') {
    errors.push('confidence is only allowed for llm-tier-* and derived claims');
  }

  return { ok: errors.length === 0, errors };
};

export const provenanceKindForTier = (tier) => {
  const normalized = String(tier ?? 'a').toLowerCase().replace(/^tier-?/, '');
  if (normalized === 'b') {
    return 'llm-tier-b';
  }
  if (normalized === 'c') {
    return 'llm-tier-c';
  }
  return 'llm-tier-a';
};
