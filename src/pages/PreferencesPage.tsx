import { FormEvent, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { appConfig } from '../config/env';
import { agentSkillService, createEmptyAgentSkill, defaultAgentSkillExecutable } from '../services/agentSkillService';
import { llmConfigService } from '../services/llmConfigService';
import { plannerConfigService } from '../services/plannerConfigService';
import { projectService } from '../services/projectService';
import { useWorkflowStore } from '../state/workflowStore';
import type {
  AgentExecutorCatalogItem,
  AgentSkill,
  AgentSkillExecutable,
  ConnectionStatus,
  LlmConfig,
  LlmTier,
  PlannerConfig,
  PlannerModelAlias,
  PlannerSpec,
  Project,
  ProjectAgentSkillBinding,
} from '../types/domain';

const tierLabels: Record<LlmTier, string> = {
  a: 'A',
  b: 'B',
  c: 'C',
};

const statusStyles: Record<ConnectionStatus, { background: string; color: string }> = {
  idle: { background: '#eef2f6', color: '#475467' },
  testing: { background: '#eaf2fb', color: '#1f4e79' },
  success: { background: '#eaf8ef', color: '#1f7a3f' },
  error: { background: '#fdecec', color: '#9f1d1d' },
};

const createConfig = (index = 0): LlmConfig => ({
  id: crypto.randomUUID(),
  name: `LLM_${(appConfig.llmTiers[index] ?? 'a').toUpperCase()}`,
  endpoint: '',
  model: '',
  token: '',
  tier: appConfig.llmTiers[index] ?? 'a',
  status: 'idle',
});

const normalizeConfigs = (configs: LlmConfig[]) =>
  Array.from({ length: appConfig.llmEndpointCount }, (_, index) => ({
    ...createConfig(index),
    ...(configs[index] ?? {}),
    name: `LLM_${(appConfig.llmTiers[index] ?? 'a').toUpperCase()}`,
    tier: appConfig.llmTiers[index] ?? 'a',
    model: configs[index]?.model ?? '',
  }));

const linesToList = (value: string) =>
  value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

const listToLines = (values: string[]) => values.join('\n');

const createBinding = (skill: AgentSkill, index: number): ProjectAgentSkillBinding => ({
  skillId: skill.id,
  enabled: false,
  priority: index + 1,
  notes: '',
});

const createPlannerConfig = (spec?: PlannerSpec, aliases: PlannerModelAlias[] = []): PlannerConfig => {
  const fallbackAlias = aliases[0]?.alias ?? 'LLM_A';
  return {
    specId: spec?.id ?? '',
    roleBindings: Object.fromEntries((spec?.modelRoles ?? ['planner', 'worker', 'summarizer']).map((role) => [role, fallbackAlias])),
    contextPolicy: {
      strategy: spec?.defaultContext.strategy ?? 'summarize',
      maxTurns: spec?.defaultContext.maxTurns ?? 50,
      subagentMaxTurns: spec?.defaultContext.subagentMaxTurns ?? 25,
    },
    skillPolicy: {
      visibility: spec?.skillPolicy.defaultVisibility ?? 'project-enabled',
      allowedSkillIds: spec?.skillPolicy.allowedSkillIds ?? [],
      allowedCategories: spec?.skillPolicy.allowedCategories ?? [],
    },
    workspaceMode: 'project-workspace',
  };
};

const isRepositorySkill = (skill: AgentSkill) => skill.source === 'package' || skill.editable === false;

const slugifySkillName = (value: string, fallback = 'agent-skill') => {
  const slug = (value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || fallback;
};

const buildSkillMarkdownPreview = (skill: AgentSkill) => {
  const directoryName = slugifySkillName(skill.name, skill.id);
  const description = `${skill.purpose || `${skill.name || directoryName} agent skill.`}${
    skill.whenToUse ? ` Use when ${skill.whenToUse.replace(/\.$/, '')}.` : ''
  }`
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1024);
  const listSection = (title: string, values: string[]) => (values.length ? `\n## ${title}\n\n${values.map((value) => `- ${value}`).join('\n')}\n` : '');
  const executableSection =
    skill.executable.mode === 'none'
      ? ''
      : `\n## Executable\n\nMode: ${skill.executable.mode}\n${
          skill.executable.catalogId ? `Catalog id: ${skill.executable.catalogId}\n` : ''
        }${skill.executable.image ? `Container image: ${skill.executable.image}\n` : ''}${
          skill.executable.command ? `Command: \`${[skill.executable.command, ...skill.executable.args].join(' ')}\`\n` : ''
        }Timeout: ${skill.executable.timeoutSeconds} seconds\nNetwork: ${skill.executable.network}\n`;

  return {
    directoryName,
    skillMd: `---
name: ${directoryName}
description: ${JSON.stringify(description)}
disable-model-invocation: true
---

# ${skill.name || directoryName}

## Purpose

${skill.purpose || 'Describe what this skill does.'}

## When To Use

${skill.whenToUse || 'Describe when the agent should use this skill.'}
${listSection('Inputs', skill.inputs)}
## Procedure

${skill.procedure || 'Describe the steps the agent should follow.'}

## Expected Output

${skill.expectedOutput || 'Describe the expected output.'}

## Safety Constraints

${skill.safetyConstraints || 'Follow project safety and data handling requirements.'}
${listSection('Required Tools', skill.requiredTools)}${executableSection}`,
  };
};

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
}

interface ActivityLogEntry {
  id: string;
  level: 'info' | 'success' | 'error';
  message: string;
  timestamp: string;
}

export function PreferencesPage() {
  const [activeSetupTab, setActiveSetupTab] = useState<'llm' | 'agent' | 'planner' | 'project'>('llm');
  const [configs, setConfigs] = useState<LlmConfig[]>([]);
  const [activeConfigId, setActiveConfigId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isRetrieving, setIsRetrieving] = useState(false);
  const [banner, setBanner] = useState<{ severity: 'success' | 'info' | 'error'; message: string } | null>(null);
  const [selectedChatConfigId, setSelectedChatConfigId] = useState('');
  const [chatQuestion, setChatQuestion] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const projects = useWorkflowStore((state) => state.projects);
  const activeProject = useWorkflowStore((state) => state.activeProject);
  const setProjects = useWorkflowStore((state) => state.setProjects);
  const setActiveProjectId = useWorkflowStore((state) => state.setActiveProjectId);
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [agentSkills, setAgentSkills] = useState<AgentSkill[]>([]);
  const [activeSkillId, setActiveSkillId] = useState('');
  const [skillDraft, setSkillDraft] = useState<AgentSkill>(createEmptyAgentSkill);
  const [executorCatalog, setExecutorCatalog] = useState<AgentExecutorCatalogItem[]>([]);
  const [projectSkillBindings, setProjectSkillBindings] = useState<ProjectAgentSkillBinding[]>([]);
  const [isLoadingAgentSkills, setIsLoadingAgentSkills] = useState(false);
  const [isSavingAgentSkill, setIsSavingAgentSkill] = useState(false);
  const [isSavingSkillBindings, setIsSavingSkillBindings] = useState(false);
  const [plannerSpecs, setPlannerSpecs] = useState<PlannerSpec[]>([]);
  const [plannerModelAliases, setPlannerModelAliases] = useState<PlannerModelAlias[]>([]);
  const [plannerDefaultDraft, setPlannerDefaultDraft] = useState<PlannerConfig>(createPlannerConfig);
  const [plannerProjectDraft, setPlannerProjectDraft] = useState<PlannerConfig>(createPlannerConfig);
  const [isLoadingPlanner, setIsLoadingPlanner] = useState(false);
  const [isSavingPlanner, setIsSavingPlanner] = useState(false);
  const [plannerValidation, setPlannerValidation] = useState<{ ok: boolean; message: string; restartRequired: boolean; restartRequiredKeys: string[] } | null>(
    null,
  );
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: crypto.randomUUID(),
      role: 'system',
      text: 'Use this test chat to verify an LLM configuration before saving it into the workflow.',
    },
  ]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([
    {
      id: crypto.randomUUID(),
      level: 'info',
      message: appConfig.useMockServices
        ? 'Mock services are enabled. Backend/LiteLLM calls are simulated in the browser.'
        : 'Real services are enabled. Provider keys are stored encrypted and inference goes through LiteLLM.',
      timestamp: new Date().toISOString(),
    },
  ]);

  const addActivity = (message: string, level: ActivityLogEntry['level'] = 'info') => {
    setActivityLog((current) => [
      {
        id: crypto.randomUUID(),
        level,
        message,
        timestamp: new Date().toISOString(),
      },
      ...current,
    ].slice(0, 20));
  };

  useEffect(() => {
    void llmConfigService.list().then((loadedConfigs) => {
      const normalizedConfigs = normalizeConfigs(loadedConfigs);
      setConfigs(normalizedConfigs);
      setActiveConfigId(normalizedConfigs[0]?.id ?? '');
      setSelectedChatConfigId(normalizedConfigs[0]?.id ?? '');
    });
  }, []);

  useEffect(() => {
    setIsLoadingProjects(true);
    void projectService
      .list()
      .then((loadedProjects) => {
        setProjects(loadedProjects);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Failed to load projects.';
        setBanner({ severity: 'error', message });
      })
      .finally(() => setIsLoadingProjects(false));
  }, []);

  useEffect(() => {
    setIsLoadingAgentSkills(true);
    void Promise.all([agentSkillService.list(activeProject?.id), agentSkillService.listExecutors()])
      .then(([loaded, executors]) => {
        setExecutorCatalog(executors);
        setAgentSkills(loaded.skills);
        setProjectSkillBindings(
          loaded.skills.map((skill, index) => loaded.bindings.find((binding) => binding.skillId === skill.id) ?? createBinding(skill, index)),
        );
        const selectedSkill = loaded.skills.find((skill) => skill.id === activeSkillId) ?? loaded.skills[0] ?? createEmptyAgentSkill();
        setActiveSkillId(selectedSkill.id);
        setSkillDraft(selectedSkill);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Failed to load agent skills.';
        setBanner({ severity: 'error', message });
      })
      .finally(() => setIsLoadingAgentSkills(false));
  }, [activeProject?.id]);

  useEffect(() => {
    setIsLoadingPlanner(true);
    void Promise.all([plannerConfigService.listSpecs(), plannerConfigService.getConfig(activeProject?.id)])
      .then(([specCatalog, configResponse]) => {
        setPlannerSpecs(specCatalog.specs);
        setPlannerModelAliases(configResponse.modelAliases);
        const selectedSpec = configResponse.spec ?? specCatalog.specs[0];
        setPlannerDefaultDraft(configResponse.globalConfig ?? createPlannerConfig(selectedSpec, configResponse.modelAliases));
        setPlannerProjectDraft(configResponse.projectConfig ?? configResponse.config ?? createPlannerConfig(selectedSpec, configResponse.modelAliases));
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Failed to load planner setup.';
        setBanner({ severity: 'error', message });
      })
      .finally(() => setIsLoadingPlanner(false));
  }, [activeProject?.id]);

  const activeConfig = configs.find((config) => config.id === activeConfigId) ?? configs[0];
  const activeConfigIndex = activeConfig ? configs.findIndex((config) => config.id === activeConfig.id) : -1;

  const updateConfig = (id: string, patch: Partial<LlmConfig>) => {
    setConfigs((current) =>
      current.map((config) =>
        config.id === id
          ? {
              ...config,
              ...patch,
              status: patch.status ?? 'idle',
              message: patch.message,
            }
          : config,
      ),
    );
  };

  const testConnection = async (config: LlmConfig) => {
    addActivity(`Testing connection for ${config.name || config.id}.`);
    updateConfig(config.id, { status: 'testing', message: 'Testing LiteLLM model...' });
    const result = await llmConfigService.testConnection(config);
    updateConfig(config.id, result);
    addActivity(result.message ?? 'Connection test completed.', result.status === 'success' ? 'success' : 'error');
  };

  const saveConfiguration = async () => {
    setIsSaving(true);
    addActivity('Saving LiteLLM provider configuration through the backend secret-store proxy.');

    try {
      const saved = await llmConfigService.save(normalizeConfigs(configs));
      setConfigs(saved);
      setBanner({
        severity: 'success',
        message: appConfig.useMockServices ? 'Configuration saved in mock storage.' : 'Configuration saved to encrypted secret storage and LiteLLM.',
      });
      addActivity(`Saved ${saved.length} LiteLLM model configuration(s).`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save configuration.';
      setBanner({ severity: 'error', message });
      addActivity(message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const clearSecrets = async () => {
    setIsSaving(true);
    addActivity('Clearing stored provider keys through backend secret storage.');

    try {
      await llmConfigService.clearSecrets();
      const sanitized = normalizeConfigs(await llmConfigService.list());
      setConfigs(sanitized);
      setBanner({
        severity: 'info',
        message: appConfig.useMockServices ? 'Stored mock secrets were cleared.' : 'Stored provider keys were cleared.',
      });
      addActivity('Stored provider keys were cleared.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to clear stored secrets.';
      setBanner({ severity: 'error', message });
      addActivity(message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const retrieveConfiguration = async () => {
    setIsRetrieving(true);
    addActivity('Retrieving LiteLLM configuration metadata from backend secret storage.');

    try {
      const retrievedConfigs = normalizeConfigs(await llmConfigService.retrieveConfiguration());
      setConfigs(retrievedConfigs);
      setActiveConfigId((current) => retrievedConfigs.find((config) => config.id === current)?.id ?? retrievedConfigs[0]?.id ?? '');
      setSelectedChatConfigId(
        (current) => retrievedConfigs.find((config) => config.id === current)?.id ?? retrievedConfigs[0]?.id ?? '',
      );
      setBanner({
        severity: 'success',
        message: 'Retrieved configuration metadata from secret storage.',
      });
      addActivity(`Retrieved ${retrievedConfigs.length} LiteLLM metadata record(s).`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retrieve configuration metadata.';
      setBanner({ severity: 'error', message });
      addActivity(message, 'error');
    } finally {
      setIsRetrieving(false);
    }
  };

  const sendChatQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const selectedConfig = configs.find((config) => config.id === selectedChatConfigId);
    const trimmedQuestion = chatQuestion.trim();

    if (!selectedConfig || !trimmedQuestion) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: trimmedQuestion,
    };

    setChatMessages((current) => [...current, userMessage]);
    setChatQuestion('');
    setIsChatting(true);
    addActivity(`Sending test chat question to ${selectedConfig.name || selectedConfig.id}.`);

    try {
      const answer = await llmConfigService.askTestQuestion(selectedConfig, trimmedQuestion);
      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: answer,
        },
      ]);
      addActivity('Received test chat response.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The test chat failed.';
      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'system',
          text: message,
        },
      ]);
      addActivity(message, 'error');
    } finally {
      setIsChatting(false);
    }
  };

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = projectName.trim();
    const description = projectDescription.trim();
    if (!name) {
      setBanner({ severity: 'error', message: 'Project name is required.' });
      return;
    }

    setIsSavingProject(true);
    try {
      const project = await projectService.create({ name, description });
      setProjects([project, ...projects]);
      setActiveProjectId(project.id);
      setProjectName('');
      setProjectDescription('');
      setBanner({ severity: 'success', message: `Project "${project.name}" created.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create project.';
      setBanner({ severity: 'error', message });
    } finally {
      setIsSavingProject(false);
    }
  };

  const saveActiveProject = async () => {
    if (!activeProject) {
      return;
    }

    setIsSavingProject(true);
    try {
      const project = await projectService.update(activeProject.id, {
        name: activeProject.name,
        description: activeProject.description,
        status: activeProject.status,
      });
      setProjects(projects.map((item) => (item.id === project.id ? project : item)));
      setBanner({ severity: 'success', message: `Project "${project.name}" saved.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save project.';
      setBanner({ severity: 'error', message });
    } finally {
      setIsSavingProject(false);
    }
  };

  const deleteActiveProject = async () => {
    if (!activeProject) {
      return;
    }

    const confirmed = window.confirm(
      `Delete project "${activeProject.name}" from the database?\n\nThe MinIO bucket will be kept for administrators or removal-agents, but it will no longer appear in the project list.`,
    );
    if (!confirmed) {
      return;
    }

    setIsDeletingProject(true);
    try {
      await projectService.delete(activeProject.id);
      const remainingProjects = projects.filter((project) => project.id !== activeProject.id);
      setProjects(remainingProjects);
      setActiveProjectId(remainingProjects[0]?.id ?? '');
      setBanner({
        severity: 'success',
        message: `Project "${activeProject.name}" deleted from the database. Its MinIO bucket was retained.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete project.';
      setBanner({ severity: 'error', message });
    } finally {
      setIsDeletingProject(false);
    }
  };

  const updateActiveProject = (patch: Partial<Project>) => {
    if (!activeProject) {
      return;
    }

    setProjects(
      projects.map((project) =>
        project.id === activeProject.id
          ? {
              ...project,
              ...patch,
            }
          : project,
      ),
    );
  };

  const selectSkill = (skill: AgentSkill) => {
    setActiveSkillId(skill.id);
    setSkillDraft(skill);
  };

  const createSkill = () => {
    const skill = createEmptyAgentSkill();
    setAgentSkills((current) => [skill, ...current]);
    setProjectSkillBindings((current) => [createBinding(skill, 0), ...current.map((binding) => ({ ...binding, priority: binding.priority + 1 }))]);
    selectSkill(skill);
  };

  const updateSkillDraft = (patch: Partial<AgentSkill>) => {
    setSkillDraft((current) => ({
      ...current,
      ...patch,
    }));
  };

  const updateSkillExecutable = (patch: Partial<AgentSkillExecutable>) => {
    setSkillDraft((current) => ({
      ...current,
      executable: {
        ...current.executable,
        ...patch,
      },
    }));
  };

  const saveSkill = async () => {
    if (isRepositorySkill(skillDraft)) {
      setBanner({ severity: 'error', message: 'Repository skills are read-only. Duplicate the skill before editing it.' });
      return;
    }

    setIsSavingAgentSkill(true);
    try {
      const saved = await agentSkillService.save(skillDraft);
      setAgentSkills((current) =>
        current.some((skill) => skill.id === saved.id)
          ? current.map((skill) => (skill.id === saved.id ? saved : skill))
          : [saved, ...current],
      );
      setSkillDraft(saved);
      setActiveSkillId(saved.id);
      setProjectSkillBindings((current) =>
        current.some((binding) => binding.skillId === saved.id) ? current : [createBinding(saved, current.length), ...current],
      );
      setBanner({ severity: 'success', message: `Skill "${saved.name || 'Untitled skill'}" saved.` });
      addActivity(`Saved agent skill "${saved.name || saved.id}".`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save agent skill.';
      setBanner({ severity: 'error', message });
      addActivity(message, 'error');
    } finally {
      setIsSavingAgentSkill(false);
    }
  };

  const duplicateSkill = async () => {
    if (!isRepositorySkill(skillDraft)) {
      return;
    }

    setIsSavingAgentSkill(true);
    try {
      const now = new Date().toISOString();
      const copy: AgentSkill = {
        ...skillDraft,
        id: crypto.randomUUID(),
        name: `${skillDraft.name || 'Repository skill'} Copy`,
        status: 'draft',
        source: 'user',
        editable: true,
        origin: undefined,
        createdAt: now,
        updatedAt: now,
      };
      const saved = await agentSkillService.save(copy);
      setAgentSkills((current) => [saved, ...current]);
      setProjectSkillBindings((current) => [createBinding(saved, current.length), ...current]);
      selectSkill(saved);
      setBanner({ severity: 'success', message: `Duplicated "${skillDraft.name || 'repository skill'}" into My Skills.` });
      addActivity(`Duplicated repository skill "${skillDraft.name || skillDraft.id}".`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to duplicate repository skill.';
      setBanner({ severity: 'error', message });
      addActivity(message, 'error');
    } finally {
      setIsSavingAgentSkill(false);
    }
  };

  const deleteSkill = async () => {
    if (!skillDraft.id) {
      return;
    }
    if (isRepositorySkill(skillDraft)) {
      setBanner({ severity: 'error', message: 'Repository skills are read-only and cannot be deleted.' });
      return;
    }
    const confirmed = window.confirm(`Delete skill "${skillDraft.name || skillDraft.id}"?`);
    if (!confirmed) {
      return;
    }

    setIsSavingAgentSkill(true);
    try {
      await agentSkillService.delete(skillDraft.id);
      const remaining = agentSkills.filter((skill) => skill.id !== skillDraft.id);
      setAgentSkills(remaining);
      setProjectSkillBindings((current) => current.filter((binding) => binding.skillId !== skillDraft.id));
      const nextSkill = remaining[0] ?? createEmptyAgentSkill();
      selectSkill(nextSkill);
      setBanner({ severity: 'info', message: 'Agent skill deleted.' });
      addActivity('Deleted agent skill.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete agent skill.';
      setBanner({ severity: 'error', message });
      addActivity(message, 'error');
    } finally {
      setIsSavingAgentSkill(false);
    }
  };

  const updateProjectSkillBinding = (skillId: string, patch: Partial<ProjectAgentSkillBinding>) => {
    setProjectSkillBindings((current) =>
      current.map((binding) =>
        binding.skillId === skillId
          ? {
              ...binding,
              ...patch,
            }
          : binding,
      ),
    );
  };

  const skillPackagePreview = skillDraft.skillPackage?.skillMd
    ? skillDraft.skillPackage
    : {
        ...buildSkillMarkdownPreview(skillDraft),
        files: [],
      };
  const repositorySkills = agentSkills.filter(isRepositorySkill);
  const userSkills = agentSkills.filter((skill) => !isRepositorySkill(skill));
  const activeSkillIsRepositorySkill = isRepositorySkill(skillDraft);

  const saveProjectSkillBindings = async () => {
    if (!activeProject) {
      setBanner({ severity: 'error', message: 'Choose an active project before enabling skills.' });
      return;
    }

    setIsSavingSkillBindings(true);
    try {
      const saved = await agentSkillService.saveProjectBindings(activeProject.id, projectSkillBindings);
      setProjectSkillBindings(saved);
      setBanner({ severity: 'success', message: `Saved skill enablement for "${activeProject.name}".` });
      addActivity(`Saved ${saved.filter((binding) => binding.enabled).length} enabled project skill(s).`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save project skill bindings.';
      setBanner({ severity: 'error', message });
      addActivity(message, 'error');
    } finally {
      setIsSavingSkillBindings(false);
    }
  };

  const plannerDefaultSpec = plannerSpecs.find((spec) => spec.id === plannerDefaultDraft.specId) ?? plannerSpecs[0];
  const plannerProjectSpec = plannerSpecs.find((spec) => spec.id === plannerProjectDraft.specId) ?? plannerDefaultSpec;
  const enabledSkillIds = projectSkillBindings.filter((binding) => binding.enabled).map((binding) => binding.skillId);

  const updatePlannerDefaultDraft = (patch: Partial<PlannerConfig>) => {
    setPlannerDefaultDraft((current) => ({ ...current, ...patch }));
  };

  const updatePlannerProjectDraft = (patch: Partial<PlannerConfig>) => {
    setPlannerProjectDraft((current) => ({ ...current, ...patch }));
  };

  const updatePlannerRoleBinding = (scope: 'default' | 'project', role: string, alias: string) => {
    const update = scope === 'default' ? setPlannerDefaultDraft : setPlannerProjectDraft;
    update((current) => ({
      ...current,
      roleBindings: {
        ...current.roleBindings,
        [role]: alias,
      },
    }));
  };

  const updatePlannerContext = (scope: 'default' | 'project', patch: Partial<PlannerConfig['contextPolicy']>) => {
    const update = scope === 'default' ? setPlannerDefaultDraft : setPlannerProjectDraft;
    update((current) => ({
      ...current,
      contextPolicy: {
        ...current.contextPolicy,
        ...patch,
      },
    }));
  };

  const updatePlannerSkillPolicy = (scope: 'default' | 'project', patch: Partial<PlannerConfig['skillPolicy']>) => {
    const update = scope === 'default' ? setPlannerDefaultDraft : setPlannerProjectDraft;
    update((current) => ({
      ...current,
      skillPolicy: {
        ...current.skillPolicy,
        ...patch,
      },
    }));
  };

  const savePlannerDefault = async () => {
    setIsSavingPlanner(true);
    try {
      const saved = await plannerConfigService.saveDefault(plannerDefaultDraft);
      setPlannerDefaultDraft(saved);
      setBanner({ severity: 'success', message: 'Planner defaults saved.' });
      addActivity('Saved global planner defaults.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save planner defaults.';
      setBanner({ severity: 'error', message });
      addActivity(message, 'error');
    } finally {
      setIsSavingPlanner(false);
    }
  };

  const savePlannerProject = async () => {
    if (!activeProject) {
      setBanner({ severity: 'error', message: 'Choose an active project before saving a planner override.' });
      return;
    }
    setIsSavingPlanner(true);
    try {
      const saved = await plannerConfigService.saveProject(activeProject.id, plannerProjectDraft);
      setPlannerProjectDraft(saved);
      setBanner({ severity: 'success', message: `Planner override saved for "${activeProject.name}".` });
      addActivity(`Saved planner override for "${activeProject.name}".`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save planner override.';
      setBanner({ severity: 'error', message });
      addActivity(message, 'error');
    } finally {
      setIsSavingPlanner(false);
    }
  };

  const testPlannerConfig = async () => {
    setIsSavingPlanner(true);
    try {
      const result = await plannerConfigService.test(plannerProjectDraft);
      setPlannerValidation({
        ok: result.ok,
        message: result.adapter.message,
        restartRequired: result.adapter.restartRequired,
        restartRequiredKeys: result.adapter.restartRequiredKeys,
      });
      addActivity(result.adapter.message, result.ok ? 'success' : 'error');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to test planner config.';
      setPlannerValidation({ ok: false, message, restartRequired: false, restartRequiredKeys: [] });
      addActivity(message, 'error');
    } finally {
      setIsSavingPlanner(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section>
        <h1 style={{ margin: 0, fontSize: 28 }}>Preferences / Setup</h1>
        <p style={{ margin: '8px 0 0', color: '#667085', fontSize: 16 }}>
          {appConfig.preferencesSubtitle}
        </p>
      </section>

      {banner && (
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            background: banner.severity === 'error' ? '#fdecec' : banner.severity === 'success' ? '#eaf8ef' : '#eaf2fb',
            color: banner.severity === 'error' ? '#9f1d1d' : banner.severity === 'success' ? '#1f7a3f' : '#1f4e79',
          }}
        >
          {banner.message}
        </div>
      )}

      <section style={activeProjectSelectorStyle}>
        <label style={{ ...fieldStyle, gap: 8 }}>
          Choose Active Project
          <select
            value={activeProject?.id ?? ''}
            onChange={(event) => setActiveProjectId(event.target.value)}
            disabled={isLoadingProjects || projects.length === 0}
            style={inputStyle}
          >
            {isLoadingProjects && <option value="">Loading projects...</option>}
            {!isLoadingProjects && projects.length === 0 && <option value="">No projects available</option>}
            {!isLoadingProjects &&
              projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
          </select>
        </label>
        <div style={{ color: '#667085', fontSize: 13 }}>
          Active project: <strong style={{ color: '#172033' }}>{activeProject?.name ?? 'None selected'}</strong>
        </div>
      </section>

      <hr style={setupDividerStyle} />

      <div style={setupTabsStyle} role="tablist" aria-label="Setup sections">
        <button
          type="button"
          role="tab"
          aria-selected={activeSetupTab === 'llm'}
          onClick={() => setActiveSetupTab('llm')}
          style={{
            ...setupTabButtonStyle,
            ...(activeSetupTab === 'llm' ? activeSetupTabButtonStyle : undefined),
          }}
        >
          LLM Setup
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSetupTab === 'agent'}
          onClick={() => setActiveSetupTab('agent')}
          style={{
            ...setupTabButtonStyle,
            ...(activeSetupTab === 'agent' ? activeSetupTabButtonStyle : undefined),
          }}
        >
          Skill Setup
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSetupTab === 'planner'}
          onClick={() => setActiveSetupTab('planner')}
          style={{
            ...setupTabButtonStyle,
            ...(activeSetupTab === 'planner' ? activeSetupTabButtonStyle : undefined),
          }}
        >
          Planner Setup
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSetupTab === 'project'}
          onClick={() => setActiveSetupTab('project')}
          style={{
            ...setupTabButtonStyle,
            ...(activeSetupTab === 'project' ? activeSetupTabButtonStyle : undefined),
          }}
        >
          Project Setup
        </button>
      </div>

      {activeSetupTab === 'llm' && (
        <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={retrieveConfiguration}
          disabled={isRetrieving}
          style={primaryButtonStyle}
        >
          {isRetrieving ? 'Retrieving...' : 'Retrieve Configuration'}
        </button>
        <button
          type="button"
          onClick={saveConfiguration}
          disabled={isSaving || configs.length === 0}
          style={secondaryButtonStyle}
        >
          Save Configuration
        </button>
        <button type="button" onClick={clearSecrets} disabled={isSaving} style={dangerButtonStyle}>
          Clear Stored Secrets
        </button>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        <section style={summaryGridStyle} aria-label="Retrieved LiteLLM provider key summary">
          {configs.map((config, index) => (
            <button
              key={config.id}
              type="button"
              onClick={() => setActiveConfigId(config.id)}
              style={{
                ...summaryCardStyle,
                ...(config.id === activeConfig?.id ? activeSummaryCardStyle : undefined),
              }}
            >
              <strong>{config.name.trim() || `LiteLLM Model ${index + 1}`}</strong>
              <span>Credential store: {config.secretLeaseStatus === 'none' ? 'not stored' : 'configured'}</span>
              <span>Provider key: {config.tokenStored ? 'stored' : 'not stored'}</span>
              <span>Model: {config.model || 'not set'}</span>
              <span>LiteLLM alias: {config.modelAlias || config.name}</span>
              <span>Version: {config.secretVersion ? `v${config.secretVersion}` : 'none'}</span>
            </button>
          ))}
        </section>

        {activeConfig && (
          <section key={activeConfig.id} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0 }}>LiteLLM Model {activeConfigIndex + 1}</h2>
                <p style={{ margin: '6px 0 0', color: '#667085' }}>Endpoint: LLM_{tierLabels[activeConfig.tier]}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ ...pillStyle, ...statusStyles[activeConfig.status] }}>
                  {activeConfig.status === 'idle' ? 'Not tested' : activeConfig.status}
                </span>
              </div>
            </div>

            <div style={metadataGridStyle}>
              <MetadataItem label="Secret store" value={activeConfig.secretLeaseStatus === 'none' ? 'Not stored yet' : 'Configured'} />
              <MetadataItem label="Version" value={activeConfig.secretVersion ? `v${activeConfig.secretVersion}` : 'None'} />
              <MetadataItem label="Added" value={formatDate(activeConfig.secretCreatedAt)} />
              <MetadataItem label="Updated" value={formatDate(activeConfig.secretUpdatedAt)} />
              <MetadataItem label="Last retrieved" value={formatDate(activeConfig.secretLastRetrievedAt)} />
              <MetadataItem label="Lease status" value={activeConfig.secretLeaseStatus ?? 'none'} />
              <MetadataItem
                label="Provider key"
                value={activeConfig.tokenStored ? 'Stored encrypted' : 'Not stored'}
              />
              <MetadataItem label="LiteLLM alias" value={activeConfig.modelAlias ?? activeConfig.name} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
              <div style={{ ...readOnlyFieldStyle, gridColumn: 'span 6' }}>
                <span style={readOnlyLabelStyle}>System name</span>
                <strong>{activeConfig.name}</strong>
              </div>
              <div style={{ ...readOnlyFieldStyle, gridColumn: 'span 6' }}>
                <span style={readOnlyLabelStyle}>Fixed LiteLLM endpoint</span>
                <strong>LLM_{tierLabels[activeConfig.tier]}</strong>
              </div>
              <label style={{ ...fieldStyle, gridColumn: 'span 12' }}>
                Provider Base URL
                <input
                  value={activeConfig.endpoint}
                  onChange={(event) => updateConfig(activeConfig.id, { endpoint: event.target.value })}
                  placeholder="https://api.cborg.lbl.gov"
                  style={inputStyle}
                />
                <span style={{ color: '#667085', fontSize: 12, fontWeight: 400 }}>
                  Enter the provider's OpenAI-compatible base URL. LiteLLM will call this provider.
                </span>
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 12' }}>
                Provider Model
                <input
                  value={activeConfig.model}
                  onChange={(event) => updateConfig(activeConfig.id, { model: event.target.value })}
                  placeholder="openai/gpt-4.1, anthropic/claude-sonnet, ..."
                  style={inputStyle}
                />
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 12' }}>
                Provider API key
                <input
                  type="password"
                  value={activeConfig.token}
                  onChange={(event) => updateConfig(activeConfig.id, { token: event.target.value })}
                  style={inputStyle}
                />
                <span style={{ color: '#667085', fontSize: 12, fontWeight: 400 }}>
                  Write-only rotation field. Leave blank to keep the existing encrypted key; it is never returned to the app.
                </span>
              </label>
              <div style={{ gridColumn: 'span 3', alignSelf: 'center' }}>
                <button
                  type="button"
                  disabled={activeConfig.status === 'testing'}
                  onClick={() => void testConnection(activeConfig)}
                  style={{ ...secondaryButtonStyle, width: '100%', minHeight: 46 }}
                >
                  {activeConfig.status === 'testing' ? 'Testing...' : 'Test Connection'}
                </button>
              </div>
            </div>

            {activeConfig.message && (
              <div
                style={{
                  marginTop: 16,
                  padding: 14,
                  borderRadius: 10,
                  ...statusStyles[
                    activeConfig.status === 'success' || activeConfig.status === 'error'
                      ? activeConfig.status
                      : 'testing'
                  ],
                }}
              >
                {activeConfig.message}
              </div>
            )}
          </section>
        )}
      </div>

      <section style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: 0 }}>LLM Test Chat</h2>
            <p style={{ margin: '6px 0 0', color: '#667085' }}>
              Ask a quick question through LiteLLM before using this model in the workflow.
            </p>
          </div>
          <label style={{ ...fieldStyle, minWidth: 280 }}>
            Test model
            <select
              value={selectedChatConfigId}
              onChange={(event) => setSelectedChatConfigId(event.target.value)}
              style={inputStyle}
            >
              {configs.map((config, index) => (
                <option key={config.id} value={config.id}>
                  {config.name.trim() || `LiteLLM Model ${index + 1}`} (LLM_{tierLabels[config.tier]})
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={chatWindowStyle}>
          {chatMessages.map((message) => (
            <div
              key={message.id}
              style={{
                ...chatBubbleStyle,
                ...(message.role === 'user'
                  ? userBubbleStyle
                  : message.role === 'assistant'
                    ? assistantBubbleStyle
                    : systemBubbleStyle),
              }}
            >
              <strong style={{ display: 'block', marginBottom: 4, textTransform: 'capitalize' }}>
                {message.role}
              </strong>
              {message.text}
            </div>
          ))}
        </div>

        <form onSubmit={sendChatQuestion} style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <input
            value={chatQuestion}
            onChange={(event) => setChatQuestion(event.target.value)}
            placeholder="Ask a short test question..."
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            type="submit"
            disabled={isChatting || !chatQuestion.trim() || !selectedChatConfigId}
            style={primaryButtonStyle}
          >
            {isChatting ? 'Asking...' : 'Ask'}
          </button>
        </form>
      </section>

      <section style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0 }}>Backend Activity</h2>
            <p style={{ margin: '6px 0 0', color: '#667085' }}>
              Shows secret-store/backend proxy actions triggered from this screen.
            </p>
          </div>
          <button type="button" onClick={() => setActivityLog([])} style={secondaryButtonStyle}>
            Clear Log
          </button>
        </div>
        <div style={activityLogStyle}>
          {activityLog.length === 0 ? (
            <div style={{ color: '#667085' }}>No activity yet.</div>
          ) : (
            activityLog.map((entry) => (
              <div key={entry.id} style={{ ...activityEntryStyle, ...activityLevelStyles[entry.level] }}>
                <span style={{ color: '#667085' }}>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <span>{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </section>
        </>
      )}

      {activeSetupTab === 'agent' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <section style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0 }}>Agent Skill Library</h2>
                <p style={{ margin: '6px 0 0', color: '#667085' }}>
                  Create reusable skills with standard headings, then enable the right set for each active project.
                </p>
              </div>
              <button type="button" onClick={createSkill} style={primaryButtonStyle}>
                Add Skill
              </button>
            </div>

            <h3 style={sectionHeadingStyle}>Repository Skills</h3>
            <section style={summaryGridStyle} aria-label="Repository agent skills">
              {repositorySkills.length === 0 && !isLoadingAgentSkills ? (
                <div style={{ ...readOnlyFieldStyle, gridColumn: '1 / -1' }}>
                  <span style={readOnlyLabelStyle}>No repository skills</span>
                  <strong>Configure `AGENT_REPO_DIRECTORIES` or add skills under the package agent repository.</strong>
                </div>
              ) : (
                repositorySkills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => selectSkill(skill)}
                    style={{
                      ...summaryCardStyle,
                      ...(skill.id === activeSkillId ? activeSummaryCardStyle : undefined),
                    }}
                  >
                    <strong>{skill.name || 'Untitled skill'}</strong>
                    <span>Repository: {skill.origin?.repoName ?? 'Package'}</span>
                    <span>Version: {skill.origin?.version ?? 'n/a'}</span>
                    <span>Capabilities: {skill.capabilities?.length ? skill.capabilities.join(', ') : 'None'}</span>
                    <span>Executor: {skill.executable.mode}</span>
                  </button>
                ))
              )}
            </section>

            <h3 style={{ ...sectionHeadingStyle, marginTop: 18 }}>My Skills</h3>
            <section style={summaryGridStyle} aria-label="Editable user agent skills">
              {agentSkills.length === 0 && !isLoadingAgentSkills ? (
                <div style={{ ...readOnlyFieldStyle, gridColumn: '1 / -1' }}>
                  <span style={readOnlyLabelStyle}>No skills yet</span>
                  <strong>Add a skill to start building the agent library.</strong>
                </div>
              ) : (
                userSkills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => selectSkill(skill)}
                    style={{
                      ...summaryCardStyle,
                      ...(skill.id === activeSkillId ? activeSummaryCardStyle : undefined),
                    }}
                  >
                    <strong>{skill.name || 'Untitled skill'}</strong>
                    <span>Category: {skill.category || 'General'}</span>
                    <span>Status: {skill.status}</span>
                    <span>Executor: {skill.executable.mode}</span>
                    <span>Updated: {formatDate(skill.updatedAt)}</span>
                  </button>
                ))
              )}
              {userSkills.length === 0 && agentSkills.length > 0 && !isLoadingAgentSkills && (
                <div style={{ ...readOnlyFieldStyle, gridColumn: '1 / -1' }}>
                  <span style={readOnlyLabelStyle}>No personal skills yet</span>
                  <strong>Add a skill or duplicate a repository skill to customize it.</strong>
                </div>
              )}
            </section>
          </section>

          <section style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0 }}>Skill Editor</h2>
                <p style={{ margin: '6px 0 0', color: '#667085' }}>
                  {activeSkillIsRepositorySkill
                    ? 'Repository skills are read-only. Duplicate one to customize it.'
                    : 'Fill in the headings agents need for consistent prompt injection.'}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'start' }}>
                {activeSkillIsRepositorySkill ? (
                  <button type="button" onClick={() => void duplicateSkill()} disabled={isSavingAgentSkill} style={primaryButtonStyle}>
                    {isSavingAgentSkill ? 'Duplicating...' : 'Duplicate to My Skills'}
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={saveSkill} disabled={isSavingAgentSkill} style={primaryButtonStyle}>
                      {isSavingAgentSkill ? 'Saving...' : 'Save Skill'}
                    </button>
                    <button type="button" onClick={deleteSkill} disabled={isSavingAgentSkill || userSkills.length === 0} style={dangerButtonStyle}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
              <label style={{ ...fieldStyle, gridColumn: 'span 6' }}>
                Name
                <input
                  value={skillDraft.name}
                  onChange={(event) => updateSkillDraft({ name: event.target.value })}
                  disabled={activeSkillIsRepositorySkill}
                  style={inputStyle}
                />
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 3' }}>
                Category
                <input
                  value={skillDraft.category}
                  onChange={(event) => updateSkillDraft({ category: event.target.value })}
                  disabled={activeSkillIsRepositorySkill}
                  style={inputStyle}
                />
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 3' }}>
                Status
                <select
                  value={skillDraft.status}
                  onChange={(event) => updateSkillDraft({ status: event.target.value === 'enabled' ? 'enabled' : 'draft' })}
                  disabled={activeSkillIsRepositorySkill}
                  style={inputStyle}
                >
                  <option value="draft">Draft</option>
                  <option value="enabled">Enabled</option>
                </select>
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 6' }}>
                Purpose
                <textarea
                  value={skillDraft.purpose}
                  onChange={(event) => updateSkillDraft({ purpose: event.target.value })}
                  disabled={activeSkillIsRepositorySkill}
                  rows={4}
                  style={textareaStyle}
                />
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 6' }}>
                When to use
                <textarea
                  value={skillDraft.whenToUse}
                  onChange={(event) => updateSkillDraft({ whenToUse: event.target.value })}
                  disabled={activeSkillIsRepositorySkill}
                  rows={4}
                  style={textareaStyle}
                />
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 6' }}>
                Inputs
                <textarea
                  value={listToLines(skillDraft.inputs)}
                  onChange={(event) => updateSkillDraft({ inputs: linesToList(event.target.value) })}
                  disabled={activeSkillIsRepositorySkill}
                  rows={4}
                  placeholder="One input per line"
                  style={textareaStyle}
                />
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 6' }}>
                Required tools
                <textarea
                  value={listToLines(skillDraft.requiredTools)}
                  onChange={(event) => updateSkillDraft({ requiredTools: linesToList(event.target.value) })}
                  disabled={activeSkillIsRepositorySkill}
                  rows={4}
                  placeholder="One tool per line"
                  style={textareaStyle}
                />
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 12' }}>
                Procedure
                <textarea
                  value={skillDraft.procedure}
                  onChange={(event) => updateSkillDraft({ procedure: event.target.value })}
                  disabled={activeSkillIsRepositorySkill}
                  rows={6}
                  style={textareaStyle}
                />
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 6' }}>
                Expected output
                <textarea
                  value={skillDraft.expectedOutput}
                  onChange={(event) => updateSkillDraft({ expectedOutput: event.target.value })}
                  disabled={activeSkillIsRepositorySkill}
                  rows={4}
                  style={textareaStyle}
                />
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 6' }}>
                Safety constraints
                <textarea
                  value={skillDraft.safetyConstraints}
                  onChange={(event) => updateSkillDraft({ safetyConstraints: event.target.value })}
                  disabled={activeSkillIsRepositorySkill}
                  rows={4}
                  style={textareaStyle}
                />
              </label>
            </div>
          </section>

          <section style={cardStyle}>
            <h2 style={{ margin: '0 0 14px' }}>Executable</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
              <label style={{ ...fieldStyle, gridColumn: 'span 4' }}>
                Executor mode
                <select
                  value={skillDraft.executable.mode}
                  disabled={activeSkillIsRepositorySkill}
                  onChange={(event) =>
                    updateSkillExecutable({
                      ...defaultAgentSkillExecutable(),
                      mode: event.target.value === 'catalog' ? 'catalog' : event.target.value === 'custom' ? 'custom' : 'none',
                    })
                  }
                  style={inputStyle}
                >
                  <option value="none">None</option>
                  <option value="catalog">Approved container</option>
                  <option value="custom">Custom container</option>
                </select>
              </label>

              {skillDraft.executable.mode === 'catalog' && (
                <label style={{ ...fieldStyle, gridColumn: 'span 8' }}>
                  Approved executor
                  <select
                    value={skillDraft.executable.catalogId ?? ''}
                    disabled={activeSkillIsRepositorySkill}
                    onChange={(event) => {
                      const selected = executorCatalog.find((item) => item.id === event.target.value);
                      updateSkillExecutable({
                        catalogId: event.target.value,
                        image: selected?.image,
                        command: selected?.command,
                        args: selected?.args ?? [],
                        workingDir: selected?.workingDir,
                        timeoutSeconds: selected?.timeoutSeconds ?? 120,
                        network: selected?.network ?? 'none',
                      });
                    }}
                    style={inputStyle}
                  >
                    <option value="">Choose an approved executor</option>
                    {executorCatalog.map((executor) => (
                      <option key={executor.id} value={executor.id}>
                        {executor.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {skillDraft.executable.mode === 'custom' && (
                <>
                  <label style={{ ...fieldStyle, gridColumn: 'span 6' }}>
                    Container image
                    <input
                      value={skillDraft.executable.image ?? ''}
                      onChange={(event) => updateSkillExecutable({ image: event.target.value })}
                      disabled={activeSkillIsRepositorySkill}
                      placeholder="ghcr.io/org/skill-runner:latest"
                      style={inputStyle}
                    />
                  </label>
                  <label style={{ ...fieldStyle, gridColumn: 'span 6' }}>
                    Command
                    <input
                      value={skillDraft.executable.command ?? ''}
                      onChange={(event) => updateSkillExecutable({ command: event.target.value })}
                      disabled={activeSkillIsRepositorySkill}
                      placeholder="python"
                      style={inputStyle}
                    />
                  </label>
                </>
              )}

              {skillDraft.executable.mode !== 'none' && (
                <>
                  <label style={{ ...fieldStyle, gridColumn: 'span 6' }}>
                    Args
                    <textarea
                      value={listToLines(skillDraft.executable.args)}
                      onChange={(event) => updateSkillExecutable({ args: linesToList(event.target.value) })}
                      disabled={activeSkillIsRepositorySkill}
                      rows={3}
                      style={textareaStyle}
                    />
                  </label>
                  <label style={{ ...fieldStyle, gridColumn: 'span 3' }}>
                    Working directory
                    <input
                      value={skillDraft.executable.workingDir ?? '/workspace'}
                      onChange={(event) => updateSkillExecutable({ workingDir: event.target.value })}
                      disabled={activeSkillIsRepositorySkill}
                      style={inputStyle}
                    />
                  </label>
                  <label style={{ ...fieldStyle, gridColumn: 'span 3' }}>
                    Timeout seconds
                    <input
                      type="number"
                      min={10}
                      max={900}
                      value={skillDraft.executable.timeoutSeconds}
                      onChange={(event) => updateSkillExecutable({ timeoutSeconds: Number(event.target.value) })}
                      disabled={activeSkillIsRepositorySkill}
                      style={inputStyle}
                    />
                  </label>
                  <label style={{ ...fieldStyle, gridColumn: 'span 4' }}>
                    Network policy
                    <select
                      value={skillDraft.executable.network}
                      onChange={(event) => updateSkillExecutable({ network: event.target.value === 'egress' ? 'egress' : 'none' })}
                    disabled={activeSkillIsRepositorySkill}
                      style={inputStyle}
                    >
                      <option value="none">No network</option>
                      <option value="egress">Outbound only</option>
                    </select>
                  </label>
                  <label style={{ ...fieldStyle, gridColumn: 'span 8' }}>
                    Environment allowlist
                    <input
                      value={skillDraft.executable.envAllowlist.join(', ')}
                      onChange={(event) => updateSkillExecutable({ envAllowlist: linesToList(event.target.value) })}
                      disabled={activeSkillIsRepositorySkill}
                      placeholder="OPTIONAL_ENV_NAME, ANOTHER_ENV_NAME"
                      style={inputStyle}
                    />
                  </label>
                </>
              )}
            </div>
          </section>

          <section style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0 }}>Generated Skill Package</h2>
                <p style={{ margin: '6px 0 0', color: '#667085' }}>
                  These fields render into a portable skill directory containing `SKILL.md`.
                </p>
              </div>
              <div style={{ ...readOnlyFieldStyle, minWidth: 220 }}>
                <span style={readOnlyLabelStyle}>Directory</span>
                <strong>{skillPackagePreview.directoryName}/</strong>
              </div>
              {activeSkillIsRepositorySkill && (
                <div style={{ ...readOnlyFieldStyle, minWidth: 220 }}>
                  <span style={readOnlyLabelStyle}>Repository</span>
                  <strong>{skillDraft.origin?.repoName ?? 'Package skill'}</strong>
                </div>
              )}
            </div>
            <pre style={skillPreviewStyle}>{skillPackagePreview.skillMd}</pre>
          </section>

          <section style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0 }}>Project Enablement</h2>
                <p style={{ margin: '6px 0 0', color: '#667085' }}>
                  Enable reusable skills for the active project: {activeProject?.name ?? 'None selected'}.
                </p>
              </div>
              <button type="button" onClick={saveProjectSkillBindings} disabled={isSavingSkillBindings || !activeProject} style={primaryButtonStyle}>
                {isSavingSkillBindings ? 'Saving...' : 'Save Project Skills'}
              </button>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              {agentSkills.length === 0 ? (
                <div style={{ color: '#667085' }}>Create a skill before enabling project skills.</div>
              ) : (
                agentSkills.map((skill, index) => {
                  const binding = projectSkillBindings.find((item) => item.skillId === skill.id) ?? createBinding(skill, index);
                  return (
                    <div key={skill.id} style={projectSkillBindingStyle}>
                      <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 700 }}>
                        <input
                          type="checkbox"
                          checked={binding.enabled}
                          onChange={(event) => updateProjectSkillBinding(skill.id, { enabled: event.target.checked })}
                        />
                        {skill.name || 'Untitled skill'}
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={binding.priority}
                        onChange={(event) => updateProjectSkillBinding(skill.id, { priority: Number(event.target.value) })}
                        style={{ ...inputStyle, maxWidth: 110 }}
                        aria-label={`${skill.name || skill.id} priority`}
                      />
                      <input
                        value={binding.notes ?? ''}
                        onChange={(event) => updateProjectSkillBinding(skill.id, { notes: event.target.value })}
                        placeholder="Project-specific note"
                        style={inputStyle}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      )}

      {activeSetupTab === 'planner' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <section style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0 }}>Planner Defaults</h2>
                <p style={{ margin: '6px 0 0', color: '#667085' }}>
                  Select a read-only planner spec and bind its model roles to configured LiteLLM aliases.
                </p>
              </div>
              <button type="button" onClick={() => void savePlannerDefault()} disabled={isSavingPlanner || isLoadingPlanner} style={primaryButtonStyle}>
                {isSavingPlanner ? 'Saving...' : 'Save Defaults'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
              <label style={{ ...fieldStyle, gridColumn: 'span 6' }}>
                Planner spec
                <select
                  value={plannerDefaultDraft.specId}
                  onChange={(event) => {
                    const spec = plannerSpecs.find((item) => item.id === event.target.value);
                    updatePlannerDefaultDraft(createPlannerConfig(spec, plannerModelAliases));
                  }}
                  disabled={plannerSpecs.length === 0}
                  style={inputStyle}
                >
                  {plannerSpecs.map((spec) => (
                    <option key={spec.id} value={spec.id}>
                      {spec.name}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ ...readOnlyFieldStyle, gridColumn: 'span 6' }}>
                <span style={readOnlyLabelStyle}>Engine</span>
                <strong>{plannerDefaultSpec?.engine ?? 'No planner spec loaded'}</strong>
                <span>{plannerDefaultSpec?.description ?? 'Configure PLANNER_REPO_DIRECTORIES or add specs under agent-repo/planners.'}</span>
              </div>

              {(plannerDefaultSpec?.modelRoles ?? []).map((role) => (
                <label key={role} style={{ ...fieldStyle, gridColumn: 'span 4' }}>
                  {role} model
                  <select
                    value={plannerDefaultDraft.roleBindings[role] ?? plannerModelAliases[0]?.alias ?? 'LLM_A'}
                    onChange={(event) => updatePlannerRoleBinding('default', role, event.target.value)}
                    style={inputStyle}
                  >
                    {plannerModelAliases.map((model) => (
                      <option key={model.alias} value={model.alias}>
                        {model.alias}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0 }}>Project Override</h2>
                <p style={{ margin: '6px 0 0', color: '#667085' }}>
                  Override planner selection, model bindings, and runtime policy for the active project only.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void savePlannerProject()}
                disabled={isSavingPlanner || !activeProject || isLoadingPlanner}
                style={primaryButtonStyle}
              >
                {isSavingPlanner ? 'Saving...' : 'Save Project Override'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
              <label style={{ ...fieldStyle, gridColumn: 'span 6' }}>
                Planner spec
                <select
                  value={plannerProjectDraft.specId}
                  onChange={(event) => {
                    const spec = plannerSpecs.find((item) => item.id === event.target.value);
                    updatePlannerProjectDraft(createPlannerConfig(spec, plannerModelAliases));
                  }}
                  disabled={plannerSpecs.length === 0}
                  style={inputStyle}
                >
                  {plannerSpecs.map((spec) => (
                    <option key={spec.id} value={spec.id}>
                      {spec.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 3' }}>
                Context strategy
                <select
                  value={plannerProjectDraft.contextPolicy.strategy}
                  onChange={(event) =>
                    updatePlannerContext('project', { strategy: event.target.value as PlannerConfig['contextPolicy']['strategy'] })
                  }
                  style={inputStyle}
                >
                  <option value="summarize">Summarize</option>
                  <option value="truncate">Truncate</option>
                  <option value="clear">Clear</option>
                  <option value="prompt">Prompt</option>
                </select>
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 3' }}>
                Workspace mode
                <select
                  value={plannerProjectDraft.workspaceMode}
                  onChange={(event) => updatePlannerProjectDraft({ workspaceMode: event.target.value as PlannerConfig['workspaceMode'] })}
                  style={inputStyle}
                >
                  <option value="project-workspace">Project workspace</option>
                  <option value="goose-workspace">Goose workspace</option>
                  <option value="read-only">Read-only</option>
                </select>
              </label>

              {(plannerProjectSpec?.modelRoles ?? []).map((role) => (
                <label key={role} style={{ ...fieldStyle, gridColumn: 'span 4' }}>
                  {role} model
                  <select
                    value={plannerProjectDraft.roleBindings[role] ?? plannerModelAliases[0]?.alias ?? 'LLM_A'}
                    onChange={(event) => updatePlannerRoleBinding('project', role, event.target.value)}
                    style={inputStyle}
                  >
                    {plannerModelAliases.map((model) => (
                      <option key={model.alias} value={model.alias}>
                        {model.alias}
                      </option>
                    ))}
                  </select>
                </label>
              ))}

              <label style={{ ...fieldStyle, gridColumn: 'span 3' }}>
                Max turns
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={plannerProjectDraft.contextPolicy.maxTurns}
                  onChange={(event) => updatePlannerContext('project', { maxTurns: Number(event.target.value) })}
                  style={inputStyle}
                />
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 3' }}>
                Subagent max turns
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={plannerProjectDraft.contextPolicy.subagentMaxTurns}
                  onChange={(event) => updatePlannerContext('project', { subagentMaxTurns: Number(event.target.value) })}
                  style={inputStyle}
                />
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 6' }}>
                Skill visibility
                <select
                  value={plannerProjectDraft.skillPolicy.visibility}
                  onChange={(event) =>
                    updatePlannerSkillPolicy('project', { visibility: event.target.value as PlannerConfig['skillPolicy']['visibility'] })
                  }
                  style={inputStyle}
                >
                  <option value="project-enabled">Enabled project skills</option>
                  <option value="all-enabled">All enabled skills</option>
                  <option value="allowlist">Allowlist</option>
                </select>
              </label>
            </div>
          </section>

          <section style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0 }}>Skill Visibility And Validation</h2>
                <p style={{ margin: '6px 0 0', color: '#667085' }}>
                  Keep planner-visible skills explicit and test whether the current Goose adapter can accept the setup.
                </p>
              </div>
              <button type="button" onClick={() => void testPlannerConfig()} disabled={isSavingPlanner || !plannerProjectDraft.specId} style={secondaryButtonStyle}>
                Test Planner Config
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
              <div style={{ ...readOnlyFieldStyle, gridColumn: 'span 6' }}>
                <span style={readOnlyLabelStyle}>Enabled project skills</span>
                <strong>{enabledSkillIds.length}</strong>
                <span>{enabledSkillIds.length ? enabledSkillIds.join(', ') : 'No skills are enabled for the active project yet.'}</span>
              </div>
              <label style={{ ...fieldStyle, gridColumn: 'span 6' }}>
                Allowlisted skill IDs
                <textarea
                  value={listToLines(plannerProjectDraft.skillPolicy.allowedSkillIds)}
                  onChange={(event) => updatePlannerSkillPolicy('project', { allowedSkillIds: linesToList(event.target.value) })}
                  rows={4}
                  placeholder="One skill id per line"
                  style={textareaStyle}
                />
              </label>
              <div style={{ ...readOnlyFieldStyle, gridColumn: 'span 6' }}>
                <span style={readOnlyLabelStyle}>Restart-required settings</span>
                <strong>{plannerProjectSpec?.runtime.restartRequiredKeys.length ? 'May require Goose restart' : 'Request-level only'}</strong>
                <span>{plannerProjectSpec?.runtime.restartRequiredKeys.join(', ') || 'No restart-required keys declared.'}</span>
              </div>
              <div style={{ ...readOnlyFieldStyle, gridColumn: 'span 6' }}>
                <span style={readOnlyLabelStyle}>Validation</span>
                <strong>{plannerValidation ? (plannerValidation.ok ? 'Passed' : 'Needs attention') : 'Not tested'}</strong>
                <span>{plannerValidation?.message ?? 'Run a validation test after changing planner bindings.'}</span>
                {plannerValidation?.restartRequired && <span>Restart keys: {plannerValidation.restartRequiredKeys.join(', ')}</span>}
              </div>
            </div>
          </section>
        </div>
      )}

      {activeSetupTab === 'project' && (
        <section style={cardStyle}>
          <p style={{ margin: '0 0 20px', color: '#667085' }}>
            Browse projects, create new project records, and describe the work that downstream agents will process.
          </p>

          <div style={projectPanelGridStyle}>
            <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
              <h3 style={sectionHeadingStyle}>Define / Select</h3>
              <form onSubmit={createProject} style={{ ...metadataGridStyle, marginBottom: 0 }}>
                <label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
                  New project name
                  <input
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder="e.g. Beamline literature review"
                    style={inputStyle}
                  />
                </label>
                <label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
                  Description
                  <textarea
                    value={projectDescription}
                    onChange={(event) => setProjectDescription(event.target.value)}
                    placeholder="Describe the scientific scope, data sources, or intended outputs."
                    rows={5}
                    style={textareaStyle}
                  />
                </label>
                <button
                  type="submit"
                  disabled={isSavingProject || isDeletingProject || !projectName.trim()}
                  style={primaryButtonStyle}
                >
                  {isSavingProject ? 'Saving...' : 'Add Project'}
                </button>
              </form>

              <label style={fieldStyle}>
                Select existing project
                <select
                  value={activeProject?.id ?? ''}
                  onChange={(event) => setActiveProjectId(event.target.value)}
                  disabled={isLoadingProjects || projects.length === 0}
                  style={inputStyle}
                >
                  {isLoadingProjects && <option value="">Loading projects...</option>}
                  {!isLoadingProjects && projects.length === 0 && <option value="">No projects yet</option>}
                  {!isLoadingProjects &&
                    projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                </select>
              </label>

              {activeProject && (
                <div style={selectedProjectSummaryStyle}>
                  <strong>{activeProject.name}</strong>
                  <span>Bucket: {activeProject.bucketName ?? 'pending'}</span>
                  <span>Updated: {formatDate(activeProject.updatedAt)}</span>
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
              <h3 style={sectionHeadingStyle}>Details</h3>
              {activeProject ? (
                <>
                  <div style={metadataGridStyle}>
                    <MetadataItem label="Project ID" value={activeProject.id} />
                    <MetadataItem label="Status" value={activeProject.status} />
                    <MetadataItem label="MinIO bucket" value={activeProject.bucketName ?? 'Not created yet'} />
                    <MetadataItem label="Loaded prefix" value={`${activeProject.loadedPrefix ?? 'loaded'}/`} />
                    <MetadataItem label="Parsed prefix" value={`${activeProject.parsedPrefix ?? 'parsed'}/`} />
                    <MetadataItem label="Project JSON" value={activeProject.metadataObjectKey ?? 'project.json'} />
                    <MetadataItem label="Created" value={formatDate(activeProject.createdAt)} />
                    <MetadataItem label="Updated" value={formatDate(activeProject.updatedAt)} />
                  </div>
                  <label style={fieldStyle}>
                    Project name
                    <input
                      value={activeProject.name}
                      onChange={(event) => updateActiveProject({ name: event.target.value })}
                      style={inputStyle}
                    />
                  </label>
                  <label style={fieldStyle}>
                    Project description
                    <textarea
                      value={activeProject.description}
                      onChange={(event) => updateActiveProject({ description: event.target.value })}
                      rows={10}
                      style={textareaStyle}
                    />
                  </label>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={saveActiveProject}
                      disabled={isSavingProject || isDeletingProject}
                      style={primaryButtonStyle}
                    >
                      {isSavingProject ? 'Saving...' : 'Save Project'}
                    </button>
                    <button
                      type="button"
                      onClick={deleteActiveProject}
                      disabled={isSavingProject || isDeletingProject}
                      style={dangerButtonStyle}
                    >
                      {isDeletingProject ? 'Deleting...' : 'Delete Project'}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ ...metadataGridStyle, marginBottom: 0, color: '#667085' }}>
                  Select a project or create a new one to edit its description.
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={metadataItemStyle}>
      <span style={{ color: '#667085', fontSize: 12 }}>{label}</span>
      <strong style={{ overflowWrap: 'anywhere' }}>{value}</strong>
    </div>
  );
}

const formatDate = (value?: string) => {
  if (!value) {
    return 'Not available';
  }

  return new Date(value).toLocaleString();
};

const cardStyle = {
  padding: 24,
  border: '1px solid #dbe3ee',
  borderRadius: 16,
  background: '#ffffff',
  boxShadow: '0 8px 30px rgba(31, 78, 121, 0.08)',
} satisfies CSSProperties;

const activeProjectSelectorStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 420px) minmax(220px, 1fr)',
  gap: 16,
  alignItems: 'end',
  padding: 18,
  border: '1px solid #dbe3ee',
  borderRadius: 14,
  background: '#ffffff',
} satisfies CSSProperties;

const setupDividerStyle = {
  width: '100%',
  border: 0,
  borderTop: '1px solid #b8d8ef',
  margin: '0 0 4px',
} satisfies CSSProperties;

const setupTabsStyle = {
  display: 'flex',
  gap: 4,
  alignItems: 'flex-end',
  borderBottom: '2px solid #6d93b3',
  marginBottom: -8,
  paddingLeft: 12,
} satisfies CSSProperties;

const setupTabButtonStyle = {
  padding: '14px 26px',
  border: '1px solid #b8d8ef',
  borderBottom: '2px solid #6d93b3',
  borderTopLeftRadius: 14,
  borderTopRightRadius: 14,
  background: '#d9ecfb',
  color: '#2f5f87',
  cursor: 'pointer',
  fontSize: 18,
  fontWeight: 800,
  marginBottom: -2,
} satisfies CSSProperties;

const activeSetupTabButtonStyle = {
  border: '2px solid #6d93b3',
  borderBottom: '2px solid #ffffff',
  background: '#ffffff',
  color: '#1f4e79',
  padding: '15px 28px',
  position: 'relative',
  zIndex: 1,
} satisfies CSSProperties;

const metadataGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
  marginBottom: 20,
  padding: 14,
  border: '1px solid #dbe3ee',
  borderRadius: 12,
  background: '#f8fafc',
} satisfies CSSProperties;

const metadataItemStyle = {
  display: 'grid',
  gap: 4,
} satisfies CSSProperties;

const summaryGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 12,
} satisfies CSSProperties;

const summaryCardStyle = {
  display: 'grid',
  gap: 6,
  padding: 14,
  border: '1px solid #dbe3ee',
  borderRadius: 12,
  background: '#ffffff',
  color: '#172033',
  cursor: 'pointer',
  textAlign: 'left',
  fontSize: 13,
} satisfies CSSProperties;

const activeSummaryCardStyle = {
  border: '2px solid #6d93b3',
  background: '#eaf2fb',
} satisfies CSSProperties;

const activityLogStyle = {
  display: 'grid',
  gap: 8,
  maxHeight: 260,
  overflowY: 'auto',
  padding: 12,
  border: '1px solid #dbe3ee',
  borderRadius: 12,
  background: '#f8fafc',
} satisfies CSSProperties;

const activityEntryStyle = {
  display: 'grid',
  gridTemplateColumns: '90px 1fr',
  gap: 12,
  padding: '10px 12px',
  borderRadius: 10,
  fontSize: 13,
  lineHeight: 1.35,
} satisfies CSSProperties;

const activityLevelStyles = {
  info: { background: '#ffffff', color: '#172033' },
  success: { background: '#eaf8ef', color: '#1f7a3f' },
  error: { background: '#fdecec', color: '#9f1d1d' },
} satisfies Record<ActivityLogEntry['level'], CSSProperties>;

const fieldStyle = {
  display: 'grid',
  gap: 8,
  fontWeight: 700,
} satisfies CSSProperties;

const readOnlyFieldStyle = {
  display: 'grid',
  gap: 8,
  padding: '11px 14px',
  border: '1px solid #dbe3ee',
  borderRadius: 10,
  background: '#f8fafc',
} satisfies CSSProperties;

const readOnlyLabelStyle = {
  color: '#667085',
  fontSize: 12,
  fontWeight: 700,
} satisfies CSSProperties;

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px 14px',
  border: '1px solid #b9c4d0',
  borderRadius: 10,
  fontSize: 15,
} satisfies CSSProperties;

const textareaStyle = {
  ...inputStyle,
  resize: 'vertical',
  fontFamily: 'inherit',
  lineHeight: 1.45,
} satisfies CSSProperties;

const primaryButtonStyle = {
  padding: '10px 16px',
  border: 0,
  borderRadius: 10,
  background: '#1f4e79',
  color: '#ffffff',
  cursor: 'pointer',
  fontWeight: 700,
} satisfies CSSProperties;

const secondaryButtonStyle = {
  padding: '10px 16px',
  border: '1px solid #1f4e79',
  borderRadius: 10,
  background: '#ffffff',
  color: '#1f4e79',
  cursor: 'pointer',
  fontWeight: 700,
} satisfies CSSProperties;

const dangerButtonStyle = {
  padding: '10px 16px',
  border: '1px solid #b42318',
  borderRadius: 10,
  background: '#ffffff',
  color: '#b42318',
  cursor: 'pointer',
  fontWeight: 700,
} satisfies CSSProperties;

const pillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 28,
  padding: '0 10px',
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 700,
  textTransform: 'capitalize',
} satisfies CSSProperties;

const projectPanelGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(260px, 0.8fr) minmax(0, 1.2fr)',
  gap: 24,
} satisfies CSSProperties;

const sectionHeadingStyle = {
  margin: 0,
  paddingBottom: 10,
  borderBottom: '1px solid #b8d8ef',
  color: '#1f4e79',
  fontSize: 18,
} satisfies CSSProperties;

const selectedProjectSummaryStyle = {
  display: 'grid',
  gap: 6,
  padding: 14,
  border: '1px solid #dbe3ee',
  borderRadius: 12,
  background: '#f8fafc',
  color: '#172033',
  fontSize: 13,
} satisfies CSSProperties;

const projectSkillBindingStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(180px, 0.8fr) 120px minmax(220px, 1fr)',
  gap: 12,
  alignItems: 'center',
  padding: 12,
  border: '1px solid #dbe3ee',
  borderRadius: 12,
  background: '#f8fafc',
} satisfies CSSProperties;

const skillPreviewStyle = {
  maxHeight: 420,
  overflow: 'auto',
  padding: 14,
  border: '1px solid #dbe3ee',
  borderRadius: 12,
  background: '#0f172a',
  color: '#e2e8f0',
  fontSize: 13,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
} satisfies CSSProperties;

const chatWindowStyle = {
  minHeight: 260,
  maxHeight: 360,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 16,
  border: '1px solid #dbe3ee',
  borderRadius: 14,
  background: '#f8fafc',
} satisfies CSSProperties;

const chatBubbleStyle = {
  maxWidth: '78%',
  padding: '12px 14px',
  borderRadius: 14,
  lineHeight: 1.45,
  fontSize: 14,
} satisfies CSSProperties;

const userBubbleStyle = {
  alignSelf: 'flex-end',
  background: '#1f4e79',
  color: '#ffffff',
} satisfies CSSProperties;

const assistantBubbleStyle = {
  alignSelf: 'flex-start',
  background: '#ffffff',
  color: '#172033',
  border: '1px solid #dbe3ee',
} satisfies CSSProperties;

const systemBubbleStyle = {
  alignSelf: 'center',
  maxWidth: '92%',
  background: '#eaf2fb',
  color: '#1f4e79',
} satisfies CSSProperties;
