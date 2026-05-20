import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { PARSED_OUTPUT_ARTIFACTS } from './parsedArtifactSync.mjs';
import { parsedArtifactPrefix, parsedStemFromObjectKey } from './projectParsedPaths.mjs';

export const PARSED_ARTIFACT_CATALOG = [
  ...PARSED_OUTPUT_ARTIFACTS,
  { name: 'process.log', contentType: 'text/plain; charset=utf-8' },
  { name: 'processing.status.json', contentType: 'application/json' },
];

const ALLOWED_ARTIFACT_NAMES = new Set(PARSED_ARTIFACT_CATALOG.map((entry) => entry.name));

export const artifactKindForName = (name) => {
  if (name.endsWith('.md')) {
    return 'markdown';
  }
  if (name.endsWith('.json')) {
    return 'json';
  }
  if (name === 'process.log') {
    return 'log';
  }
  return 'text';
};

const readObjectText = async (client, bucketName, key) => {
  try {
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
  } catch (error) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
};

const headObject = async (client, bucketName, key) => {
  try {
    return await client.send(
      new HeadObjectCommand({
        Bucket: bucketName,
        Key: key,
      }),
    );
  } catch (error) {
    if (error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
};

export const assertAllowedArtifactName = (artifactName) => {
  const name = String(artifactName ?? '').trim();
  if (!name || !ALLOWED_ARTIFACT_NAMES.has(name) || name.includes('/') || name.includes('..')) {
    throw Object.assign(new Error('Unknown or invalid parsed artifact name.'), { status: 400 });
  }
  return name;
};

export const listParsedArtifactsForFile = async (client, project, file) => {
  const stem = parsedStemFromObjectKey(file.objectKey);
  const prefix = parsedArtifactPrefix(project, stem);
  const artifacts = [];

  for (const entry of PARSED_ARTIFACT_CATALOG) {
    const objectKey = `${prefix}${entry.name}`;
    const head = await headObject(client, project.bucketName, objectKey);
    if (!head) {
      continue;
    }
    artifacts.push({
      name: entry.name,
      kind: artifactKindForName(entry.name),
      objectKey,
      size: Number(head.ContentLength ?? 0),
      lastModified: head.LastModified ? new Date(head.LastModified).toISOString() : null,
      contentType: entry.contentType,
    });
  }

  return {
    fileId: file.id,
    fileName: file.name,
    stem,
    parsedPrefix: project.parsedPrefix ?? 'parsed',
    prefix,
    artifacts,
  };
};

export const readParsedArtifactForFile = async (client, project, file, artifactName) => {
  const name = assertAllowedArtifactName(artifactName);
  const stem = parsedStemFromObjectKey(file.objectKey);
  const prefix = parsedArtifactPrefix(project, stem);
  const objectKey = `${prefix}${name}`;
  const content = await readObjectText(client, project.bucketName, objectKey);
  if (content === null) {
    throw Object.assign(new Error(`Parsed artifact not found: ${name}`), { status: 404 });
  }
  const catalogEntry = PARSED_ARTIFACT_CATALOG.find((entry) => entry.name === name);
  return {
    fileId: file.id,
    fileName: file.name,
    name,
    kind: artifactKindForName(name),
    objectKey,
    contentType: catalogEntry?.contentType ?? 'text/plain; charset=utf-8',
    content,
  };
};
