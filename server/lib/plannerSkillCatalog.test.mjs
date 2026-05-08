import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderPlannerSkillMarkdown,
  resolvePlannerVisibleSkills,
  validatePlannerExecutionPayload,
} from './plannerSkillCatalog.mjs';

const skills = [
  {
    id: 'paper-reader-summary',
    name: 'Paper Reader Summary',
    description: 'Summarize one PDF paper.',
    category: 'Document Processing',
    status: 'enabled',
    inputs: ['PDF file'],
    executable: {
      mode: 'catalog',
      catalogId: 'paperqa2-paper-reader',
      command: 'paper-reader-summary',
      args: [],
      network: 'egress',
      timeoutSeconds: 900,
    },
  },
  {
    id: 'draft-skill',
    name: 'Draft Skill',
    category: 'General',
    status: 'draft',
    executable: { mode: 'none' },
  },
  {
    id: 'notes-skill',
    name: 'Notes Skill',
    category: 'General',
    status: 'enabled',
    executable: { mode: 'none' },
  },
];

test('resolvePlannerVisibleSkills returns enabled project bindings in priority order', () => {
  const visible = resolvePlannerVisibleSkills({
    skills,
    bindings: [
      { skillId: 'notes-skill', enabled: true, priority: 2 },
      { skillId: 'paper-reader-summary', enabled: true, priority: 1 },
      { skillId: 'draft-skill', enabled: true, priority: 3 },
    ],
    plannerConfig: { skillPolicy: { visibility: 'project-enabled' } },
  });

  assert.deepEqual(
    visible.map((skill) => skill.id),
    ['paper-reader-summary', 'notes-skill'],
  );
});

test('resolvePlannerVisibleSkills applies allowlist and category filters', () => {
  const visible = resolvePlannerVisibleSkills({
    skills,
    plannerConfig: {
      skillPolicy: {
        visibility: 'allowlist',
        allowedSkillIds: ['paper-reader-summary', 'notes-skill'],
        allowedCategories: ['Document Processing'],
      },
    },
  });

  assert.deepEqual(
    visible.map((skill) => skill.id),
    ['paper-reader-summary'],
  );
});

test('renderPlannerSkillMarkdown creates non-execution skill stubs', () => {
  const [skill] = resolvePlannerVisibleSkills({
    skills,
    plannerConfig: { skillPolicy: { visibility: 'allowlist', allowedSkillIds: ['paper-reader-summary'] } },
  });
  const markdown = renderPlannerSkillMarkdown(skill);

  assert.match(markdown, /Do not run tools, scripts, shell commands, containers/);
  assert.match(markdown, /Return a JSON execution payload/);
  assert.doesNotMatch(markdown, /skillPackage/);
});

test('validatePlannerExecutionPayload accepts visible skill payloads', () => {
  const visibleSkills = resolvePlannerVisibleSkills({
    skills,
    plannerConfig: { skillPolicy: { visibility: 'allowlist', allowedSkillIds: ['paper-reader-summary'] } },
  });

  const payload = validatePlannerExecutionPayload(
    JSON.stringify({
      type: 'skill_execution_plan',
      selectedSkillId: 'paper-reader-summary',
      requestedExecutor: { mode: 'catalog', catalogId: 'paperqa2-paper-reader' },
    }),
    { visibleSkills },
  );

  assert.equal(payload.selectedSkillId, 'paper-reader-summary');
});

test('validatePlannerExecutionPayload rejects invisible skills and executor mismatches', () => {
  const visibleSkills = resolvePlannerVisibleSkills({
    skills,
    plannerConfig: { skillPolicy: { visibility: 'allowlist', allowedSkillIds: ['paper-reader-summary'] } },
  });

  assert.throws(
    () =>
      validatePlannerExecutionPayload(
        { type: 'skill_execution_plan', selectedSkillId: 'notes-skill', requestedExecutor: { mode: 'none' } },
        { visibleSkills },
      ),
    /not visible/,
  );
  assert.throws(
    () =>
      validatePlannerExecutionPayload(
        {
          type: 'skill_execution_plan',
          selectedSkillId: 'paper-reader-summary',
          requestedExecutor: { mode: 'catalog', catalogId: 'wrong-executor' },
        },
        { visibleSkills },
      ),
    /does not match/,
  );
});
