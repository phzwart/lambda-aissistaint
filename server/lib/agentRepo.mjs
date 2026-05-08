import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';

const skillIdPattern = /^[A-Za-z0-9_-]{1,80}$/;
const textFileMaxBytes = 256 * 1024;

const defaultExecutable = () => ({
  mode: 'none',
  args: [],
  timeoutSeconds: 120,
  network: 'none',
  envAllowlist: [],
});

const splitConfiguredDirectories = (raw) =>
  String(raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const configuredAgentRepoDirectories = (raw, cwd = process.cwd()) => {
  const configured = splitConfiguredDirectories(raw).map((directory) => resolve(cwd, directory));
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

const splitList = (value, maxItems = 30) => {
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

const readTextFile = (path, label) => {
  const stat = statSync(path);
  if (!stat.isFile()) {
    throw new Error(`${label} must be a file.`);
  }
  if (stat.size > textFileMaxBytes) {
    throw new Error(`${label} is too large.`);
  }
  return readFileSync(path, 'utf8');
};

const normalizeExecutor = (input = {}, executorCatalog = []) => {
  const mode = input.mode === 'catalog' ? 'catalog' : 'none';
  if (mode === 'none') {
    return defaultExecutable();
  }

  const catalogId = trimBounded(input.catalogId, 'Executor catalog id', 80, { required: true });
  const catalogItem = executorCatalog.find((item) => item.id === catalogId);
  if (!catalogItem) {
    throw new Error(`Executor catalog id ${catalogId} is not approved.`);
  }

  return {
    mode,
    catalogId,
    image: catalogItem.image,
    command: catalogItem.command,
    args: Array.isArray(catalogItem.args) ? catalogItem.args : [],
    workingDir: catalogItem.workingDir,
    timeoutSeconds: catalogItem.timeoutSeconds,
    network: catalogItem.network,
    envAllowlist: Array.isArray(catalogItem.envAllowlist) ? catalogItem.envAllowlist : [],
  };
};

const loadSkillDirectory = ({ repoDirectory, repoManifest, skillDirectory, executorCatalog }) => {
  const manifestPath = resolve(skillDirectory, 'skill.json');
  if (!existsSync(manifestPath)) {
    throw new Error('skill.json is required.');
  }

  const manifest = parseJsonFile(manifestPath);
  const id = trimBounded(manifest.id, 'Skill id', 80, { required: true });
  if (!skillIdPattern.test(id)) {
    throw new Error('Skill id contains unsupported characters.');
  }

  const entrypoint = trimBounded(manifest.entrypoint || 'SKILL.md', 'Skill entrypoint', 240, { required: true });
  const entrypointPath = safeResolve(skillDirectory, entrypoint, 'Skill entrypoint');
  const skillMd = readTextFile(entrypointPath, 'Skill entrypoint');
  const supportFiles = splitList(manifest.files, 50).map((relativePath) => {
    const filePath = safeResolve(skillDirectory, relativePath, 'Skill support file');
    return {
      path: relativePath,
      content: readTextFile(filePath, `Skill support file ${relativePath}`),
    };
  });

  const repoName = trimBounded(repoManifest.name || 'Agent Repository', 'Repository name', 120);
  const version = trimBounded(manifest.version || repoManifest.version || '0.1.0', 'Skill version', 80);
  const name = trimBounded(manifest.name, 'Skill name', 120, { required: true });
  const description = trimBounded(manifest.description, 'Skill description', 1024);
  const category = trimBounded(manifest.category || 'General', 'Category', 80);
  const status = manifest.status === 'draft' ? 'draft' : 'enabled';
  const directoryName = basename(skillDirectory);

  return {
    id,
    name,
    description,
    category,
    status,
    source: 'package',
    editable: false,
    origin: {
      repoName,
      directory: skillDirectory,
      version,
    },
    capabilities: splitList(manifest.capabilities, 30),
    purpose: description || `${name} repository skill.`,
    whenToUse: trimBounded(manifest.whenToUse, 'When to use', 2000),
    inputs: splitList(manifest.inputs, 30),
    procedure: skillMd,
    expectedOutput: trimBounded(manifest.expectedOutput, 'Expected output', 2000),
    safetyConstraints: trimBounded(manifest.safetyConstraints, 'Safety constraints', 3000),
    requiredTools: splitList(manifest.requiredTools, 30),
    executable: normalizeExecutor(manifest.executor, executorCatalog),
    skillPackage: {
      directoryName,
      skillMd,
      files: [
        {
          path: entrypoint,
          content: skillMd,
        },
        ...supportFiles,
      ],
    },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
};

const loadRepository = ({ repoDirectory, executorCatalog }) => {
  const warnings = [];
  const manifestPath = resolve(repoDirectory, 'repo.json');
  if (!existsSync(manifestPath)) {
    throw new Error('repo.json is required.');
  }

  const manifest = parseJsonFile(manifestPath);
  const repo = {
    name: trimBounded(manifest.name || basename(repoDirectory), 'Repository name', 120),
    version: trimBounded(manifest.version || '0.1.0', 'Repository version', 80),
    description: trimBounded(manifest.description, 'Repository description', 1024),
    directory: repoDirectory,
    skillsPath: trimBounded(manifest.skillsPath || 'skills', 'Repository skills path', 120),
    templatesPath: trimBounded(manifest.templatesPath || 'templates', 'Repository templates path', 120),
    skillCount: 0,
  };

  const skillsRoot = safeResolve(repoDirectory, repo.skillsPath, 'Repository skills path');
  const skills = [];
  if (existsSync(skillsRoot)) {
    for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillDirectory = resolve(skillsRoot, entry.name);
      try {
        skills.push(loadSkillDirectory({ repoDirectory, repoManifest: repo, skillDirectory, executorCatalog }));
      } catch (error) {
        warnings.push({
          directory: skillDirectory,
          message: error instanceof Error ? error.message : 'Invalid repository skill.',
        });
      }
    }
  }

  repo.skillCount = skills.length;
  return { repo, skills, warnings };
};

export const loadAgentRepoCatalog = ({ directories, executorCatalog = [], logger = console } = {}) => {
  const repos = [];
  const skills = [];
  const warnings = [];

  for (const repoDirectory of directories ?? configuredAgentRepoDirectories(process.env.AGENT_REPO_DIRECTORIES)) {
    try {
      const resolvedDirectory = resolve(repoDirectory);
      if (!existsSync(resolvedDirectory) || !statSync(resolvedDirectory).isDirectory()) {
        warnings.push({ directory: resolvedDirectory, message: 'Repository directory does not exist.' });
        continue;
      }

      const loaded = loadRepository({ repoDirectory: resolvedDirectory, executorCatalog });
      repos.push(loaded.repo);
      skills.push(...loaded.skills);
      warnings.push(...loaded.warnings);
    } catch (error) {
      warnings.push({
        directory: repoDirectory,
        message: error instanceof Error ? error.message : 'Invalid agent repository.',
      });
    }
  }

  for (const warning of warnings) {
    logger.warn?.('Agent repository warning', warning);
  }

  return { repos, skills, warnings };
};
