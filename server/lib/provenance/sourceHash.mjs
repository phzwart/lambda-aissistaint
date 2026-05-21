import { createHash } from 'node:crypto';

export const computeSourceHash = (buffer) =>
  createHash('sha256').update(buffer).digest('hex');

export const computeSpanId = (sourceHash, chunkIndex, charStart, charEnd) =>
  createHash('sha256')
    .update(`${sourceHash}:${chunkIndex}:${charStart}:${charEnd}`)
    .digest('hex');
