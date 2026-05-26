// In-process file processing service. The job runner stays in-process per the current
// architectural constraint; TODO: replace fire-and-forget execution with a durable queue.
import { logAuditEvent } from '../lib/auditEvents.mjs';
import {
  PAPER_READER_SKILL_ID,
  resolvePaperReaderProcessing,
} from '../lib/paperReaderProcessingConfig.mjs';
import { buildPaperqaLitellmRuntime } from '../lib/paperqaRuntime.mjs';
import {
  createProjectProcessJob,
  findFileLogFromJobs,
  getProjectProcessJob,
  listProjectProcessJobs,
  serializeProjectProcessJob,
} from '../lib/projectProcessJobs.mjs';
import { readProcessLogFromStorage } from '../lib/projectFileProcess.mjs';
import { runProjectFileProcessJob } from '../lib/runProjectFileProcessJob.mjs';

export const createProcessingService = ({ config, deps, services }) => {
  const { log } = deps;
  const { llmConfig, agentSkills, wiki } = services;
  const { paperqaLlmTier, paperqaLitellmUrl, paperqaLitellmApiKey, paperqaEmbeddingModel, paperqaIngestWiki } =
    config;

  const loadPaperqaRuntime = async (user) => {
    const tierIndex = Math.max(0, llmConfig.configuredLlmTiers.indexOf(paperqaLlmTier));
    const llmConfigRecord = await llmConfig.loadRunnableLlmConfig(user, {
      id: `openbao-llm-${tierIndex + 1}`,
    });
    const modelAlias = llmConfig.liteLlmModelAlias(user, tierIndex);
    if (!paperqaLitellmApiKey?.trim()) {
      throw Object.assign(
        new Error(
          'LITELLM_API_KEY is not configured on the API. Set it in platform runtime env before processing papers.',
        ),
        { status: 503 },
      );
    }
    const litellmRuntime = buildPaperqaLitellmRuntime({
      llmConfig: llmConfigRecord,
      modelAlias,
      litellmUrl: paperqaLitellmUrl,
      tier: llmConfigRecord.tier ?? llmConfig.defaultTier(tierIndex),
    });
    return {
      llmModel: modelAlias,
      summaryLlmModel: modelAlias,
      embeddingModel: paperqaEmbeddingModel,
      litellmUrl: paperqaLitellmUrl,
      litellmApiKey: paperqaLitellmApiKey,
      litellmRuntime,
    };
  };

  const startProcessJob = async ({ request, project, selected, actor }) => {
    const client = services.projects.requireProjectMinio(project);
    const paperqaRuntime = await loadPaperqaRuntime(request.user);
    const ingestWiki = request.body?.ingestWiki !== false && paperqaIngestWiki;
    const wikiStorage = ingestWiki ? wiki.wikiStorageForProject(project) : null;
    const wikiLlmConfig = ingestWiki ? await wiki.loadWikiLlmConfig(request.user) : null;

    const repoCatalog = agentSkills.loadAgentRepositories();
    const userSkills = await agentSkills.readAgentSkills(request.user);
    const packageSkillIds = new Set(repoCatalog.skills.map((skill) => skill.id));
    const skillsForBindings = [
      ...repoCatalog.skills,
      ...userSkills.filter((skill) => !packageSkillIds.has(skill.id)),
    ];
    const skillBindings = await agentSkills.readProjectAgentSkillBindings(
      request.user,
      project.id,
      skillsForBindings,
    );
    const paperReaderBinding = skillBindings.find(
      (binding) => binding.skillId === PAPER_READER_SKILL_ID && binding.enabled,
    );
    const paperReaderProcessing = await resolvePaperReaderProcessing(paperReaderBinding);

    const job = createProjectProcessJob({
      projectId: project.id,
      userId: actor,
      fileIds: selected.map((file) => file.id),
      fileNames: Object.fromEntries(selected.map((file) => [file.id, file.name])),
    });

    void runProjectFileProcessJob({
      jobId: job.id,
      project,
      client,
      selected,
      paperqaRuntime,
      paperReaderProcessing,
      ingestWiki,
      wikiStorage,
      wikiLlmConfig,
      callLlmChatEndpoint: llmConfig.callLlmChatEndpoint,
      extractLlmAnswer: llmConfig.extractLlmAnswer,
      mirrorLog: (event, payload) => log(event, payload),
    })
      .then(({ processed, failures, wikiPages }) => {
        log('POST /api/projects/:id/files/process complete', {
          projectId: project.id,
          jobId: job.id,
          count: processed.length,
          failureCount: failures.length,
          wikiPageCount: wikiPages.length,
          bucketName: project.bucketName,
        });
        logAuditEvent({
          event: 'project_file.process',
          actor,
          action: 'process',
          resourceType: 'project_file',
          resourceId: project.id,
          outcome: failures.length ? 'partial' : 'success',
          metadata: {
            jobId: job.id,
            count: processed.length,
            failureCount: failures.length,
            wikiPageCount: wikiPages.length,
            bucketName: project.bucketName,
          },
        });
      })
      .catch((error) => {
        log('POST /api/projects/:id/files/process job error', {
          projectId: project.id,
          jobId: job.id,
          error: error instanceof Error ? error.message : 'Processing failed.',
        });
      });

    return { job, paperqaRuntime };
  };

  const listJobs = (projectId, options) => listProjectProcessJobs(projectId, options);
  const getJob = (jobId) => getProjectProcessJob(jobId);
  const serializeJob = (job) => serializeProjectProcessJob(job);
  const findFileLog = (projectId, fileId) => findFileLogFromJobs(projectId, fileId);
  const readProcessLog = (client, project, file) => readProcessLogFromStorage(client, project, file);

  return {
    loadPaperqaRuntime,
    startProcessJob,
    listJobs,
    getJob,
    serializeJob,
    findFileLog,
    readProcessLog,
  };
};
