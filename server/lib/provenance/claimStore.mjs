import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { parsedArtifactPrefix } from '../projectParsedPaths.mjs';

const readObjectText = async (client, bucketName, key) => {
  const result = await client.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    }),
  );
  const chunks = [];
  for await (const chunk of result.Body) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
};

export const readClaimsJsonl = async (client, project, stem) => {
  const key = `${parsedArtifactPrefix(project, stem)}claims.jsonl`;
  try {
    const text = await readObjectText(client, project.bucketName, key);
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

export const readProvenanceDag = async (client, project, stem) => {
  const key = `${parsedArtifactPrefix(project, stem)}provenance_dag.json`;
  try {
    return JSON.parse(await readObjectText(client, project.bucketName, key));
  } catch {
    return null;
  }
};

export const findClaimById = async ({ client, project, claimId }) => {
  const parsedPrefix = String(project.parsedPrefix ?? 'parsed').replace(/^\/+|\/+$/g, '') || 'parsed';
  let continuationToken;
  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: project.bucketName,
        Prefix: `${parsedPrefix}/`,
        ContinuationToken: continuationToken,
      }),
    );
    const stems = new Set();
    for (const item of result.Contents ?? []) {
      const relative = (item.Key ?? '').slice(`${parsedPrefix}/`.length);
      const stem = relative.split('/')[0];
      if (stem && !stem.startsWith('_') && relative.endsWith('/claims.jsonl')) {
        stems.add(stem);
      }
    }
    for (const stem of stems) {
      const claims = await readClaimsJsonl(client, project, stem);
      const match = claims.find((claim) => claim.claim_id === claimId);
      if (match) {
        const dag = await readProvenanceDag(client, project, stem);
        return { claim: match, stem, dag };
      }
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);
  return null;
};

export const listAllClaimsForSource = async ({ client, project, sourceHash }) => {
  const { readIngestIndex } = await import('./ingestIndex.mjs');
  const index = await readIngestIndex({ client, project, sourceHash });
  const all = [];
  for (const entry of index) {
    const claims = await readClaimsJsonl(client, project, entry.stem);
    all.push(...claims);
  }
  return all;
};
