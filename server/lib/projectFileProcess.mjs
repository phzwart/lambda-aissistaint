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
import { readProjectFileBuffer } from './projectFiles.mjs';
import {
  parsedArtifactPrefix,
  parsedStemFromObjectKey,
  processLogObjectKey,
  processStatusObjectKey,
} from './projectParsedPaths.mjs';

export { parsedArtifactPrefix, parsedStemFromObjectKey, processLogObjectKey } from './projectParsedPaths.mjs';

const OUTPUT_ARTIFACTS = [
  { name: 'extracted.txt', contentType: 'text/plain; charset=utf-8' },
  { name: 'abstract.txt', contentType: 'text/plain; charset=utf-8' },
  { name: 'extraction_metadata.json', contentType: 'application/json' },
  { name: 'summary.md', contentType: 'text/markdown; charset=utf-8' },
  { name: 'summary.json', contentType: 'application/json' },
  { name: 'extended_abstract.md', contentType: 'text/markdown; charset=utf-8' },
  { name: 'follow_up_questions.json', contentType: 'application/json' },
  { name: 'paper_metadata.json', contentType: 'application/json' },
];

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

export const uploadParsedArtifacts = async (client, project, stem, outputDir, { extraFiles = [] } = {}) => {
  const prefix = parsedArtifactPrefix(project, stem);
  const uploaded = {};

  const artifacts = [
    ...OUTPUT_ARTIFACTS,
    ...extraFiles.map((file) => ({ name: file.name, contentType: file.contentType, path: file.path })),
  ];

  for (const artifact of artifacts) {
    const localPath = artifact.path ?? join(outputDir, artifact.name);
    let body;
    try {
      body = await readFile(localPath);
    } catch {
      continue;
    }
    const key = `${prefix}${artifact.name}`;
    await client.send(
      new PutObjectCommand({
        Bucket: project.bucketName,
        Key: key,
        Body: body,
        ContentLength: body.length,
        ContentType: artifact.contentType,
      }),
    );
    uploaded[artifact.name] = key;
  }

  return uploaded;
};

export const processProjectFile = async ({
  client,
  project,
  file,
  paperqaRuntime,
  paperReaderProcessing,
  processLogger,
}) => {
  const stem = parsedStemFromObjectKey(file.objectKey);
  const workDir = await mkdtemp(join(tmpdir(), 'aissistaint-paperqa-'));
  const inputPath = join(workDir, `${stem}.pdf`);
  const skillRuntimePath = join(workDir, 'skill-runtime.json');
  const outputDir = join(workDir, 'output');
  const logPath = join(workDir, 'process.log');
  const minioLogKey = processLogObjectKey(project, stem);

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
      startedAt: new Date().toISOString(),
    });

    await fileLog.append(`Downloading ${file.objectKey} from MinIO`);
    const pdfBuffer = await readProjectFileBuffer(client, project, file.objectKey);
    await fileLog.append(`Downloaded ${(pdfBuffer.length / (1024 * 1024)).toFixed(2)} MB`);

    await writeFile(inputPath, pdfBuffer);
    if (paperReaderProcessing) {
      await writeFile(
        skillRuntimePath,
        `${JSON.stringify(buildSkillRuntimePayload({ file, processing: paperReaderProcessing }), null, 2)}\n`,
        'utf8',
      );
    }
    await mkdir(outputDir, { recursive: true, mode: 0o777 });
    await chmod(workDir, 0o777);
    await chmod(outputDir, 0o777);

    await fileLog.append(
      `Starting PaperQA2 (model=${paperqaRuntime.litellmRuntime?.modelAlias ?? paperqaRuntime.llmModel}, image=${process.env.PAPERQA2_RUNNER_IMAGE ?? 'localhost/aissistaint/paperqa2-paper-reader:latest'})`,
    );

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
      onLogLine: (line) => fileLog.append(line, 'paperqa'),
    });

    await fileLog.append('PaperQA2 finished; uploading artifacts to MinIO');
    await fileLog.flushNow();

    const artifacts = await uploadParsedArtifacts(client, project, stem, outputDir, {
      extraFiles: [{ name: 'process.log', contentType: 'text/plain; charset=utf-8', path: logPath }],
    });
    if (!artifacts['summary.md'] || !artifacts['extracted.txt'] || !artifacts['abstract.txt']) {
      throw Object.assign(
        new Error('PaperQA runner did not produce required summary.md, extracted.txt, and abstract.txt outputs.'),
        { status: 502 },
      );
    }

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
      finishedAt: new Date().toISOString(),
    });

    return {
      file: {
        ...file,
        status: 'completed',
        parsedPrefix: parsedArtifactPrefix(project, stem),
        processLogKey: minioLogKey,
        artifacts,
      },
      summaryText,
      title,
      sourceId: file.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Processing failed.';
    await fileLog.append(message, 'error');
    await fileLog.flushNow();
    await writeProcessingStatus(client, project, stem, {
      status: 'failed',
      fileId: file.id,
      fileName: file.name,
      logKey: minioLogKey,
      error: message,
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
