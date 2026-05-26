import { randomUUID } from 'node:crypto';
import { loadAgentRepoCatalog } from '../lib/agentRepo.mjs';
import {
  PAPER_READER_SKILL_ID,
  normalizePaperReaderProcessingConfig,
} from '../lib/paperReaderProcessingConfig.mjs';

const agentSkillIdPattern = /^[A-Za-z0-9_-]{1,80}$/;

const defaultAgentSkillExecutable = () => ({
  mode: 'none',
  args: [],
  timeoutSeconds: 120,
  network: 'none',
  envAllowlist: [],
});

const splitLines = (value) =>
  Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : String(value ?? '')
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);

const trimBounded = (value, label, maxLength, { required = false } = {}) => {
  const trimmed = String(value ?? '').trim();
  if (required && !trimmed) {
    throw Object.assign(new Error(`${label} is required.`), { status: 400 });
  }
  if (trimmed.length > maxLength) {
    throw Object.assign(new Error(`${label} must be ${maxLength} characters or less.`), { status: 400 });
  }
  return trimmed;
};

const validateEnvAllowlist = (values) => {
  const envNames = splitLines(values);
  for (const name of envNames) {
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(name)) {
      throw Object.assign(new Error(`Invalid environment variable allowlist entry: ${name}.`), { status: 400 });
    }
  }
  return envNames;
};

const slugifySkillName = (value, fallbackId) => {
  const slug = String(value || fallbackId || 'agent-skill')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'agent-skill';
};

const yamlQuote = (value) => JSON.stringify(String(value ?? ''));

const skillDescription = (skill) => {
  const purpose = skill.purpose || `${skill.name} agent skill.`;
  const when = skill.whenToUse ? ` Use when ${skill.whenToUse.replace(/\.$/, '')}.` : '';
  return `${purpose}${when}`.replace(/\s+/g, ' ').trim().slice(0, 1024);
};

const renderListSection = (title, values) => {
  if (!values.length) {
    return '';
  }
  return `\n## ${title}\n\n${values.map((value) => `- ${value}`).join('\n')}\n`;
};

const renderExecutableSection = (executable) => {
  if (!executable || executable.mode === 'none') {
    return '';
  }

  const lines = [
    '\n## Executable',
    '',
    `Mode: ${executable.mode}`,
    executable.catalogId ? `Catalog id: ${executable.catalogId}` : '',
    executable.image ? `Container image: ${executable.image}` : '',
    executable.command ? `Command: \`${[executable.command, ...(executable.args ?? [])].join(' ')}\`` : '',
    executable.workingDir ? `Working directory: \`${executable.workingDir}\`` : '',
    `Timeout: ${executable.timeoutSeconds} seconds`,
    `Network: ${executable.network}`,
    executable.envAllowlist?.length ? `Allowed environment names: ${executable.envAllowlist.join(', ')}` : '',
    '',
    'Treat this executable as an approved runtime declaration. Do not add secrets to arguments or environment values.',
  ].filter(Boolean);

  return `${lines.join('\n')}\n`;
};

const renderSkillPackage = (skill) => {
  const directoryName = slugifySkillName(skill.name, skill.id);
  const description = skillDescription(skill);
  const skillMd = `---
name: ${directoryName}
description: ${yamlQuote(description)}
disable-model-invocation: true
---

# ${skill.name || directoryName}

## Purpose

${skill.purpose || 'Describe what this skill does.'}

## When To Use

${skill.whenToUse || 'Describe when the agent should use this skill.'}
${renderListSection('Inputs', skill.inputs)}
## Procedure

${skill.procedure || 'Describe the steps the agent should follow.'}

## Expected Output

${skill.expectedOutput || 'Describe the expected output.'}

## Safety Constraints

${skill.safetyConstraints || 'Follow project safety and data handling requirements.'}
${renderListSection('Required Tools', skill.requiredTools)}${renderExecutableSection(skill.executable)}`;

  return {
    directoryName,
    skillMd,
    files: [
      {
        path: 'SKILL.md',
        content: skillMd,
      },
    ],
  };
};

export const createAgentSkillsService = ({ config, services }) => {
  const { secrets } = services;
  const {
    agentRepoDirectories,
    agentExecutorCatalogJson,
    paperqa2RunnerImage,
    allowedCustomExecutorRegistries,
    allowCustomAgentExecutorRegistries,
  } = config;

  const defaultAgentExecutorCatalog = [
    {
      id: 'python-sandbox',
      name: 'Python Sandbox',
      description: 'Runs short Python helpers in a constrained workspace container.',
      image: 'ghcr.io/aissistaint/python-sandbox:latest',
      command: 'python',
      args: ['-m', 'aissistaint_skill_runner'],
      workingDir: '/workspace',
      timeoutSeconds: 120,
      network: 'none',
      envAllowlist: [],
    },
    {
      id: 'paperqa2-paper-reader',
      name: 'PaperQA2 Paper Reader',
      description: 'Runs the one-paper PaperQA2 summary workflow in a constrained Podman container.',
      image: paperqa2RunnerImage,
      command: 'paper-reader-summary',
      args: [],
      workingDir: '/workspace',
      timeoutSeconds: 900,
      network: 'egress',
      envAllowlist: ['PAPERQA_LITELLM_URL', 'PAPERQA_LITELLM_API_KEY'],
    },
  ];

  const parseAgentExecutorCatalog = () => {
    if (!agentExecutorCatalogJson) {
      return defaultAgentExecutorCatalog;
    }

    try {
      const parsed = JSON.parse(agentExecutorCatalogJson);
      return Array.isArray(parsed) ? parsed : defaultAgentExecutorCatalog;
    } catch {
      console.warn('AGENT_EXECUTOR_CATALOG_JSON is not valid JSON. Using default agent executor catalog.');
      return defaultAgentExecutorCatalog;
    }
  };

  const agentExecutorCatalog = parseAgentExecutorCatalog();

  const loadAgentRepositories = () =>
    loadAgentRepoCatalog({
      directories: agentRepoDirectories,
      executorCatalog: agentExecutorCatalog,
      logger: console,
    });

  const validateExecutorImage = (image) => {
    const trimmed = trimBounded(image, 'Container image', 240, { required: true });
    if (trimmed.includes(' ') || trimmed.includes('..')) {
      throw Object.assign(new Error('Container image contains invalid characters.'), { status: 400 });
    }

    const registry = trimmed.includes('/') ? trimmed.split('/')[0].toLowerCase() : 'docker.io';
    if (!allowCustomAgentExecutorRegistries && !allowedCustomExecutorRegistries.includes(registry)) {
      throw Object.assign(new Error(`Container image registry ${registry} is not allowed.`), { status: 400 });
    }
    return trimmed;
  };

  const normalizeAgentExecutable = (input = {}) => {
    const mode = ['none', 'catalog', 'custom'].includes(input.mode) ? input.mode : 'none';
    if (mode === 'none') {
      return defaultAgentSkillExecutable();
    }

    const timeoutSeconds = Math.min(Math.max(Number.parseInt(input.timeoutSeconds ?? '120', 10) || 120, 10), 900);
    const network = input.network === 'egress' ? 'egress' : 'none';
    const args = splitLines(input.args).slice(0, 20);
    const envAllowlist = validateEnvAllowlist(input.envAllowlist).slice(0, 30);

    if (mode === 'catalog') {
      const catalogId = trimBounded(input.catalogId, 'Executor catalog item', 80, { required: true });
      const catalogItem = agentExecutorCatalog.find((item) => item.id === catalogId);
      if (!catalogItem) {
        throw Object.assign(new Error('Selected executor catalog item is not available.'), { status: 400 });
      }
      return {
        mode,
        catalogId,
        image: catalogItem.image,
        command: catalogItem.command,
        args: args.length ? args : catalogItem.args,
        workingDir: catalogItem.workingDir,
        timeoutSeconds,
        network: catalogItem.network,
        envAllowlist,
      };
    }

    const workingDir = trimBounded(input.workingDir || '/workspace', 'Working directory', 120);
    if (!workingDir.startsWith('/workspace')) {
      throw Object.assign(new Error('Custom executors must use a working directory under /workspace.'), { status: 400 });
    }

    return {
      mode,
      image: validateExecutorImage(input.image),
      command: trimBounded(input.command, 'Command', 120, { required: true }),
      args,
      workingDir,
      timeoutSeconds,
      network,
      envAllowlist,
    };
  };

  const normalizeAgentSkill = (input = {}, existing = {}) => {
    const now = new Date().toISOString();
    const id = String(input.id || existing.id || randomUUID());
    if (!agentSkillIdPattern.test(id)) {
      throw Object.assign(new Error('Skill id contains unsupported characters.'), { status: 400 });
    }

    const status = input.status === 'enabled' ? 'enabled' : 'draft';
    const skill = {
      id,
      name: trimBounded(input.name, 'Skill name', 120, { required: status === 'enabled' }),
      description: trimBounded(input.description, 'Skill description', 1024),
      category: trimBounded(input.category || 'General', 'Category', 80),
      status,
      source: 'user',
      editable: true,
      origin: input.origin && input.source === 'package' ? undefined : input.origin,
      capabilities: splitLines(input.capabilities).slice(0, 30),
      purpose: trimBounded(input.purpose, 'Purpose', 2000, { required: status === 'enabled' }),
      whenToUse: trimBounded(input.whenToUse, 'When to use', 2000, { required: status === 'enabled' }),
      inputs: splitLines(input.inputs).slice(0, 30),
      procedure: trimBounded(input.procedure, 'Procedure', 6000, { required: status === 'enabled' }),
      expectedOutput: trimBounded(input.expectedOutput, 'Expected output', 2000),
      safetyConstraints: trimBounded(input.safetyConstraints, 'Safety constraints', 3000),
      requiredTools: splitLines(input.requiredTools).slice(0, 30),
      executable: normalizeAgentExecutable(input.executable),
      skillPackage:
        input.skillPackage ?? existing.skillPackage ?? { directoryName: 'agent-skill', skillMd: '', files: [] },
      createdAt: existing.createdAt || input.createdAt || now,
      updatedAt: now,
    };

    if (skill.status === 'enabled' && skill.executable.mode === 'custom' && !skill.safetyConstraints) {
      throw Object.assign(new Error('Safety constraints are required before enabling a custom executable skill.'), {
        status: 400,
      });
    }

    return {
      ...skill,
      skillPackage: renderSkillPackage(skill),
    };
  };

  const readAgentSkillIndex = async (user) => {
    const secret = await secrets.read(secrets.agentSkillIndexPath(user));
    const ids = secret?.data?.data?.ids;
    return Array.isArray(ids) ? ids.filter((id) => agentSkillIdPattern.test(String(id))) : [];
  };

  const writeAgentSkillIndex = async (user, ids) => {
    const uniqueIds = [...new Set(ids.filter((id) => agentSkillIdPattern.test(String(id))))];
    await secrets.write(secrets.agentSkillIndexPath(user), {
      ids: uniqueIds,
      updatedAt: new Date().toISOString(),
    });
    return uniqueIds;
  };

  const readAgentSkills = async (user) => {
    const ids = await readAgentSkillIndex(user);
    const skills = await Promise.all(
      ids.map(async (id) => {
        const secret = await secrets.read(secrets.agentSkillPath(user, id));
        return secret?.data?.data ?? null;
      }),
    );
    return skills.filter(Boolean).map((skill) => ({
      source: 'user',
      editable: true,
      capabilities: [],
      description: '',
      ...skill,
      source: 'user',
      editable: true,
    }));
  };

  const normalizeProjectSkillBindings = (bindings, skills) => {
    const skillIds = new Set(skills.map((skill) => skill.id));
    return (Array.isArray(bindings) ? bindings : [])
      .filter((binding) => skillIds.has(String(binding.skillId ?? '')))
      .map((binding, index) => {
        const skillId = String(binding.skillId);
        const normalized = {
          skillId,
          enabled: Boolean(binding.enabled),
          priority: Number.isFinite(Number(binding.priority)) ? Number(binding.priority) : index + 1,
          notes: trimBounded(binding.notes, 'Binding notes', 500),
        };
        if (skillId === PAPER_READER_SKILL_ID && binding.processingConfig) {
          const processingConfig = normalizePaperReaderProcessingConfig(binding.processingConfig);
          if (processingConfig) {
            normalized.processingConfig = processingConfig;
          }
        }
        return normalized;
      })
      .sort((a, b) => a.priority - b.priority);
  };

  const readProjectAgentSkillBindings = async (user, projectId, skills) => {
    if (!projectId) {
      return [];
    }
    const secret = await secrets.read(secrets.agentProjectSkillBindingsPath(user, projectId));
    return normalizeProjectSkillBindings(secret?.data?.data?.bindings ?? [], skills);
  };

  const mergedAgentSkillsForUser = async (user) => {
    const repoCatalog = loadAgentRepositories();
    const userSkills = await readAgentSkills(user);
    const packageSkillIds = new Set(repoCatalog.skills.map((skill) => skill.id));
    return [...repoCatalog.skills, ...userSkills.filter((skill) => !packageSkillIds.has(skill.id))];
  };

  return {
    agentExecutorCatalog,
    agentSkillIdPattern,
    loadAgentRepositories,
    normalizeAgentSkill,
    readAgentSkillIndex,
    writeAgentSkillIndex,
    readAgentSkills,
    normalizeProjectSkillBindings,
    readProjectAgentSkillBindings,
    mergedAgentSkillsForUser,
  };
};
