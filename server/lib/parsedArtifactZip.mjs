import archiver from 'archiver';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { listParsedArtifactsForFile } from './parsedArtifacts.mjs';
import { parsedArtifactPrefix, parsedStemFromObjectKey } from './projectParsedPaths.mjs';

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

const safeZipBaseName = (stem, fileName) => {
  const fromStem = String(stem ?? '').trim();
  if (fromStem) {
    return fromStem.replace(/[^\w.\-]+/g, '_').slice(0, 120);
  }
  const base = String(fileName ?? 'processed-output').replace(/\.pdf$/i, '');
  return base.replace(/[^\w.\-]+/g, '_').slice(0, 120) || 'processed-output';
};

/**
 * Stream a zip of every listed parsed artifact for a file into the HTTP response.
 */
export const streamParsedArtifactsZip = async ({ client, project, file, response }) => {
  const listing = await listParsedArtifactsForFile(client, project, file);
  if (!listing.artifacts.length) {
    throw Object.assign(new Error('No processed artifacts are available to download yet.'), { status: 404 });
  }

  const zipName = `${safeZipBaseName(listing.stem, file.name)}.zip`;
  response.setHeader('Content-Type', 'application/zip');
  response.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  const prefix = parsedArtifactPrefix(project, parsedStemFromObjectKey(file.objectKey));

  for (const artifact of listing.artifacts) {
    const objectKey = artifact.objectKey ?? `${prefix}${artifact.name}`;
    const bytes = await readObjectBytes(client, project.bucketName, objectKey);
    if (!bytes?.length) {
      continue;
    }
    archive.append(bytes, { name: artifact.name });
  }

  return new Promise((resolve, reject) => {
    archive.on('error', reject);
    archive.on('end', resolve);
    response.on('close', () => {
      if (!response.writableFinished) {
        archive.abort();
      }
    });
    archive.pipe(response);
    archive.finalize().catch(reject);
  });
};
