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
  category: string;
  status: AgentSkillStatus;
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

export interface ProjectAgentSkillBinding {
  skillId: string;
  enabled: boolean;
  priority: number;
  notes?: string;
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
