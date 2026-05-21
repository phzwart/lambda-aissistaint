import { createHash } from 'node:crypto';
import { PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { parsedArtifactPrefix } from '../projectParsedPaths.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const retainContent = () => process.env.INGEST_TRACE_RETAIN_CONTENT === 'true';

export class IngestTraceBuilder {
  constructor({ ingestId, sourceHash, stem, file, startedAt }) {
    this.ingestId = ingestId;
    this.sourceHash = sourceHash;
    this.stem = stem;
    this.file = file;
    this.startedAt = startedAt;
    this.stages = [];
    this.llmCalls = [];
  }

  addStage({ stageId, inputs = {}, outputs = {}, durationMs = null }) {
    const entry = {
      stage_id: stageId,
      started_at: new Date().toISOString(),
      duration_ms: durationMs,
      inputs: this.#hashFields(inputs),
      outputs: this.#hashFields(outputs),
    };
    this.stages.push(entry);
    return entry;
  }

  recordLlmCall({
    extractionStepId,
    modelAlias,
    prompt,
    response,
    durationMs,
    usage,
  }) {
    const record = {
      call_id: sha256(`${this.ingestId}:${this.llmCalls.length}:${extractionStepId}`),
      extraction_step_id: extractionStepId,
      model_alias: modelAlias,
      prompt_hash: sha256(prompt),
      response_hash: sha256(response),
      prompt_tokens: usage?.prompt_tokens ?? null,
      completion_tokens: usage?.completion_tokens ?? null,
      duration_ms: durationMs ?? null,
    };
    if (retainContent()) {
      record.prompt = prompt;
      record.response = response;
    }
    this.llmCalls.push(record);
    return record;
  }

  #hashFields(fields) {
    const result = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === null || value === undefined) {
        continue;
      }
      if (typeof value === 'string' && retainContent() && value.length < 20_000) {
        result[key] = value;
        result[`${key}_hash`] = sha256(value);
      } else if (typeof value === 'string' || Buffer.isBuffer(value)) {
        const text = Buffer.isBuffer(value) ? value.toString('utf8') : value;
        result[`${key}_hash`] = sha256(text);
        if (typeof value === 'string' && value.length < 256) {
          result[key] = value;
        }
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  build({ finishedAt }) {
    return {
      version: 1,
      ingest_id: this.ingestId,
      source_hash: this.sourceHash,
      stem: this.stem,
      file_id: this.file?.id ?? null,
      object_key: this.file?.objectKey ?? null,
      started_at: this.startedAt,
      finished_at: finishedAt,
      retain_content: retainContent(),
      stages: this.stages,
      llm_calls: this.llmCalls,
    };
  }
}

export const ingestTraceObjectKey = (project, sourceHash, ingestId) => {
  const parsedPrefix = String(project.parsedPrefix ?? 'parsed').replace(/^\/+|\/+$/g, '') || 'parsed';
  return `${parsedPrefix}/_traces/${sourceHash}/${ingestId}.json`;
};

export const writeIngestTrace = async ({ client, project, trace }) => {
  const key = ingestTraceObjectKey(project, trace.source_hash, trace.ingest_id);
  const body = Buffer.from(JSON.stringify(trace, null, 2), 'utf8');
  await client.send(
    new PutObjectCommand({
      Bucket: project.bucketName,
      Key: key,
      Body: body,
      ContentLength: body.length,
      ContentType: 'application/json',
    }),
  );
  return key;
};

export const readIngestTrace = async ({ client, project, sourceHash, ingestId }) => {
  const key = ingestTraceObjectKey(project, sourceHash, ingestId);
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
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
};

export const readLatestIngestTraceForSource = async ({ client, project, sourceHash }) => {
  const parsedPrefix = String(project.parsedPrefix ?? 'parsed').replace(/^\/+|\/+$/g, '') || 'parsed';
  const prefix = `${parsedPrefix}/_traces/${sourceHash}/`;
  const result = await client.send(
    new ListObjectsV2Command({
      Bucket: project.bucketName,
      Prefix: prefix,
    }),
  );
  const keys = (result.Contents ?? [])
    .map((item) => item.Key)
    .filter(Boolean)
    .sort();
  if (!keys.length) {
    return null;
  }
  const latestKey = keys[keys.length - 1];
  const ingestId = latestKey.split('/').pop()?.replace('.json', '');
  if (!ingestId) {
    return null;
  }
  return readIngestTrace({ client, project, sourceHash, ingestId });
};

export const hashFileContents = async (readFileFn, path) => {
  const content = await readFileFn(path);
  return sha256(content);
};

export const stemPrefixForTrace = (project, stem) => parsedArtifactPrefix(project, stem);
