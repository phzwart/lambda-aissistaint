import { GetObjectCommand } from '@aws-sdk/client-s3';
import { listProjectFiles } from '../projectFiles.mjs';
import { parsedArtifactPrefix, parsedStemFromObjectKey } from '../projectParsedPaths.mjs';
import { ingestDocument } from './ingest.mjs';

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

export const readParsedSummaryForFile = async (client, project, file) => {
  const stem = parsedStemFromObjectKey(file.objectKey);
  const key = `${parsedArtifactPrefix(project, stem)}summary.md`;
  return readObjectText(client, project.bucketName, key);
};

const buildSourceWikiIndex = async (storage) => {
  const bySourceId = new Map();
  const ingestLog = await storage.readMetadataJson('ingest-log.json', { entries: [] });
  for (const entry of ingestLog.entries ?? []) {
    const sourceId = String(entry?.sourceId ?? '').trim();
    if (!sourceId) {
      continue;
    }
    const pageKey = entry.affectedPages?.[0] ?? null;
    if (pageKey) {
      bySourceId.set(sourceId, {
        pageKey,
        ingestedAt: entry.at ?? null,
      });
    }
  }

  const provenance = await storage.readMetadataJson('provenance.json', { entries: {} });
  for (const [pageKey, records] of Object.entries(provenance.entries ?? {})) {
    for (const record of records ?? []) {
      const sourceId = String(record?.sourceId ?? '').trim();
      if (!sourceId || bySourceId.has(sourceId)) {
        continue;
      }
      bySourceId.set(sourceId, {
        pageKey,
        ingestedAt: record.recordedAt ?? null,
      });
    }
  }

  return bySourceId;
};

export const listWikiProcessedSources = async ({ client, project, storage }) => {
  const files = await listProjectFiles(client, project);
  const wikiBySource = await buildSourceWikiIndex(storage);

  const sources = [];
  for (const file of files) {
    const wiki = wikiBySource.get(file.id);
    let hasSummary = false;
    if (file.status === 'completed') {
      const summary = await readParsedSummaryForFile(client, project, file);
      hasSummary = Boolean(summary?.trim());
    }
    sources.push({
      fileId: file.id,
      fileName: file.name,
      objectKey: file.objectKey,
      status: file.status,
      hasSummary,
      wikiPageKey: wiki?.pageKey ?? null,
      wikiIngestedAt: wiki?.ingestedAt ?? null,
    });
  }

  return sources;
};

export const ingestProcessedFileToWiki = async ({
  client,
  project,
  file,
  storage,
  llmConfig,
  callLlmChatEndpoint,
  extractLlmAnswer,
  logger,
}) => {
  const summaryText = await readParsedSummaryForFile(client, project, file);
  if (!summaryText?.trim()) {
    throw Object.assign(
      new Error(`No PaperQA summary found for ${file.name}. Run Process on File Management first.`),
      { status: 404 },
    );
  }

  let title = file.name;
  try {
    const stem = parsedStemFromObjectKey(file.objectKey);
    const metadataKey = `${parsedArtifactPrefix(project, stem)}extraction_metadata.json`;
    const metadataText = await readObjectText(client, project.bucketName, metadataKey);
    if (metadataText) {
      const metadata = JSON.parse(metadataText);
      if (metadata?.title) {
        title = String(metadata.title);
      }
    }
  } catch {
    // optional metadata
  }

  return ingestDocument({
    storage,
    document: {
      sourceId: file.id,
      title,
      text: summaryText,
      suggestedCategory: 'concepts',
      category: 'concepts',
    },
    llmConfig,
    callLlmChatEndpoint,
    extractLlmAnswer,
    logger,
  });
};

export const syncProcessedFilesToWiki = async ({
  client,
  project,
  storage,
  fileIds,
  llmConfig,
  callLlmChatEndpoint,
  extractLlmAnswer,
  logger,
}) => {
  const allSources = await listWikiProcessedSources({ client, project, storage });
  const idSet = fileIds?.length ? new Set(fileIds) : null;
  const targets = allSources.filter((source) => {
    if (idSet && !idSet.has(source.fileId)) {
      return false;
    }
    return source.status === 'completed' && source.hasSummary;
  });

  const ingested = [];
  const skipped = [];
  const errors = [];

  for (const source of targets) {
    if (source.wikiPageKey) {
      skipped.push({ fileId: source.fileId, fileName: source.fileName, reason: 'already_in_wiki', pageKey: source.wikiPageKey });
      continue;
    }
    const file = { id: source.fileId, name: source.fileName, objectKey: source.objectKey, status: source.status };
    try {
      const result = await ingestProcessedFileToWiki({
        client,
        project,
        file,
        storage,
        llmConfig,
        callLlmChatEndpoint,
        extractLlmAnswer,
        logger,
      });
      ingested.push({
        fileId: source.fileId,
        fileName: source.fileName,
        pageKey: result.pageKey,
        fallback: Boolean(result.suggestion?.fallback),
      });
    } catch (error) {
      errors.push({
        fileId: source.fileId,
        fileName: source.fileName,
        error: error instanceof Error ? error.message : 'Ingest failed.',
      });
    }
  }

  return { ingested, skipped, errors };
};
