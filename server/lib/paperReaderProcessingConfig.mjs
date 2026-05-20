import { readFile, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsedStemFromObjectKey } from './projectParsedPaths.mjs';

export const PAPER_READER_SKILL_ID = 'paper-reader-summary';

/** Hard cap for stored Paper Reader prompts (OpenBao + UI). */
export const PAPER_READER_INSTRUCTION_MAX_CHARS = 128_000;

const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultsPath = join(moduleDir, '../../agent-repo/skills/paper-reader-summary/defaults.json');
const instructionPackageDir = join(
  moduleDir,
  '../../agent-repo/skills/paper-reader-summary/cli/paper_reader_summary',
);

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
      summaryInstruction: 'Read the provided paper and produce a grounded structured summary.',
      extendedAbstractInstruction:
        'Expand the paper abstract to roughly five times its length using only paper content.',
      followUpQuestionsInstruction:
        'Return JSON with depth and breadth arrays of five questions each, grounded in the paper.',
    };
  }
  return cachedDefaults;
};

const readInstructionFileSync = (filename) => {
  try {
    return readFileSync(join(instructionPackageDir, filename), 'utf8').trim();
  } catch {
    return '';
  }
};

let cachedExtendedInstruction = null;
let cachedSummaryInstruction = null;
let cachedFollowUpInstruction = null;

const loadExtendedAbstractInstructionDefaultSync = () => {
  if (cachedExtendedInstruction === null) {
    cachedExtendedInstruction = readInstructionFileSync('extended_abstract_instruction_default.txt');
  }
  return cachedExtendedInstruction;
};

const loadStructuredSummaryInstructionDefaultSync = () => {
  if (cachedSummaryInstruction === null) {
    cachedSummaryInstruction = readInstructionFileSync('structured_summary_instruction_default.txt');
  }
  return cachedSummaryInstruction;
};

const loadFollowUpQuestionsInstructionDefaultSync = () => {
  if (cachedFollowUpInstruction === null) {
    cachedFollowUpInstruction = readInstructionFileSync('follow_up_questions_instruction_default.txt');
  }
  return cachedFollowUpInstruction;
};

const loadExtendedAbstractInstructionDefault = async () => loadExtendedAbstractInstructionDefaultSync();
const loadStructuredSummaryInstructionDefault = async () => loadStructuredSummaryInstructionDefaultSync();
const loadFollowUpQuestionsInstructionDefault = async () => loadFollowUpQuestionsInstructionDefaultSync();

const LEGACY_EXTENDED_ABSTRACT_MARKERS = [
  "expand the paper's abstract into a richer narrative",
  'expand the paper abstract to roughly five times',
  '~5× the original abstract',
  '~5x the original abstract',
];

const isLegacyExtendedAbstractInstruction = (text) => {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized.length < 600) {
    return LEGACY_EXTENDED_ABSTRACT_MARKERS.some((marker) => normalized.includes(marker));
  }
  return false;
};

const isLegacySummaryInstruction = (text) => {
  const normalized = String(text ?? '').trim();
  if (!normalized) {
    return true;
  }
  if (normalized.length < 400) {
    return true;
  }
  return false;
};

const LEGACY_FOLLOW_UP_MARKERS = [
  'return json only with keys',
  'in-depth follow-up questions',
  'five strings in each array',
  'grounded in the paper content',
];

const isLegacyFollowUpQuestionsInstruction = (text) => {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized.length < 500) {
    return LEGACY_FOLLOW_UP_MARKERS.some((marker) => normalized.includes(marker));
  }
  return false;
};

const trimLongInstruction = (value, label, max = PAPER_READER_INSTRUCTION_MAX_CHARS) => {
  const text = String(value ?? '').trim();
  if (!text) {
    return '';
  }
  if (text.length > max) {
    throw Object.assign(
      new Error(`${label} must be ${max.toLocaleString()} characters or less (received ${text.length.toLocaleString()}).`),
      { status: 400 },
    );
  }
  return text;
};

const instructionMatchesFileDefault = (text, fileDefault) => {
  if (!fileDefault || !text) {
    return false;
  }
  return text === fileDefault;
};

export const normalizePaperReaderProcessingConfig = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const summaryFileDefault = loadStructuredSummaryInstructionDefaultSync();
  const extendedFileDefault = loadExtendedAbstractInstructionDefaultSync();
  const followUpFileDefault = loadFollowUpQuestionsInstructionDefaultSync();

  const trimmedSummary = trimLongInstruction(raw.summaryInstruction, 'Structured summary instruction');
  const useDefaultSummaryInstruction =
    raw.useDefaultSummaryInstruction === true ||
    isLegacySummaryInstruction(trimmedSummary) ||
    instructionMatchesFileDefault(trimmedSummary, summaryFileDefault);
  const summaryInstruction = useDefaultSummaryInstruction ? '' : trimmedSummary;

  const explicitUseDefault = raw.useDefaultExtendedAbstract === true;
  const trimmedExtended = trimLongInstruction(
    raw.extendedAbstractInstruction,
    'Extended abstract instruction',
  );
  const useDefaultExtendedAbstract =
    explicitUseDefault ||
    isLegacyExtendedAbstractInstruction(trimmedExtended) ||
    instructionMatchesFileDefault(trimmedExtended, extendedFileDefault);
  const extendedAbstractInstruction = useDefaultExtendedAbstract ? '' : trimmedExtended;

  const trimmedFollowUp = trimLongInstruction(
    raw.followUpQuestionsInstruction,
    'Follow-up questions instruction',
  );
  const useDefaultFollowUpQuestionsInstruction =
    raw.useDefaultFollowUpQuestionsInstruction === true ||
    isLegacyFollowUpQuestionsInstruction(trimmedFollowUp) ||
    instructionMatchesFileDefault(trimmedFollowUp, followUpFileDefault);
  const followUpQuestionsInstruction = useDefaultFollowUpQuestionsInstruction ? '' : trimmedFollowUp;

  const extendedAbstractEnabled = raw.extendedAbstractEnabled !== false;
  const followUpQuestionsEnabled =
    raw.followUpQuestionsEnabled !== false &&
    (useDefaultFollowUpQuestionsInstruction || Boolean(followUpQuestionsInstruction));

  if (!extendedAbstractEnabled && !followUpQuestionsEnabled) {
    return {
      summaryInstruction,
      useDefaultSummaryInstruction,
      extendedAbstractEnabled: false,
      followUpQuestionsEnabled: false,
      extendedAbstractInstruction: '',
      followUpQuestionsInstruction: '',
      useDefaultExtendedAbstract: false,
      useDefaultFollowUpQuestionsInstruction: false,
    };
  }
  return {
    summaryInstruction,
    useDefaultSummaryInstruction,
    extendedAbstractEnabled,
    followUpQuestionsEnabled,
    extendedAbstractInstruction,
    followUpQuestionsInstruction,
    useDefaultExtendedAbstract: extendedAbstractEnabled && useDefaultExtendedAbstract,
    useDefaultFollowUpQuestionsInstruction: followUpQuestionsEnabled && useDefaultFollowUpQuestionsInstruction,
  };
};

/** Expand stored bindings for the Setup editor (full template text without persisting it). */
export const enrichPaperReaderBindingsForEditor = (bindings) => {
  const extendedDefault = loadExtendedAbstractInstructionDefaultSync();
  const summaryDefault = loadStructuredSummaryInstructionDefaultSync();
  const followUpDefault = loadFollowUpQuestionsInstructionDefaultSync();
  return (Array.isArray(bindings) ? bindings : []).map((binding) => {
    if (binding?.skillId !== PAPER_READER_SKILL_ID || !binding.processingConfig) {
      return binding;
    }
    const config = { ...binding.processingConfig };
    if (config.useDefaultSummaryInstruction && summaryDefault) {
      config.summaryInstruction = summaryDefault;
    } else if (isLegacySummaryInstruction(config.summaryInstruction) && summaryDefault) {
      config.summaryInstruction = summaryDefault;
      config.useDefaultSummaryInstruction = true;
    }
    if (config.extendedAbstractEnabled) {
      if (config.useDefaultExtendedAbstract && extendedDefault) {
        config.extendedAbstractInstruction = extendedDefault;
      } else if (isLegacyExtendedAbstractInstruction(config.extendedAbstractInstruction) && extendedDefault) {
        config.extendedAbstractInstruction = extendedDefault;
        config.useDefaultExtendedAbstract = true;
      }
    }
    if (config.followUpQuestionsEnabled) {
      if (config.useDefaultFollowUpQuestionsInstruction && followUpDefault) {
        config.followUpQuestionsInstruction = followUpDefault;
      } else if (isLegacyFollowUpQuestionsInstruction(config.followUpQuestionsInstruction) && followUpDefault) {
        config.followUpQuestionsInstruction = followUpDefault;
        config.useDefaultFollowUpQuestionsInstruction = true;
      }
    }
    return { ...binding, processingConfig: config };
  });
};

export const resolvePaperReaderProcessing = async (binding) => {
  const defaults = await loadPaperReaderDefaults();
  const fileSummaryInstruction = await loadStructuredSummaryInstructionDefault();
  const fileExtendedInstruction = await loadExtendedAbstractInstructionDefault();
  const fileFollowUpInstruction = await loadFollowUpQuestionsInstructionDefault();
  const fallbackSummaryInstruction =
    fileSummaryInstruction || trimLongInstruction(defaults.summaryInstruction, 'Structured summary instruction');
  const fallbackExtendedInstruction =
    fileExtendedInstruction ||
    trimLongInstruction(defaults.extendedAbstractInstruction, 'Extended abstract instruction');

  const fromBinding = binding?.processingConfig
    ? normalizePaperReaderProcessingConfig(binding.processingConfig)
    : null;

  const useDefaultSummary =
    fromBinding?.useDefaultSummaryInstruction === true ||
    isLegacySummaryInstruction(fromBinding?.summaryInstruction ?? '');
  const bindingSummary = fromBinding?.summaryInstruction ?? '';
  const summaryInstruction = useDefaultSummary
    ? fallbackSummaryInstruction
    : bindingSummary || fallbackSummaryInstruction;

  const useDefaultExtended =
    fromBinding?.useDefaultExtendedAbstract === true ||
    isLegacyExtendedAbstractInstruction(fromBinding?.extendedAbstractInstruction ?? '');
  const bindingExtended = fromBinding?.extendedAbstractInstruction ?? '';
  const extendedAbstractInstruction = useDefaultExtended
    ? fallbackExtendedInstruction
    : bindingExtended || fallbackExtendedInstruction;

  const useDefaultFollowUp =
    fromBinding?.useDefaultFollowUpQuestionsInstruction === true ||
    isLegacyFollowUpQuestionsInstruction(fromBinding?.followUpQuestionsInstruction ?? '');
  const fallbackFollowUpInstruction =
    fileFollowUpInstruction ||
    trimLongInstruction(defaults.followUpQuestionsInstruction, 'Follow-up questions instruction');
  const bindingFollowUp = fromBinding?.followUpQuestionsInstruction ?? '';
  const followUpQuestionsInstruction = useDefaultFollowUp
    ? fallbackFollowUpInstruction
    : bindingFollowUp || fallbackFollowUpInstruction;

  return {
    summaryInstruction,
    useDefaultSummaryInstruction: useDefaultSummary,
    extendedAbstractEnabled: fromBinding?.extendedAbstractEnabled !== false,
    followUpQuestionsEnabled: fromBinding?.followUpQuestionsEnabled !== false,
    extendedAbstractInstruction,
    followUpQuestionsInstruction,
    useDefaultExtendedAbstract: useDefaultExtended,
    useDefaultFollowUpQuestionsInstruction: useDefaultFollowUp,
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
      structuredSummary: processing.summaryInstruction,
      extendedAbstract: processing.extendedAbstractInstruction,
      followUpQuestions: processing.followUpQuestionsInstruction,
      extendedAbstractEnabled: processing.extendedAbstractEnabled,
      followUpQuestionsEnabled: processing.followUpQuestionsEnabled,
    },
  };
};

/** @deprecated Use PAPER_READER_INSTRUCTION_MAX_CHARS */
export const EXTENDED_ABSTRACT_INSTRUCTION_MAX_CHARS = PAPER_READER_INSTRUCTION_MAX_CHARS;
