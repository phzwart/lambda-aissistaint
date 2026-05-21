import { createHash } from 'node:crypto';

const canonicalJson = (value) => JSON.stringify(value, Object.keys(value).sort());

export const directClaimId = ({ text, sourceSpanId, extractionStepId }) =>
  createHash('sha256')
    .update(
      canonicalJson({
        text: String(text ?? '').trim(),
        source_span_id: sourceSpanId,
        extraction_step_id: extractionStepId,
      }),
    )
    .digest('hex');

export const derivedClaimId = ({ text, extractionStepId, parentClaimIds }) =>
  createHash('sha256')
    .update(
      canonicalJson({
        text: String(text ?? '').trim(),
        extraction_step_id: extractionStepId,
        parent_claim_ids: [...parentClaimIds].sort(),
      }),
    )
    .digest('hex');
