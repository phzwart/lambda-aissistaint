import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.mjs';
import { logAuditEvent } from '../lib/auditEvents.mjs';
import { listProjectFiles } from '../lib/projectFiles.mjs';

export const createProvenanceRouter = ({ middleware, services }) => {
  const router = Router();
  const { requireAuth, requireAdmin, userSubject } = middleware;
  const { projects, provenance } = services;

  router.get(
    '/api/projects/:id/files/:fileId/parsed-artifacts',
    requireAuth,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, [
        'owner',
        'editor',
        'viewer',
      ]);
      const client = projects.requireProjectMinio(project);
      const files = await listProjectFiles(client, project);
      const file = files.find((entry) => entry.id === request.params.fileId);
      if (!file) {
        response.status(404).json({ error: 'File not found in this project.' });
        return;
      }
      const listing = await provenance.listParsedArtifactsForFile(client, project, file);
      response.json(listing);
    }),
  );

  router.get(
    '/api/projects/:id/files/:fileId/parsed-artifacts.zip',
    requireAuth,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, [
        'owner',
        'editor',
        'viewer',
      ]);
      const client = projects.requireProjectMinio(project);
      const files = await listProjectFiles(client, project);
      const file = files.find((entry) => entry.id === request.params.fileId);
      if (!file) {
        response.status(404).json({ error: 'File not found in this project.' });
        return;
      }
      await provenance.streamParsedArtifactsZip({ client, project, file, response });
    }),
  );

  router.get(
    '/api/projects/:id/files/:fileId/parsed-artifacts/:artifactName',
    requireAuth,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, [
        'owner',
        'editor',
        'viewer',
      ]);
      const client = projects.requireProjectMinio(project);
      const files = await listProjectFiles(client, project);
      const file = files.find((entry) => entry.id === request.params.fileId);
      if (!file) {
        response.status(404).json({ error: 'File not found in this project.' });
        return;
      }
      const artifact = await provenance.readParsedArtifactForFile(
        client,
        project,
        file,
        decodeURIComponent(request.params.artifactName),
      );
      response.json(artifact);
    }),
  );

  router.get(
    '/api/projects/:id/claims/:claimId/provenance',
    requireAuth,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, [
        'owner',
        'editor',
        'viewer',
      ]);
      const client = projects.requireProjectMinio(project);
      const found = await provenance.findClaimById({
        client,
        project,
        claimId: request.params.claimId,
      });
      if (!found) {
        response.status(404).json({ error: 'Claim not found in this project.' });
        return;
      }
      const dagView = provenance.provenanceForClaim(found.dag, found.claim.claim_id);
      logAuditEvent({
        event: 'claim.provenance_read',
        actor: userSubject(request),
        action: 'read',
        resourceType: 'claim',
        resourceId: found.claim.claim_id,
        outcome: 'success',
        metadata: { projectId: project.id, stem: found.stem },
      });
      response.json({
        claim_id: found.claim.claim_id,
        root_sources: found.claim.root_sources ?? [],
        nodes: dagView?.nodes ?? [],
        edges: dagView?.edges ?? [],
      });
    }),
  );

  router.get(
    '/api/projects/:id/admin/ingest-trace/:sourceHash',
    requireAuth,
    requireAdmin,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, [
        'owner',
        'editor',
        'viewer',
      ]);
      const client = projects.requireProjectMinio(project);
      const ingestId = typeof request.query.ingest_id === 'string' ? request.query.ingest_id : null;
      const trace = ingestId
        ? await provenance.readIngestTrace({
            client,
            project,
            sourceHash: request.params.sourceHash,
            ingestId,
          })
        : await provenance.readLatestIngestTraceForSource({
            client,
            project,
            sourceHash: request.params.sourceHash,
          });
      if (!trace) {
        response.status(404).json({ error: 'Ingest trace not found for this source.' });
        return;
      }
      logAuditEvent({
        event: 'ingest_trace.read',
        actor: userSubject(request),
        action: 'read',
        resourceType: 'ingest_trace',
        resourceId: request.params.sourceHash,
        outcome: 'success',
        metadata: { projectId: project.id, ingestId: trace.ingest_id },
      });
      response.json(trace);
    }),
  );

  router.get(
    '/api/projects/:id/admin/reingest-diff/:sourceHash',
    requireAuth,
    requireAdmin,
    asyncHandler(async (request, response) => {
      const project = await projects.requireProjectAccess(request.params.id, request, [
        'owner',
        'editor',
        'viewer',
      ]);
      const client = projects.requireProjectMinio(project);
      const fromId = String(request.query.from ?? '').trim();
      const toId = String(request.query.to ?? '').trim();
      if (!fromId || !toId) {
        response.status(400).json({ error: 'Query parameters from and to (ingest_id) are required.' });
        return;
      }
      const index = await provenance.readIngestIndex({
        client,
        project,
        sourceHash: request.params.sourceHash,
      });
      const fromEntry = index.find((entry) => entry.ingest_id === fromId);
      const toEntry = index.find((entry) => entry.ingest_id === toId);
      if (!fromEntry || !toEntry) {
        response.status(404).json({ error: 'One or both ingest runs were not found for this source.' });
        return;
      }
      const claimsA = await provenance.readClaimsJsonl(client, project, fromEntry.stem);
      const claimsB = await provenance.readClaimsJsonl(client, project, toEntry.stem);
      const diff = provenance.diffClaims(claimsA, claimsB);
      logAuditEvent({
        event: 'reingest_diff.read',
        actor: userSubject(request),
        action: 'read',
        resourceType: 'reingest_diff',
        resourceId: request.params.sourceHash,
        outcome: 'success',
        metadata: { projectId: project.id, from: fromId, to: toId },
      });
      response.json({
        source_hash: request.params.sourceHash,
        from: fromId,
        to: toId,
        ...diff,
      });
    }),
  );

  return router;
};
