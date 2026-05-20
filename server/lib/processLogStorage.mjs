import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import { createProcessLogger } from './processLog.mjs';
import { processLogObjectKey } from './projectParsedPaths.mjs';

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

export const writeProcessLogToMinio = async (client, project, stem, content) => {
  const body = Buffer.from(String(content ?? ''), 'utf8');
  if (!body.length) {
    return null;
  }
  const key = processLogObjectKey(project, stem);
  await client.send(
    new PutObjectCommand({
      Bucket: project.bucketName,
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentType: 'text/plain; charset=utf-8',
    }),
  );
  return key;
};

export const readProcessLogFromMinio = async (client, project, stem) => {
  const key = processLogObjectKey(project, stem);
  return readObjectText(client, project.bucketName, key);
};

export const flushLocalProcessLogToMinio = async (client, project, stem, logFilePath) => {
  let content;
  try {
    content = await readFile(logFilePath, 'utf8');
  } catch {
    return null;
  }
  if (!content.trim()) {
    return null;
  }
  return writeProcessLogToMinio(client, project, stem, content);
};

/**
 * Local process.log file with debounced upload into the project's parsed/ prefix in MinIO.
 */
export const createMinioBackedProcessLogger = ({
  client,
  project,
  stem,
  logFilePath,
  onLine,
  flushMs = Number.parseInt(process.env.PROJECT_PROCESS_LOG_UPLOAD_MS ?? '5000', 10) || 5000,
}) => {
  let flushTimer = null;
  let flushChain = Promise.resolve();

  const scheduleFlush = () => {
    if (flushTimer) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushChain = flushChain.then(() => flushLocalProcessLogToMinio(client, project, stem, logFilePath));
    }, flushMs);
  };

  const flushNow = () => flushLocalProcessLogToMinio(client, project, stem, logFilePath);

  const fileLog = createProcessLogger({
    logFilePath,
    onLine: (line) => {
      if (onLine) {
        onLine(line);
      }
      scheduleFlush();
    },
  });

  const initMinioLog = async (headerLine) => {
    const key = processLogObjectKey(project, stem);
    await fileLog.append(headerLine ?? `Process log for ${stem} (${new Date().toISOString()})`);
    await flushNow();
    return key;
  };

  return {
    ...fileLog,
    initMinioLog,
    flushNow,
    cancelScheduledFlush: () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    },
    waitForPendingFlush: () => flushChain,
  };
};
