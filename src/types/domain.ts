export type LlmTier = 'a' | 'b' | 'c';

export type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

export interface UserSession {
  id: string;
  name: string;
  email: string;
  accessToken: string;
}

export interface LlmConfig {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  modelAlias?: string;
  token: string;
  tier: LlmTier;
  status: ConnectionStatus;
  secretName?: string;
  secretVersion?: number;
  secretCreatedAt?: string;
  secretUpdatedAt?: string;
  secretLastRetrievedAt?: string;
  secretLeaseStatus?: 'none' | 'stored' | 'retrieved' | 'cleared';
  tokenStored?: boolean;
  tokenPreview?: string;
  lastTestedAt?: string;
  message?: string;
}

export type FileProcessingStatus = 'uploaded' | 'processing' | 'completed' | 'failed';

export interface ManagedFile {
  id: string;
  name: string;
  size: number;
  uploadedAt: string;
  status: FileProcessingStatus;
  objectKey?: string;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  summary: string;
  linkedDocumentIds: string[];
  updatedAt: string;
}

export interface QaAnswer {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

export interface GooseChatMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface GooseChatResponse {
  message: GooseChatMessage;
  modelAlias: string;
  tier: LlmTier;
  gooseSessionId?: string;
}

export type AgentSkillStatus = 'draft' | 'enabled';

export type AgentSkillExecutorMode = 'none' | 'catalog' | 'custom';

export type AgentSkillNetworkPolicy = 'none' | 'egress';

export interface AgentSkillExecutable {
  mode: AgentSkillExecutorMode;
  catalogId?: string;
  image?: string;
  command?: string;
  args: string[];
  workingDir?: string;
  timeoutSeconds: number;
  network: AgentSkillNetworkPolicy;
  envAllowlist: string[];
}

export interface AgentSkillPackageFile {
  path: string;
  content: string;
}

export interface AgentSkillPackage {
  directoryName: string;
  skillMd: string;
  files: AgentSkillPackageFile[];
}

export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  category: string;
  status: AgentSkillStatus;
  source?: 'user' | 'package';
  editable?: boolean;
  origin?: {
    repoName?: string;
    directory?: string;
    version?: string;
  };
  capabilities?: string[];
  purpose: string;
  whenToUse: string;
  inputs: string[];
  procedure: string;
  expectedOutput: string;
  safetyConstraints: string;
  requiredTools: string[];
  executable: AgentSkillExecutable;
  skillPackage: AgentSkillPackage;
  createdAt: string;
  updatedAt: string;
}

export interface PaperReaderProcessingConfig {
  extendedAbstractInstruction?: string;
  followUpQuestionsInstruction?: string;
  extendedAbstractEnabled?: boolean;
  followUpQuestionsEnabled?: boolean;
}

export interface ProjectAgentSkillBinding {
  skillId: string;
  enabled: boolean;
  priority: number;
  notes?: string;
  processingConfig?: PaperReaderProcessingConfig;
}

export interface AgentExecutorCatalogItem {
  id: string;
  name: string;
  description: string;
  image: string;
  command: string;
  args: string[];
  workingDir: string;
  timeoutSeconds: number;
  network: AgentSkillNetworkPolicy;
  envAllowlist: string[];
}

export interface AgentRepository {
  name: string;
  version: string;
  description: string;
  directory: string;
  skillsPath: string;
  templatesPath: string;
  skillCount: number;
}

export interface PlannerSpec {
  id: string;
  name: string;
  version: string;
  description: string;
  engine: 'goose' | string;
  modelRoles: string[];
  defaultContext: {
    strategy: 'summarize' | 'truncate' | 'clear' | 'prompt';
    maxTurns: number;
    subagentMaxTurns: number;
  };
  skillPolicy: {
    defaultVisibility: 'project-enabled' | 'all-enabled';
    allowedSkillIds: string[];
    allowedCategories: string[];
  };
  workspacePolicy: {
    mode: 'project-workspace' | 'goose-workspace' | 'read-only' | string;
    readOnly: boolean;
    requiresProject: boolean;
  };
  runtime: {
    requiredEnv: string[];
    restartRequiredKeys: string[];
  };
  responseSchema?: Record<string, unknown>;
  configFiles: string[];
  files?: { path: string; content: string }[];
  origin?: {
    directory?: string;
    repoDirectory?: string;
  };
}

export interface PlannerConfig {
  specId: string;
  roleBindings: Record<string, string>;
  contextPolicy: {
    strategy: 'summarize' | 'truncate' | 'clear' | 'prompt';
    maxTurns: number;
    subagentMaxTurns: number;
  };
  skillPolicy: {
    visibility: 'project-enabled' | 'all-enabled' | 'allowlist';
    allowedSkillIds: string[];
    allowedCategories: string[];
  };
  workspaceMode: 'project-workspace' | 'goose-workspace' | 'read-only';
  updatedAt?: string;
}

export interface PlannerModelAlias {
  alias: string;
  tier: LlmTier;
  configured: boolean;
}

export interface PlannerConfigResponse {
  config: PlannerConfig | null;
  globalConfig: PlannerConfig | null;
  projectConfig: PlannerConfig | null;
  spec: PlannerSpec | null;
  modelAliases: PlannerModelAlias[];
  warnings: { directory: string; message: string }[];
}

export type WikiCategory = 'entities' | 'concepts' | 'projects' | 'protocols' | 'datasets' | 'people';

export interface WikiPageSummary {
  key: string;
  category: WikiCategory;
  slug: string;
  title: string;
  updated: string | null;
  created: string | null;
  sources: string[];
  related: string[];
  confidence: number | null;
}

export interface WikiPageDetail {
  key: string;
  category: WikiCategory;
  slug: string;
  frontmatter: Record<string, unknown>;
  body: string;
  markdown: string;
}

export interface WikiBacklink {
  from: string;
  label: string;
  count: number;
}

export interface WikiProvenanceEntry {
  sectionId: string;
  sourceId: string;
  sourceTitle: string | null;
  chunkIds: string[];
  confidence: number | null;
  recordedAt: string;
}

export interface WikiPageResponse {
  page: WikiPageDetail;
  backlinks: WikiBacklink[];
  provenance: WikiProvenanceEntry[];
}

export interface WikiProcessedSource {
  fileId: string;
  fileName: string;
  objectKey: string;
  status: FileProcessingStatus;
  hasSummary: boolean;
  wikiPageKey: string | null;
  wikiIngestedAt: string | null;
}

export interface WikiSyncProcessedResponse {
  ingested: Array<{ fileId: string; fileName: string; pageKey: string; fallback: boolean }>;
  skipped: Array<{ fileId: string; fileName: string; reason: string; pageKey?: string }>;
  errors: Array<{ fileId: string; fileName: string; error: string }>;
}

export interface WikiIngestRequest {
  sourceId?: string;
  title: string;
  text?: string;
  chunks?: { id?: string; text: string }[];
  category?: WikiCategory;
  slug?: string;
}

export interface WikiIngestResponse {
  pageKey: string;
  category: WikiCategory;
  slug: string;
  sectionId: string;
  createdStubs: { category: WikiCategory; slug: string; title: string }[];
  backlinkCount: number;
  pageCount: number;
  llmUsed: boolean;
  suggestion: {
    title: string;
    category: WikiCategory;
    summary: string;
    confidence: number | null;
    fallback: boolean;
    related: { category: WikiCategory; title: string }[];
  };
}

export interface WikiQueryCitedPage {
  key: string;
  category: WikiCategory;
  slug: string;
  title: string;
  score: number;
  sources: string[];
}

export interface WikiQueryResponse {
  answer: string;
  citedPages: WikiQueryCitedPage[];
  llmUsed: boolean;
}

export interface WikiBacklinksResponse {
  backlinks: Record<string, WikiBacklink[]>;
  ingestLog: {
    at: string;
    sourceId: string;
    sourceTitle: string | null;
    affectedPages: string[];
    action: string;
    confidence: number | null;
    notes: string | null;
  }[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'archived';
  bucketName?: string;
  loadedPrefix?: string;
  parsedPrefix?: string;
  metadataObjectKey?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
