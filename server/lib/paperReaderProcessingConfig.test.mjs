import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSkillRuntimePayload,
  enrichPaperReaderBindingsForEditor,
  normalizePaperReaderProcessingConfig,
  resolvePaperReaderProcessing,
} from './paperReaderProcessingConfig.mjs';

test('normalizePaperReaderProcessingConfig trims instructions', () => {
  const config = normalizePaperReaderProcessingConfig({
    summaryInstruction: '  Custom summary prompt with enough length to avoid legacy detection. '.repeat(10),
    extendedAbstractInstruction: '  Expand abstract  ',
    followUpQuestionsInstruction: '  Ask questions  ',
    useDefaultSummaryInstruction: false,
  });
  assert.ok(config?.summaryInstruction.includes('Custom summary'));
  assert.equal(config?.extendedAbstractInstruction, 'Expand abstract');
  assert.equal(config?.useDefaultExtendedAbstract, false);
  assert.equal(config?.followUpQuestionsEnabled, true);
});

test('buildSkillRuntimePayload uses upload stem as citationLabel', () => {
  const payload = buildSkillRuntimePayload({
    file: {
      id: 'abc123',
      name: 'paper.pdf',
      objectKey: 'loaded/2026-05-19T12-00-00-deadbeef-Beam-damage.pdf',
    },
    processing: {
      extendedAbstractEnabled: true,
      followUpQuestionsEnabled: true,
      extendedAbstractInstruction: 'Expand',
      followUpQuestionsInstruction: 'Questions',
    },
  });
  assert.equal(payload.citationLabel, '2026-05-19T12-00-00-deadbeef-Beam-damage');
  assert.equal(payload.fileId, 'abc123');
});

test('resolvePaperReaderProcessing applies defaults without binding', async () => {
  const processing = await resolvePaperReaderProcessing(null);
  assert.ok(processing.extendedAbstractInstruction.length > 20);
  assert.ok(processing.followUpQuestionsInstruction.toLowerCase().includes('uncertainty'));
  assert.ok(processing.useDefaultFollowUpQuestionsInstruction);
  assert.ok(processing.knowledgeGraphInstruction.toLowerCase().includes('knowledge graph'));
  assert.equal(processing.knowledgeGraphEnabled, true);
  assert.ok(processing.useDefaultKnowledgeGraphInstruction);
});

test('resolvePaperReaderProcessing upgrades legacy short extended abstract prompts', async () => {
  const processing = await resolvePaperReaderProcessing({
    processingConfig: {
      extendedAbstractInstruction:
        "Expand the paper's abstract into a richer narrative (~5× the original abstract length).",
      followUpQuestionsInstruction: 'Return JSON with depth and breadth.',
    },
  });
  assert.ok(processing.extendedAbstractInstruction.includes('ANTI-SUMMARIZATION RULE'));
  assert.ok(processing.extendedAbstractInstruction.length > 1000);
});

test('normalizePaperReaderProcessingConfig does not silently truncate long instructions', () => {
  const longText = 'x'.repeat(5000);
  const config = normalizePaperReaderProcessingConfig({
    extendedAbstractInstruction: longText,
    followUpQuestionsInstruction: 'Ask questions',
  });
  assert.equal(config?.extendedAbstractInstruction.length, 5000);
});

test('resolvePaperReaderProcessing includes structured summary default', async () => {
  const processing = await resolvePaperReaderProcessing(null);
  assert.ok(processing.summaryInstruction.includes('Citation Header'));
  assert.ok(processing.useDefaultSummaryInstruction);
});

test('enrichPaperReaderBindingsForEditor fills default template for useDefault flag', async () => {
  const { readFile } = await import('node:fs/promises');
  const fileDefault = await readFile(
    new URL(
      '../../agent-repo/skills/paper-reader-summary/cli/paper_reader_summary/extended_abstract_instruction_default.txt',
      import.meta.url,
    ),
    'utf8',
  );
  const summaryDefault = await readFile(
    new URL(
      '../../agent-repo/skills/paper-reader-summary/cli/paper_reader_summary/structured_summary_instruction_default.txt',
      import.meta.url,
    ),
    'utf8',
  );
  const enriched = enrichPaperReaderBindingsForEditor([
    {
      skillId: 'paper-reader-summary',
      enabled: true,
      priority: 1,
      processingConfig: {
        useDefaultSummaryInstruction: true,
        summaryInstruction: '',
        extendedAbstractEnabled: true,
        useDefaultExtendedAbstract: true,
        extendedAbstractInstruction: '',
        followUpQuestionsInstruction: 'Questions',
      },
    },
  ]);
  assert.equal(enriched[0].processingConfig.summaryInstruction, summaryDefault.trim());
  assert.equal(enriched[0].processingConfig.extendedAbstractInstruction, fileDefault.trim());
});

test('enrichPaperReaderBindingsForEditor fills knowledge graph default', async () => {
  const { readFile } = await import('node:fs/promises');
  const kgDefault = await readFile(
    new URL(
      '../../agent-repo/skills/paper-reader-summary/cli/paper_reader_summary/knowledge_graph_instruction_default.txt',
      import.meta.url,
    ),
    'utf8',
  );
  const enriched = enrichPaperReaderBindingsForEditor([
    {
      skillId: 'paper-reader-summary',
      enabled: true,
      priority: 1,
      processingConfig: {
        useDefaultKnowledgeGraphInstruction: true,
        knowledgeGraphInstruction: '',
        knowledgeGraphEnabled: true,
      },
    },
  ]);
  assert.equal(enriched[0].processingConfig.knowledgeGraphInstruction, kgDefault.trim());
});
