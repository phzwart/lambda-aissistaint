import {
  listParsedArtifactsForFile,
  readParsedArtifactForFile,
} from '../lib/parsedArtifacts.mjs';
import { streamParsedArtifactsZip } from '../lib/parsedArtifactZip.mjs';
import { findClaimById, readClaimsJsonl } from '../lib/provenance/claimStore.mjs';
import { provenanceForClaim } from '../lib/provenance/buildDag.mjs';
import {
  readIngestTrace,
  readLatestIngestTraceForSource,
} from '../lib/provenance/ingestTrace.mjs';
import { readIngestIndex } from '../lib/provenance/ingestIndex.mjs';
import { diffClaims } from '../lib/provenance/aggregate.mjs';

export const createProvenanceService = () => ({
  listParsedArtifactsForFile,
  readParsedArtifactForFile,
  streamParsedArtifactsZip,
  findClaimById,
  provenanceForClaim,
  readIngestTrace,
  readLatestIngestTraceForSource,
  readIngestIndex,
  readClaimsJsonl,
  diffClaims,
});
