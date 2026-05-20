import { createProcessLogger } from './processLog.mjs';
import { processProjectFile, parsedArtifactPrefix } from './projectFileProcess.mjs';
import {
  appendProjectProcessJobLog,
  completeProjectProcessJob,
  failProjectProcessJob,
  setProjectProcessFileLogStatus,
  setProjectProcessJobFile,
} from './projectProcessJobs.mjs';
import { ingestDocument as wikiIngestDocument } from './wiki/ingest.mjs';

export const runProjectFileProcessJob = async ({
  jobId,
  project,
  client,
  selected,
  paperqaRuntime,
  paperReaderProcessing,
  ingestWiki,
  wikiStorage,
  wikiLlmConfig,
  callLlmChatEndpoint,
  extractLlmAnswer,
  mirrorLog,
}) => {
  const jobLog = async (message, level = 'info') => {
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    appendProjectProcessJobLog(jobId, line, { mirrorLog });
  };

  const processed = [];
  const wikiPages = [];
  const failures = [];

  try {
    await jobLog(
      `Job started for ${selected.length} file(s). LiteLLM alias=${paperqaRuntime.litellmRuntime.modelAlias} url=${paperqaRuntime.litellmRuntime.litellmUrl}`,
    );

    for (const [index, file] of selected.entries()) {
      setProjectProcessJobFile(jobId, { fileId: file.id, fileName: file.name });
      await jobLog(`[${index + 1}/${selected.length}] Processing ${file.name} (${file.id})`);

      const processLogger = {
        append: async (line) => {
          appendProjectProcessJobLog(jobId, line, { mirrorLog });
        },
      };

      try {
        const result = await processProjectFile({
          client,
          project,
          file,
          paperqaRuntime,
          paperReaderProcessing,
          processLogger,
        });
        processed.push(result.file);
        setProjectProcessFileLogStatus(jobId, file.id, 'completed');
        await jobLog(`[${index + 1}/${selected.length}] Completed ${file.name}`);

        if (ingestWiki && wikiStorage && result.summaryText?.trim()) {
          await jobLog(`[${index + 1}/${selected.length}] Ingesting summary into wiki…`);
          const ingestResult = await wikiIngestDocument({
            storage: wikiStorage,
            document: {
              sourceId: result.sourceId,
              title: result.title,
              text: result.summaryText,
              suggestedCategory: 'concepts',
              category: 'concepts',
            },
            llmConfig: wikiLlmConfig,
            callLlmChatEndpoint,
            extractLlmAnswer,
            logger: (message, meta) => {
              void jobLog(`wiki: ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`);
            },
          });
          wikiPages.push({
            fileId: file.id,
            pageKey: ingestResult.pageKey,
            title: ingestResult.suggestion?.title ?? result.title,
          });
          await jobLog(`[${index + 1}/${selected.length}] Wiki page ${ingestResult.pageKey}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Processing failed.';
        await jobLog(`[${index + 1}/${selected.length}] Failed ${file.name}: ${message}`, 'error');
        failures.push({
          fileId: file.id,
          name: file.name,
          error: message,
        });
        setProjectProcessFileLogStatus(jobId, file.id, 'failed');
        processed.push({ ...file, status: 'failed' });
      }
    }

    completeProjectProcessJob(jobId, { files: processed, failures, wikiPages });
    await jobLog(
      `Job finished. completed=${processed.filter((f) => f.status === 'completed').length} failed=${failures.length}`,
    );
    return { processed, failures, wikiPages };
  } catch (error) {
    failProjectProcessJob(jobId, error);
    await jobLog(`Job aborted: ${error instanceof Error ? error.message : error}`, 'error');
    throw error;
  }
};
