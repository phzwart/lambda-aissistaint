import { PutObjectCommand } from '@aws-sdk/client-s3';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parsedArtifactPrefix } from './projectParsedPaths.mjs';

export const FIGURES_MANIFEST_NAME = 'figures_manifest.json';

export const PARSED_OUTPUT_ARTIFACTS = [
  { name: 'extracted.txt', contentType: 'text/plain; charset=utf-8' },
  { name: 'abstract.txt', contentType: 'text/plain; charset=utf-8' },
  { name: 'extraction_metadata.json', contentType: 'application/json' },
  { name: FIGURES_MANIFEST_NAME, contentType: 'application/json' },
  { name: 'summary.md', contentType: 'text/markdown; charset=utf-8' },
  { name: 'summary.json', contentType: 'application/json' },
  { name: 'extended_abstract.md', contentType: 'text/markdown; charset=utf-8' },
  { name: 'follow_up_questions.json', contentType: 'application/json' },
  { name: 'knowledge_graph.json', contentType: 'application/json' },
  { name: 'paper_metadata.json', contentType: 'application/json' },
  { name: 'source_manifest.json', contentType: 'application/json' },
  { name: 'source_spans.jsonl', contentType: 'application/x-ndjson' },
  { name: 'paperqa_evidence.json', contentType: 'application/json' },
  { name: 'llm_calls.jsonl', contentType: 'application/x-ndjson' },
  { name: 'claims.jsonl', contentType: 'application/x-ndjson' },
  { name: 'ingest_manifest.json', contentType: 'application/json' },
  { name: 'provenance_dag.json', contentType: 'application/json' },
];

export const isFigureArtifactName = (name) => /^figures\/[a-zA-Z0-9_.-]+\.png$/.test(name);

const listFigureArtifacts = async (outputDir) => {
  const figuresDir = join(outputDir, 'figures');
  try {
    const names = await readdir(figuresDir);
    return names
      .filter((name) => name.toLowerCase().endsWith('.png'))
      .sort()
      .map((name) => ({
        name: `figures/${name}`,
        contentType: 'image/png',
        path: join(figuresDir, name),
      }));
  } catch {
    return [];
  }
};

const fileSignature = async (filePath) => {
  try {
    const info = await stat(filePath);
    return `${info.size}:${info.mtimeMs}`;
  } catch {
    return null;
  }
};

/**
 * Upload any output artifacts that exist locally and changed since last sync.
 */
export const syncParsedOutputDir = async ({
  client,
  project,
  stem,
  outputDir,
  extraFiles = [],
  uploaded = new Map(),
}) => {
  const prefix = parsedArtifactPrefix(project, stem);
  const synced = { ...Object.fromEntries(uploaded) };

  const figureArtifacts = await listFigureArtifacts(outputDir);
  const artifacts = [
    ...PARSED_OUTPUT_ARTIFACTS,
    ...figureArtifacts,
    ...extraFiles.map((file) => ({ name: file.name, contentType: file.contentType, path: file.path })),
  ];

  for (const artifact of artifacts) {
    const localPath = artifact.path ?? join(outputDir, artifact.name);
    const signature = await fileSignature(localPath);
    if (!signature || uploaded.get(artifact.name) === signature) {
      continue;
    }
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
    uploaded.set(artifact.name, signature);
    synced[artifact.name] = key;
  }

  return { uploadedKeys: uploaded, artifactKeys: synced };
};

export const startParsedArtifactSync = ({
  client,
  project,
  stem,
  outputDir,
  logPath,
  intervalMs = Number.parseInt(process.env.PROJECT_PROCESS_ARTIFACT_SYNC_MS ?? '10000', 10) || 10_000,
  onSynced,
}) => {
  const uploaded = new Map();
  const extraFiles = logPath
    ? [{ name: 'process.log', contentType: 'text/plain; charset=utf-8', path: logPath }]
    : [];

  const tick = async () => {
    try {
      const result = await syncParsedOutputDir({
        client,
        project,
        stem,
        outputDir,
        extraFiles,
        uploaded,
      });
      if (onSynced && Object.keys(result.artifactKeys).length > 0) {
        await onSynced(result.artifactKeys);
      }
    } catch {
      // best-effort checkpoint; next tick may succeed
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    flush: tick,
    stop: () => {
      clearInterval(timer);
    },
  };
};

export const artifactExists = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};
