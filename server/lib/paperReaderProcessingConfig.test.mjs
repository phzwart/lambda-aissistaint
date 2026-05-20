import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSkillRuntimePayload,
  normalizePaperReaderProcessingConfig,
  resolvePaperReaderProcessing,
} from './paperReaderProcessingConfig.mjs';

test('normalizePaperReaderProcessingConfig trims instructions', () => {
  const config = normalizePaperReaderProcessingConfig({
    extendedAbstractInstruction: '  Expand abstract  ',
    followUpQuestionsInstruction: '  Ask questions  ',
  });
  assert.equal(config?.extendedAbstractInstruction, 'Expand abstract');
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
  assert.ok(processing.followUpQuestionsInstruction.length > 20);
});
