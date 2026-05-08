const enabledStatus = 'enabled';
const defaultVisibility = 'project-enabled';
const skillDirectoryPattern = /[^A-Za-z0-9_-]+/g;

const boundedString = (value, maxLength = 2000) => String(value ?? '').trim().slice(0, maxLength);

const listValues = (value, maxItems = 50) =>
  (Array.isArray(value) ? value : String(value ?? '').split(/\r?\n|,/))
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, maxItems);

export const plannerSkillDirectoryName = (skillId) => {
  const normalized = String(skillId ?? '')
    .replace(skillDirectoryPattern, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'skill';
};

export const normalizePlannerSkill = (skill) => ({
  id: boundedString(skill.id, 80),
  name: boundedString(skill.name || skill.id, 120),
  description: boundedString(skill.description || skill.purpose, 1024),
  category: boundedString(skill.category || 'General', 80),
  capabilities: listValues(skill.capabilities, 30),
  purpose: boundedString(skill.purpose, 1200),
  whenToUse: boundedString(skill.whenToUse, 1200),
  inputs: listValues(skill.inputs, 30),
  expectedOutput: boundedString(skill.expectedOutput, 1200),
  safetyConstraints: boundedString(skill.safetyConstraints, 1200),
  executor: {
    mode: skill.executable?.mode ?? 'none',
    catalogId: boundedString(skill.executable?.catalogId, 80) || undefined,
    command: boundedString(skill.executable?.command, 120) || undefined,
    args: listValues(skill.executable?.args, 20),
    timeoutSeconds: Number.isFinite(Number(skill.executable?.timeoutSeconds)) ? Number(skill.executable.timeoutSeconds) : undefined,
    network: skill.executable?.network ?? 'none',
  },
});

export const resolvePlannerVisibleSkills = ({ skills = [], bindings = [], plannerConfig = {} } = {}) => {
  const visibility = plannerConfig.skillPolicy?.visibility ?? defaultVisibility;
  const allowedIds = new Set(listValues(plannerConfig.skillPolicy?.allowedSkillIds, 100));
  const allowedCategories = new Set(listValues(plannerConfig.skillPolicy?.allowedCategories, 30));
  const skillById = new Map(skills.filter((skill) => skill?.id && skill.status === enabledStatus).map((skill) => [String(skill.id), skill]));

  let selectedSkills = [];
  if (visibility === 'all-enabled') {
    selectedSkills = [...skillById.values()];
  } else if (visibility === 'allowlist') {
    selectedSkills = [...allowedIds].map((skillId) => skillById.get(skillId)).filter(Boolean);
  } else {
    selectedSkills = (Array.isArray(bindings) ? bindings : [])
      .filter((binding) => binding.enabled)
      .sort((a, b) => Number(a.priority ?? 0) - Number(b.priority ?? 0))
      .map((binding) => skillById.get(String(binding.skillId)))
      .filter(Boolean);
  }

  if (allowedCategories.size > 0) {
    selectedSkills = selectedSkills.filter((skill) => allowedCategories.has(String(skill.category ?? '').trim()));
  }

  const seen = new Set();
  return selectedSkills
    .filter((skill) => {
      if (seen.has(skill.id)) {
        return false;
      }
      seen.add(skill.id);
      return true;
    })
    .map(normalizePlannerSkill);
};

const yamlString = (value) => JSON.stringify(String(value ?? ''));

const renderList = (items) => (items.length ? items.map((item) => `- ${item}`).join('\n') : '- None declared');

export const renderPlannerSkillMarkdown = (skill) => {
  const description = skill.description || skill.whenToUse || `${skill.name} skill.`;
  return `---
name: ${yamlString(skill.id)}
description: ${yamlString(description)}
---

# ${skill.name}

This is a planner-only AIssistAInt skill stub. Do not run tools, scripts, shell commands, containers, or support files for this skill. Use this information only to decide whether a future execution broker should run the skill.

## Skill Id

${skill.id}

## Category

${skill.category}

## When To Use

${skill.whenToUse || skill.description || 'No usage guidance declared.'}

## Inputs

${renderList(skill.inputs)}

## Expected Output

${skill.expectedOutput || 'No expected output declared.'}

## Safety Constraints

${skill.safetyConstraints || 'Follow project safety and data handling requirements.'}

## Broker Planning Metadata

- executor mode: ${skill.executor.mode}
- catalog executor id: ${skill.executor.catalogId || 'none'}
- command hint: ${skill.executor.command || 'none'}
- network policy: ${skill.executor.network}

Return a JSON execution payload for the broker when this skill should be used. Never execute the skill directly.
`;
};

export const renderPlannerSkillCatalog = ({ projectId, plannerConfig, skills }) => ({
  type: 'aissistaint_planner_skill_catalog',
  version: '0.1.0',
  projectId,
  generatedAt: new Date().toISOString(),
  skillPolicy: plannerConfig?.skillPolicy ?? { visibility: defaultVisibility, allowedSkillIds: [], allowedCategories: [] },
  skills,
});

export const parsePlannerExecutionPayload = (rawPayload) => {
  if (typeof rawPayload !== 'string') {
    return rawPayload;
  }
  return JSON.parse(rawPayload.trim());
};

export const validatePlannerExecutionPayload = (rawPayload, { visibleSkills = [] } = {}) => {
  const payload = parsePlannerExecutionPayload(rawPayload);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Planner output must be a JSON object.');
  }
  if (payload.type !== 'skill_execution_plan') {
    throw new Error('Planner output type must be skill_execution_plan.');
  }
  const selectedSkillId = boundedString(payload.selectedSkillId, 80);
  if (!selectedSkillId) {
    throw new Error('Planner output must include selectedSkillId.');
  }
  const visibleSkill = visibleSkills.find((skill) => skill.id === selectedSkillId);
  if (!visibleSkill) {
    throw new Error('Planner selected a skill that is not visible under the current planner policy.');
  }
  const requestedExecutor = payload.requestedExecutor ?? {};
  if (visibleSkill.executor.catalogId && requestedExecutor.catalogId && requestedExecutor.catalogId !== visibleSkill.executor.catalogId) {
    throw new Error('Planner requested an executor that does not match the selected skill.');
  }
  if (visibleSkill.executor.mode !== 'none' && requestedExecutor.mode && requestedExecutor.mode !== visibleSkill.executor.mode) {
    throw new Error('Planner requested an executor mode that does not match the selected skill.');
  }
  return {
    ...payload,
    selectedSkillId,
    requestedExecutor,
  };
};
