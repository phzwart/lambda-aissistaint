import { FormEvent, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { appConfig } from '../config/env';
import { llmConfigService } from '../services/llmConfigService';
import { projectService } from '../services/projectService';
import { useWorkflowStore } from '../state/workflowStore';
import type { ConnectionStatus, LlmConfig, LlmTier, Project } from '../types/domain';

const tierLabels: Record<LlmTier, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const statusStyles: Record<ConnectionStatus, { background: string; color: string }> = {
  idle: { background: '#eef2f6', color: '#475467' },
  testing: { background: '#eaf2fb', color: '#1f4e79' },
  success: { background: '#eaf8ef', color: '#1f7a3f' },
  error: { background: '#fdecec', color: '#9f1d1d' },
};

const createConfig = (index = 0): LlmConfig => ({
  id: crypto.randomUUID(),
  name: `LLM_${appConfig.llmTiers[index] ?? 'medium'}`,
  endpoint: '',
  model: '',
  token: '',
  tier: appConfig.llmTiers[index] ?? 'medium',
  status: 'idle',
});

const normalizeConfigs = (configs: LlmConfig[]) =>
  Array.from({ length: appConfig.llmEndpointCount }, (_, index) => ({
    ...createConfig(index),
    ...(configs[index] ?? {}),
    name: `LLM_${appConfig.llmTiers[index] ?? 'medium'}`,
    tier: appConfig.llmTiers[index] ?? 'medium',
    model: configs[index]?.model ?? '',
  }));

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
  const [activeSetupTab, setActiveSetupTab] = useState<'llm' | 'agent' | 'project'>('llm');
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
        ? 'Mock services are enabled. Backend/OpenBao calls are simulated in the browser.'
        : 'Real services are enabled. OpenBao actions will go through the backend proxy.',
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
    updateConfig(config.id, { status: 'testing', message: 'Testing endpoint...' });
    const result = await llmConfigService.testConnection(config);
    updateConfig(config.id, result);
    addActivity(result.message ?? 'Connection test completed.', result.status === 'success' ? 'success' : 'error');
  };

  const saveConfiguration = async () => {
    setIsSaving(true);
    addActivity('Saving LLM configuration through backend/OpenBao proxy.');

    try {
      const saved = await llmConfigService.save(normalizeConfigs(configs));
      setConfigs(saved);
      setBanner({
        severity: 'success',
        message: appConfig.useMockServices ? 'Configuration saved in mock storage.' : 'Configuration saved to OpenBao.',
      });
      addActivity(`Saved ${saved.length} endpoint configuration(s).`, 'success');
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
    addActivity('Clearing stored LLM secrets through backend/OpenBao proxy.');

    try {
      await llmConfigService.clearSecrets();
      const sanitized = normalizeConfigs(await llmConfigService.list());
      setConfigs(sanitized);
      setBanner({
        severity: 'info',
        message: appConfig.useMockServices ? 'Stored mock secrets were cleared.' : 'OpenBao LLM secrets were cleared.',
      });
      addActivity('Stored LLM secrets were cleared.', 'success');
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
    addActivity(`Retrieving configuration metadata from ${appConfig.openBaoUrl || 'backend OpenBao proxy'}.`);

    try {
      const retrievedConfigs = normalizeConfigs(await llmConfigService.retrieveConfiguration());
      setConfigs(retrievedConfigs);
      setActiveConfigId((current) => retrievedConfigs.find((config) => config.id === current)?.id ?? retrievedConfigs[0]?.id ?? '');
      setSelectedChatConfigId(
        (current) => retrievedConfigs.find((config) => config.id === current)?.id ?? retrievedConfigs[0]?.id ?? '',
      );
      setBanner({
        severity: 'success',
        message: `Retrieved configuration metadata from ${appConfig.openBaoUrl || 'mock OpenBao'}.`,
      });
      addActivity(`Retrieved ${retrievedConfigs.length} endpoint metadata record(s).`, 'success');
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
          Agent Setup
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
        <section style={summaryGridStyle} aria-label="Retrieved OpenBao token summary">
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
              <strong>{config.name.trim() || `Endpoint ${index + 1}`}</strong>
              <span>{config.secretName ?? 'No OpenBao path yet'}</span>
              <span>
                Token: {config.tokenStored ? config.tokenPreview ?? 'stored' : 'not stored'}
              </span>
              <span>Model: {config.model || 'not set'}</span>
              <span>Version: {config.secretVersion ? `v${config.secretVersion}` : 'none'}</span>
            </button>
          ))}
        </section>

        {activeConfig && (
          <section key={activeConfig.id} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0 }}>LLM Endpoint {activeConfigIndex + 1}</h2>
                <p style={{ margin: '6px 0 0', color: '#667085' }}>Tier: {tierLabels[activeConfig.tier]}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ ...pillStyle, ...statusStyles[activeConfig.status] }}>
                  {activeConfig.status === 'idle' ? 'Not tested' : activeConfig.status}
                </span>
              </div>
            </div>

            <div style={metadataGridStyle}>
              <MetadataItem label="OpenBao secret" value={activeConfig.secretName ?? 'Not stored yet'} />
              <MetadataItem label="Version" value={activeConfig.secretVersion ? `v${activeConfig.secretVersion}` : 'None'} />
              <MetadataItem label="Added" value={formatDate(activeConfig.secretCreatedAt)} />
              <MetadataItem label="Updated" value={formatDate(activeConfig.secretUpdatedAt)} />
              <MetadataItem label="Last retrieved" value={formatDate(activeConfig.secretLastRetrievedAt)} />
              <MetadataItem label="Lease status" value={activeConfig.secretLeaseStatus ?? 'none'} />
              <MetadataItem
                label="Token"
                value={activeConfig.tokenStored ? activeConfig.tokenPreview ?? 'Stored in OpenBao' : 'Not stored'}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
              <div style={{ ...readOnlyFieldStyle, gridColumn: 'span 6' }}>
                <span style={readOnlyLabelStyle}>System name</span>
                <strong>{activeConfig.name}</strong>
              </div>
              <div style={{ ...readOnlyFieldStyle, gridColumn: 'span 6' }}>
                <span style={readOnlyLabelStyle}>Fixed tier</span>
                <strong>{tierLabels[activeConfig.tier]}</strong>
              </div>
              <label style={{ ...fieldStyle, gridColumn: 'span 12' }}>
                Base URL
                <input
                  value={activeConfig.endpoint}
                  onChange={(event) => updateConfig(activeConfig.id, { endpoint: event.target.value })}
                  placeholder="https://api.cborg.lbl.gov"
                  style={inputStyle}
                />
                <span style={{ color: '#667085', fontSize: 12, fontWeight: 400 }}>
                  Enter the OpenAI-compatible base URL. The backend will call /chat/completions.
                </span>
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 12' }}>
                Model
                <input
                  value={activeConfig.model}
                  onChange={(event) => updateConfig(activeConfig.id, { model: event.target.value })}
                  placeholder="openai/gpt-4.1, anthropic/claude-sonnet, ..."
                  style={inputStyle}
                />
              </label>
              <label style={{ ...fieldStyle, gridColumn: 'span 12' }}>
                API token
                <input
                  type="password"
                  value={activeConfig.token}
                  onChange={(event) => updateConfig(activeConfig.id, { token: event.target.value })}
                  style={inputStyle}
                />
                <span style={{ color: '#667085', fontSize: 12, fontWeight: 400 }}>
                  Leave blank to keep the existing OpenBao token. Enter a new value only when rotating or setting it.
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
              Ask a quick question against one configured endpoint before using it in the workflow.
            </p>
          </div>
          <label style={{ ...fieldStyle, minWidth: 280 }}>
            Test endpoint
            <select
              value={selectedChatConfigId}
              onChange={(event) => setSelectedChatConfigId(event.target.value)}
              style={inputStyle}
            >
              {configs.map((config, index) => (
                <option key={config.id} value={config.id}>
                  {config.name.trim() || `LLM Endpoint ${index + 1}`} ({tierLabels[config.tier]})
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
              Shows OpenBao/backend proxy actions triggered from this screen.
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
        <section style={cardStyle}>
          <p style={{ margin: '0 0 20px', color: '#667085' }}>
            Configure agent behavior for the workflow. This tab is ready for agent-specific settings that should
            remain separate from LLM endpoint credentials.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 16 }}>
            <div style={{ ...readOnlyFieldStyle, gridColumn: 'span 6' }}>
              <span style={readOnlyLabelStyle}>Configuration scope</span>
              <strong>Workflow agents</strong>
            </div>
            <div style={{ ...readOnlyFieldStyle, gridColumn: 'span 6' }}>
              <span style={readOnlyLabelStyle}>Status</span>
              <strong>Not configured yet</strong>
            </div>
          </div>
        </section>
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
