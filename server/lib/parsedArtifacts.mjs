import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { FIGURES_MANIFEST_NAME, isFigureArtifactName, PARSED_OUTPUT_ARTIFACTS } from './parsedArtifactSync.mjs';
import { parsedArtifactPrefix, parsedStemFromObjectKey } from './projectParsedPaths.mjs';

export const PARSED_ARTIFACT_CATALOG = [
  ...PARSED_OUTPUT_ARTIFACTS,
  { name: 'process.log', contentType: 'text/plain; charset=utf-8' },
  { name: 'processing.status.json', contentType: 'application/json' },
];

const ALLOWED_ARTIFACT_NAMES = new Set(PARSED_ARTIFACT_CATALOG.map((entry) => entry.name));

export const artifactKindForName = (name) => {
  if (isFigureArtifactName(name)) {
    return 'image';
  }
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

const readObjectBytes = async (client, bucketName, key) => {
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
    return Buffer.concat(chunks);
  } catch (error) {
    if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
};

const readObjectText = async (client, bucketName, key) => {
  const bytes = await readObjectBytes(client, bucketName, key);
  return bytes === null ? null : bytes.toString('utf8');
};

const loadFigureNamesFromManifest = async (client, bucketName, prefix) => {
  const manifestKey = `${prefix}${FIGURES_MANIFEST_NAME}`;
  const text = await readObjectText(client, bucketName, manifestKey);
  if (!text) {
    return [];
  }
  try {
    const payload = JSON.parse(text);
    const figures = Array.isArray(payload?.figures) ? payload.figures : [];
    return figures
      .map((entry) => String(entry?.artifact_name ?? '').trim())
      .filter((name) => isFigureArtifactName(name));
  } catch {
    return [];
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
  if (!name || name.includes('..')) {
    throw Object.assign(new Error('Unknown or invalid parsed artifact name.'), { status: 400 });
  }
  if (ALLOWED_ARTIFACT_NAMES.has(name) || isFigureArtifactName(name)) {
    return name;
  }
  throw Object.assign(new Error('Unknown or invalid parsed artifact name.'), { status: 400 });
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

  const figureNames = await loadFigureNamesFromManifest(client, project.bucketName, prefix);
  for (const figureName of figureNames) {
    const objectKey = `${prefix}${figureName}`;
    const head = await headObject(client, project.bucketName, objectKey);
    if (!head) {
      continue;
    }
    artifacts.push({
      name: figureName,
      kind: artifactKindForName(figureName),
      objectKey,
      size: Number(head.ContentLength ?? 0),
      lastModified: head.LastModified ? new Date(head.LastModified).toISOString() : null,
      contentType: 'image/png',
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
  const kind = artifactKindForName(name);
  const catalogEntry = PARSED_ARTIFACT_CATALOG.find((entry) => entry.name === name);
  const contentType =
    catalogEntry?.contentType ?? (kind === 'image' ? 'image/png' : 'text/plain; charset=utf-8');

  if (kind === 'image') {
    const bytes = await readObjectBytes(client, project.bucketName, objectKey);
    if (bytes === null) {
      throw Object.assign(new Error(`Parsed artifact not found: ${name}`), { status: 404 });
    }
    return {
      fileId: file.id,
      fileName: file.name,
      name,
      kind,
      objectKey,
      contentType,
      content: bytes.toString('base64'),
      encoding: 'base64',
    };
  }

  const content = await readObjectText(client, project.bucketName, objectKey);
  if (content === null) {
    throw Object.assign(new Error(`Parsed artifact not found: ${name}`), { status: 404 });
  }
  return {
    fileId: file.id,
    fileName: file.name,
    name,
    kind,
    objectKey,
    contentType,
    content,
  };
};
