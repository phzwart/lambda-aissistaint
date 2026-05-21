import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const indexKey = (project, sourceHash) => {
  const parsedPrefix = String(project.parsedPrefix ?? 'parsed').replace(/^\/+|\/+$/g, '') || 'parsed';
  return `${parsedPrefix}/_ingest_index/${sourceHash}.jsonl`;
};

export const appendIngestIndexEntry = async ({
  client,
  project,
  sourceHash,
  entry,
}) => {
  const key = indexKey(project, sourceHash);
  let existing = '';
  try {
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
    existing = Buffer.concat(chunks).toString('utf8');
  } catch {
    existing = '';
  }
  const line = `${JSON.stringify(entry)}\n`;
  const body = Buffer.from(`${existing}${line}`, 'utf8');
  await client.send(
    new PutObjectCommand({
      Bucket: project.bucketName,
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentType: 'application/x-ndjson',
    }),
  );
  return key;
};

export const readIngestIndex = async ({ client, project, sourceHash }) => {
  const key = indexKey(project, sourceHash);
  try {
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
    const text = Buffer.concat(chunks).toString('utf8');
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};
