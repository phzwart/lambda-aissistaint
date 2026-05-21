import { PutObjectCommand } from '@aws-sdk/client-s3';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createMinioBackedProcessLogger,
  flushLocalProcessLogToMinio,
  readProcessLogFromMinio,
} from './processLogStorage.mjs';
import { runPaperqaSummary } from './paperqaRunner.mjs';
import { buildSkillRuntimePayload } from './paperReaderProcessingConfig.mjs';
import {
  PARSED_OUTPUT_ARTIFACTS,
  startParsedArtifactSync,
  syncParsedOutputDir,
} from './parsedArtifactSync.mjs';
import { readProjectFileBuffer } from './projectFiles.mjs';
import {
  parsedArtifactPrefix,
  parsedStemFromObjectKey,
  processLogObjectKey,
  processStatusObjectKey,
} from './projectParsedPaths.mjs';
import { computeSourceHash } from './provenance/sourceHash.mjs';
import {
  extractClaims,
  newIngestId,
  writeIngestManifest,
} from './claims/extractClaims.mjs';
import { IngestTraceBuilder, writeIngestTrace } from './provenance/ingestTrace.mjs';
import { appendIngestIndexEntry } from './provenance/ingestIndex.mjs';

export { parsedArtifactPrefix, parsedStemFromObjectKey, processLogObjectKey } from './projectParsedPaths.mjs';

export const readProcessLogFromStorage = async (client, project, file) => {
  const stem = parsedStemFromObjectKey(file.objectKey);
  return readProcessLogFromMinio(client, project, stem);
};

const writeProcessingStatus = async (client, project, stem, payload) => {
  const key = processStatusObjectKey(project, stem);
  const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
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

export const processProjectFile = async ({
  client,
  project,
  file,
  paperqaRuntime,
  paperReaderProcessing,
  processLogger,
  callLlmChatEndpoint,
  extractLlmAnswer,
}) => {
  const stem = parsedStemFromObjectKey(file.objectKey);
  const workDir = await mkdtemp(join(tmpdir(), 'aissistaint-paperqa-'));
  const inputPath = join(workDir, `${stem}.pdf`);
  const skillRuntimePath = join(workDir, 'skill-runtime.json');
  const outputDir = join(workDir, 'output');
  const logPath = join(workDir, 'process.log');
  const minioLogKey = processLogObjectKey(project, stem);
  const ingestId = newIngestId();
  const startedAt = new Date().toISOString();

  const fileLog = createMinioBackedProcessLogger({
    client,
    project,
    stem,
    logFilePath: logPath,
    onLine: (line) => {
      if (processLogger?.append) {
        void processLogger.append(line);
      }
    },
  });

  try {
    await fileLog.initMinioLog(`Processing started for ${file.name} → ${minioLogKey}`);
    await writeProcessingStatus(client, project, stem, {
      status: 'running',
      fileId: file.id,
      fileName: file.name,
      objectKey: file.objectKey,
      logKey: minioLogKey,
      startedAt,
      ingestId,
    });

    await fileLog.append(`Downloading ${file.objectKey} from MinIO`);
    const pdfBuffer = await readProjectFileBuffer(client, project, file.objectKey);
    const sourceHash = computeSourceHash(pdfBuffer);
    await fileLog.append(`Downloaded ${(pdfBuffer.length / (1024 * 1024)).toFixed(2)} MB (source_hash=${sourceHash.slice(0, 12)}…)`);

    const traceBuilder = new IngestTraceBuilder({
      ingestId,
      sourceHash,
      stem,
      file,
      startedAt,
    });
    traceBuilder.addStage({
      stageId: 'download_pdf',
      inputs: { object_key: file.objectKey },
      outputs: { source_hash: sourceHash, byte_size: pdfBuffer.length },
    });

    await writeFile(inputPath, pdfBuffer);
    const sourceManifest = {
      source_hash: sourceHash,
      file_id: file.id,
      object_key: file.objectKey,
      stem,
      byte_size: pdfBuffer.length,
      sha256_alg: 'sha256',
    };
    await mkdir(outputDir, { recursive: true, mode: 0o777 });
    await writeFile(
      join(outputDir, 'source_manifest.json'),
      `${JSON.stringify(sourceManifest, null, 2)}\n`,
      'utf8',
    );

    if (paperReaderProcessing) {
      await writeFile(
        skillRuntimePath,
        `${JSON.stringify(buildSkillRuntimePayload({ file, processing: paperReaderProcessing }), null, 2)}\n`,
        'utf8',
      );
    }
    await chmod(workDir, 0o777);
    await chmod(outputDir, 0o777);

    await fileLog.append(
      `Starting PaperQA2 (model=${paperqaRuntime.litellmRuntime?.modelAlias ?? paperqaRuntime.llmModel}, image=${process.env.PAPERQA2_RUNNER_IMAGE ?? 'localhost/aissistaint/paperqa2-paper-reader:latest'})`,
    );

    let checkpointKeys = {};
    const artifactSync = startParsedArtifactSync({
      client,
      project,
      stem,
      outputDir,
      logPath,
      onSynced: async (keys) => {
        checkpointKeys = { ...checkpointKeys, ...keys };
        await writeProcessingStatus(client, project, stem, {
          status: 'running',
          fileId: file.id,
          fileName: file.name,
          objectKey: file.objectKey,
          logKey: minioLogKey,
          startedAt,
          ingestId,
          checkpoints: Object.keys(checkpointKeys),
        });
      },
    });

    const paperqaStarted = Date.now();
    try {
      await runPaperqaSummary({
        inputPdfPath: inputPath,
        outputDir,
        llmModel: paperqaRuntime.llmModel,
        summaryLlmModel: paperqaRuntime.summaryLlmModel,
        embeddingModel: paperqaRuntime.embeddingModel,
        litellmUrl: paperqaRuntime.litellmUrl,
        litellmApiKey: paperqaRuntime.litellmApiKey,
        litellmRuntime: paperqaRuntime.litellmRuntime,
        skillRuntimePath: paperReaderProcessing ? skillRuntimePath : undefined,
        paperId: file.id,
        citationLabel: stem,
        sourceHash,
        onLogLine: (line) => fileLog.append(line, 'paperqa'),
      });
    } finally {
      artifactSync.stop();
      await artifactSync.flush();
      await fileLog.flushNow();
    }

    traceBuilder.addStage({
      stageId: 'paperqa_extract',
      durationMs: Date.now() - paperqaStarted,
      outputs: {
        extracted_txt: await readFile(join(outputDir, 'extracted.txt'), 'utf8').catch(() => ''),
        source_spans_jsonl: await readFile(join(outputDir, 'source_spans.jsonl'), 'utf8').catch(() => ''),
      },
    });

    await fileLog.append('PaperQA2 finished; extracting claims');
    const tier = paperqaRuntime.litellmRuntime?.tier ?? 'a';
    const modelAlias = paperqaRuntime.litellmRuntime?.modelAlias ?? paperqaRuntime.llmModel;
    const claimStarted = Date.now();
    await extractClaims({
      outputDir,
      sourceHash,
      ingestId,
      tier,
      callLlmChatEndpoint,
      extractLlmAnswer,
      modelAlias,
      traceBuilder,
    });
    traceBuilder.addStage({
      stageId: 'claim_extract',
      durationMs: Date.now() - claimStarted,
      outputs: {
        claims_jsonl: await readFile(join(outputDir, 'claims.jsonl'), 'utf8').catch(() => ''),
      },
    });

    const finishedAt = new Date().toISOString();
    await writeIngestManifest({
      outputDir,
      ingestId,
      sourceHash,
      stem,
      startedAt,
      finishedAt,
      extractionSteps: [
        'download_pdf',
        'extract_pdf',
        'paperqa_summary',
        'claim_extract_llm',
        'claim_extract_heuristic',
      ],
    });

    await fileLog.append('Uploading artifacts to MinIO');
    const { artifactKeys: artifacts } = await syncParsedOutputDir({
      client,
      project,
      stem,
      outputDir,
      extraFiles: [{ name: 'process.log', contentType: 'text/plain; charset=utf-8', path: logPath }],
    });
    if (!artifacts['summary.md'] || !artifacts['extracted.txt'] || !artifacts['abstract.txt']) {
      throw Object.assign(
        new Error('PaperQA runner did not produce required summary.md, extracted.txt, and abstract.txt outputs.'),
        { status: 502 },
      );
    }

    traceBuilder.addStage({
      stageId: 'minio_sync',
      outputs: { artifact_keys: Object.keys(artifacts) },
    });
    const trace = traceBuilder.build({ finishedAt });
    await writeIngestTrace({ client, project, trace });
    await appendIngestIndexEntry({
      client,
      project,
      sourceHash,
      entry: {
        ingest_id: ingestId,
        stem,
        finished_at: finishedAt,
        claims_key: artifacts['claims.jsonl'] ?? null,
      },
    });

    const summaryText = await readFile(join(outputDir, 'summary.md'), 'utf8');
    let title = file.name;
    try {
      const metadata = JSON.parse(await readFile(join(outputDir, 'extraction_metadata.json'), 'utf8'));
      if (metadata?.title) {
        title = String(metadata.title);
      }
    } catch {
      // optional metadata
    }

    await fileLog.append(`Artifacts stored under ${parsedArtifactPrefix(project, stem)}`);
    await fileLog.flushNow();
    await writeProcessingStatus(client, project, stem, {
      status: 'completed',
      fileId: file.id,
      fileName: file.name,
      logKey: minioLogKey,
      ingestId,
      sourceHash,
      finishedAt,
    });

    return {
      file: {
        ...file,
        status: 'completed',
        parsedPrefix: parsedArtifactPrefix(project, stem),
        processLogKey: minioLogKey,
        artifacts,
        sourceHash,
        ingestId,
      },
      summaryText,
      title,
      sourceId: file.id,
      sourceHash,
      ingestId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Processing failed.';
    await fileLog.append(message, 'error');
    await fileLog.flushNow();

    let partialArtifacts = {};
    try {
      const partial = await syncParsedOutputDir({
        client,
        project,
        stem,
        outputDir,
        extraFiles: [{ name: 'process.log', contentType: 'text/plain; charset=utf-8', path: logPath }],
      });
      partialArtifacts = partial.artifactKeys;
      const saved = Object.keys(partialArtifacts);
      if (saved.length > 0) {
        await fileLog.append(`Checkpoint artifacts preserved in MinIO: ${saved.join(', ')}`);
        await fileLog.flushNow();
      }
    } catch {
      // best-effort partial upload
    }

    await writeProcessingStatus(client, project, stem, {
      status: 'failed',
      fileId: file.id,
      fileName: file.name,
      logKey: minioLogKey,
      error: message,
      partial: Object.keys(partialArtifacts).length > 0,
      artifacts: partialArtifacts,
      finishedAt: new Date().toISOString(),
    });
    throw error;
  } finally {
    fileLog.cancelScheduledFlush();
    await fileLog.waitForPendingFlush();
    try {
      await flushLocalProcessLogToMinio(client, project, stem, logPath);
    } catch {
      // best-effort final flush before temp dir is removed
    }
    await rm(workDir, { recursive: true, force: true });
  }
};
