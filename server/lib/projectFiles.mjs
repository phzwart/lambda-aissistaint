import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { processStatusObjectKey } from './projectParsedPaths.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';

const pdfContentTypes = new Set(['application/pdf', 'application/x-pdf']);

export const sanitizeUploadFileName = (name) => {
  const base = basename(String(name ?? 'document.pdf'))
    .replace(/[^\w.\- ()[\]]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const withExt = base.toLowerCase().endsWith('.pdf') ? base : `${base || 'document'}.pdf`;
  return withExt.slice(0, 180);
};

export const buildLoadedObjectKey = (loadedPrefix, fileName) => {
  const prefix = String(loadedPrefix ?? 'loaded').replace(/^\/+|\/+$/g, '') || 'loaded';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const shortId = randomUUID().slice(0, 8);
  return `${prefix}/${stamp}-${shortId}-${sanitizeUploadFileName(fileName)}`;
};

const fileIdFromObjectKey = (objectKey) =>
  createHash('sha256').update(String(objectKey ?? '')).digest('hex').slice(0, 32);

export const toManagedFileRecord = ({ objectKey, size, lastModified, status = 'uploaded' }) => ({
  id: fileIdFromObjectKey(objectKey),
  objectKey,
  name: basename(objectKey),
  size: Number(size ?? 0),
  uploadedAt: lastModified ? new Date(lastModified).toISOString() : new Date().toISOString(),
  status,
});

const readJsonObject = async (client, bucketName, key) => {
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
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
};

const listParsedStemStatuses = async (client, bucketName, parsedPrefix) => {
  const completed = new Set();
  const inProgress = new Set();
  const failed = new Set();
  const statusCandidates = new Set();
  const normalizedPrefix = `${String(parsedPrefix).replace(/^\/+|\/+$/g, '')}/`;
  let continuationToken;

  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: normalizedPrefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const item of result.Contents ?? []) {
      const key = item.Key ?? '';
      const relative = key.slice(normalizedPrefix.length);
      const stem = relative.split('/')[0];
      if (!stem) {
        continue;
      }
      if (key.endsWith('/summary.md')) {
        completed.add(stem);
      } else if (key.endsWith('/processing.status.json')) {
        statusCandidates.add(stem);
      } else if (key.endsWith('/process.log')) {
        inProgress.add(stem);
      }
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  const project = { bucketName, parsedPrefix };
  for (const stem of statusCandidates) {
    if (completed.has(stem)) {
      continue;
    }
    const status = await readJsonObject(client, bucketName, processStatusObjectKey(project, stem));
    if (status?.status === 'failed') {
      failed.add(stem);
      inProgress.delete(stem);
    } else if (status?.status === 'running') {
      inProgress.add(stem);
    }
  }

  for (const stem of inProgress) {
    if (completed.has(stem)) {
      inProgress.delete(stem);
    }
  }

  return { completed, inProgress, failed };
};

export const listProjectFiles = async (client, project) => {
  const loadedPrefix = `${String(project.loadedPrefix ?? 'loaded').replace(/^\/+|\/+$/g, '')}/`;
  const parsedPrefix = String(project.parsedPrefix ?? 'parsed').replace(/^\/+|\/+$/g, '');
  const parsedStems = await listParsedStemStatuses(client, project.bucketName, parsedPrefix);
  const files = [];
  let continuationToken;

  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: project.bucketName,
        Prefix: loadedPrefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const item of result.Contents ?? []) {
      if (!item.Key || item.Key.endsWith('/')) {
        continue;
      }
      const stem = basename(item.Key).replace(/\.pdf$/i, '');
      let status = 'uploaded';
      if (parsedStems.completed.has(stem)) {
        status = 'completed';
      } else if (parsedStems.failed.has(stem)) {
        status = 'failed';
      } else if (parsedStems.inProgress.has(stem)) {
        status = 'processing';
      }
      files.push(
        toManagedFileRecord({
          objectKey: item.Key,
          size: item.Size,
          lastModified: item.LastModified,
          status,
        }),
      );
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  files.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
  return files;
};

export const uploadProjectFiles = async (client, project, uploads) => {
  const results = [];
  for (const upload of uploads) {
    const originalName = upload.originalname ?? upload.name ?? 'document.pdf';
    const contentType = String(upload.mimetype ?? '').toLowerCase();
    if (!pdfContentTypes.has(contentType) && !originalName.toLowerCase().endsWith('.pdf')) {
      throw Object.assign(new Error(`Only PDF uploads are supported (${originalName}).`), { status: 400 });
    }
    const buffer = upload.buffer;
    if (!buffer?.length) {
      throw Object.assign(new Error(`Uploaded file is empty (${originalName}).`), { status: 400 });
    }
    const objectKey = buildLoadedObjectKey(project.loadedPrefix, originalName);
    await client.send(
      new PutObjectCommand({
        Bucket: project.bucketName,
        Key: objectKey,
        Body: buffer,
        ContentLength: buffer.length,
        ContentType: 'application/pdf',
      }),
    );
    results.push(
      toManagedFileRecord({
        objectKey,
        size: buffer.length,
        lastModified: new Date(),
        status: 'uploaded',
      }),
    );
  }
  return results;
};

export const readProjectFileBuffer = async (client, project, objectKey) => {
  const key = String(objectKey ?? '').replace(/^\/+/, '');
  const loadedPrefix = String(project.loadedPrefix ?? 'loaded').replace(/^\/+|\/+$/g, '');
  if (!key.startsWith(`${loadedPrefix}/`)) {
    throw Object.assign(new Error('Object key is outside the project loaded prefix.'), { status: 400 });
  }
  const result = await client.send(
    new GetObjectCommand({
      Bucket: project.bucketName,
      Key: key,
    }),
  );
  const chunks = [];
  for await (const chunk of result.Body) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
};

