import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsedStemFromObjectKey } from './projectParsedPaths.mjs';

export const PAPER_READER_SKILL_ID = 'paper-reader-summary';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultsPath = join(moduleDir, '../../agent-repo/skills/paper-reader-summary/defaults.json');

let cachedDefaults = null;

export const loadPaperReaderDefaults = async () => {
  if (cachedDefaults) {
    return cachedDefaults;
  }
  try {
    const raw = await readFile(defaultsPath, 'utf8');
    cachedDefaults = JSON.parse(raw);
  } catch {
    cachedDefaults = {
      extendedAbstractInstruction:
        'Expand the paper abstract to roughly five times its length using only paper content.',
      followUpQuestionsInstruction:
        'Return JSON with depth and breadth arrays of five questions each, grounded in the paper.',
    };
  }
  return cachedDefaults;
};

const trimInstruction = (value, max = 4000) => {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }
  return text.length <= max ? text : text.slice(0, max);
};

export const normalizePaperReaderProcessingConfig = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const extendedAbstractInstruction = trimInstruction(raw.extendedAbstractInstruction);
  const followUpQuestionsInstruction = trimInstruction(raw.followUpQuestionsInstruction);
  const extendedAbstractEnabled =
    raw.extendedAbstractEnabled !== false && Boolean(extendedAbstractInstruction);
  const followUpQuestionsEnabled =
    raw.followUpQuestionsEnabled !== false && Boolean(followUpQuestionsInstruction);
  if (!extendedAbstractEnabled && !followUpQuestionsEnabled) {
    return {
      extendedAbstractEnabled: false,
      followUpQuestionsEnabled: false,
      extendedAbstractInstruction: '',
      followUpQuestionsInstruction: '',
    };
  }
  return {
    extendedAbstractEnabled,
    followUpQuestionsEnabled,
    extendedAbstractInstruction,
    followUpQuestionsInstruction,
  };
};

export const resolvePaperReaderProcessing = async (binding) => {
  const defaults = await loadPaperReaderDefaults();
  const fromBinding = binding?.processingConfig
    ? normalizePaperReaderProcessingConfig(binding.processingConfig)
    : null;
  return {
    extendedAbstractEnabled: fromBinding?.extendedAbstractEnabled !== false,
    followUpQuestionsEnabled: fromBinding?.followUpQuestionsEnabled !== false,
    extendedAbstractInstruction:
      fromBinding?.extendedAbstractInstruction ||
      trimInstruction(defaults.extendedAbstractInstruction),
    followUpQuestionsInstruction:
      fromBinding?.followUpQuestionsInstruction ||
      trimInstruction(defaults.followUpQuestionsInstruction),
  };
};

export const buildSkillRuntimePayload = ({ file, processing }) => {
  const citationLabel = parsedStemFromObjectKey(file.objectKey);
  return {
    fileId: file.id,
    fileName: file.name,
    objectKey: file.objectKey,
    citationLabel,
    instructions: {
      extendedAbstract: processing.extendedAbstractInstruction,
      followUpQuestions: processing.followUpQuestionsInstruction,
      extendedAbstractEnabled: processing.extendedAbstractEnabled,
      followUpQuestionsEnabled: processing.followUpQuestionsEnabled,
    },
  };
};
