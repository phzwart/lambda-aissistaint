import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';

const plannerIdPattern = /^[A-Za-z0-9_-]{1,80}$/;
const textFileMaxBytes = 128 * 1024;

const splitConfiguredDirectories = (raw) =>
  String(raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const configuredPlannerRepoDirectories = (plannerRaw, agentRaw, cwd = process.cwd()) => {
  const configured = splitConfiguredDirectories(plannerRaw || agentRaw).map((directory) => resolve(cwd, directory));
  if (configured.length > 0) {
    return configured;
  }

  const defaultDirectory = resolve(cwd, 'agent-repo');
  return existsSync(defaultDirectory) ? [defaultDirectory] : [];
};

const parseJsonFile = (path) => JSON.parse(readFileSync(path, 'utf8'));

const trimBounded = (value, label, maxLength, { required = false } = {}) => {
  const trimmed = String(value ?? '').trim();
  if (required && !trimmed) {
    throw new Error(`${label} is required.`);
  }
  if (trimmed.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or less.`);
  }
  return trimmed;
};

const splitList = (value, maxItems = 50) => {
  const list = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n|,/);
  return list
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, maxItems);
};

const safeResolve = (root, relativePath, label) => {
  const value = trimBounded(relativePath, label, 240, { required: true });
  if (value.startsWith('/') || value.includes('\0')) {
    throw new Error(`${label} must be a relative path.`);
  }

  const resolved = resolve(root, value);
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  if (resolved !== root && !resolved.startsWith(normalizedRoot)) {
    throw new Error(`${label} must stay within the repository directory.`);
  }
  return resolved;
};

const readOptionalTextFile = (path, label) => {
  if (!existsSync(path)) {
    return '';
  }
  const stat = statSync(path);
  if (!stat.isFile()) {
    throw new Error(`${label} must be a file.`);
  }
  if (stat.size > textFileMaxBytes) {
    throw new Error(`${label} is too large.`);
  }
  return readFileSync(path, 'utf8');
};

const normalizeModelRoles = (value) => {
  const roles = splitList(value, 10);
  return roles.length ? roles : ['planner', 'worker', 'summarizer'];
};

const normalizePlannerSpec = ({ repoDirectory, plannerDirectory }) => {
  const manifestPath = resolve(plannerDirectory, 'planner.json');
  if (!existsSync(manifestPath)) {
    throw new Error('planner.json is required.');
  }

  const manifest = parseJsonFile(manifestPath);
  const id = trimBounded(manifest.id, 'Planner id', 80, { required: true });
  if (!plannerIdPattern.test(id)) {
    throw new Error('Planner id contains unsupported characters.');
  }

  const configFiles = splitList(manifest.configFiles, 20);
  const files = configFiles.map((relativePath) => {
    const filePath = safeResolve(plannerDirectory, relativePath, 'Planner config file');
    return {
      path: relativePath,
      content: readOptionalTextFile(filePath, `Planner config file ${relativePath}`),
    };
  });

  return {
    id,
    name: trimBounded(manifest.name, 'Planner name', 120, { required: true }),
    version: trimBounded(manifest.version || '0.1.0', 'Planner version', 80),
    description: trimBounded(manifest.description, 'Planner description', 1024),
    engine: trimBounded(manifest.engine || 'goose', 'Planner engine', 80, { required: true }),
    modelRoles: normalizeModelRoles(manifest.modelRoles),
    defaultContext: {
      strategy: ['summarize', 'truncate', 'clear', 'prompt'].includes(manifest.defaultContext?.strategy)
        ? manifest.defaultContext.strategy
        : 'summarize',
      maxTurns: Number.parseInt(manifest.defaultContext?.maxTurns ?? '50', 10) || 50,
      subagentMaxTurns: Number.parseInt(manifest.defaultContext?.subagentMaxTurns ?? '25', 10) || 25,
    },
    skillPolicy: {
      defaultVisibility: manifest.skillPolicy?.defaultVisibility === 'all-enabled' ? 'all-enabled' : 'project-enabled',
      allowedSkillIds: splitList(manifest.skillPolicy?.allowedSkillIds, 100),
      allowedCategories: splitList(manifest.skillPolicy?.allowedCategories, 30),
    },
    workspacePolicy: {
      mode: trimBounded(manifest.workspacePolicy?.mode || 'project-workspace', 'Workspace mode', 80),
      readOnly: Boolean(manifest.workspacePolicy?.readOnly),
      requiresProject: manifest.workspacePolicy?.requiresProject !== false,
    },
    runtime: {
      requiredEnv: splitList(manifest.runtime?.requiredEnv, 30),
      restartRequiredKeys: splitList(manifest.runtime?.restartRequiredKeys, 30),
    },
    responseSchema: manifest.responseSchema && typeof manifest.responseSchema === 'object' ? manifest.responseSchema : undefined,
    configFiles,
    files,
    origin: {
      directory: plannerDirectory,
      repoDirectory,
    },
  };
};

export const loadPlannerSpecCatalog = ({ directories, logger = console } = {}) => {
  const specs = [];
  const warnings = [];

  for (const repoDirectory of directories ?? configuredPlannerRepoDirectories(process.env.PLANNER_REPO_DIRECTORIES, process.env.AGENT_REPO_DIRECTORIES)) {
    const resolvedDirectory = resolve(repoDirectory);
    const plannersRoot = resolve(resolvedDirectory, 'planners');
    if (!existsSync(plannersRoot)) {
      continue;
    }

    try {
      for (const entry of readdirSync(plannersRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        const plannerDirectory = resolve(plannersRoot, entry.name);
        try {
          specs.push(normalizePlannerSpec({ repoDirectory: resolvedDirectory, plannerDirectory }));
        } catch (error) {
          warnings.push({
            directory: plannerDirectory,
            message: error instanceof Error ? error.message : 'Invalid planner spec.',
          });
        }
      }
    } catch (error) {
      warnings.push({
        directory: plannersRoot,
        message: error instanceof Error ? error.message : 'Invalid planner repository.',
      });
    }
  }

  for (const warning of warnings) {
    logger.warn?.('Planner repository warning', warning);
  }

  return { specs, warnings };
};
