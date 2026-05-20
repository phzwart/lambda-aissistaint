export const PAPER_READER_SKILL_ID = 'paper-reader-summary';

/** Must match server PAPER_READER_INSTRUCTION_MAX_CHARS */
export const PAPER_READER_INSTRUCTION_MAX_CHARS = 128_000;

export const paperReaderDefaultProcessingConfig = {
  summaryInstruction:
    'Structured summary for summary.md: ten sections (citation, executive summary, methods, findings, etc.). Use Reset to load the skill default, or paste a customized prompt.',
  extendedAbstractInstruction:
    'Expert-level extended abstract: reconstruct the paper from the journal abstract plus full paper text (900–1200 words). Use Reset to load the skill default, or paste a customized prompt.',
  followUpQuestionsInstruction:
    'Follow-up questions from extended abstract + structured summary only (not full paper). Use Reset to load the skill default.',
  extendedAbstractEnabled: true,
  followUpQuestionsEnabled: true,
  useDefaultSummaryInstruction: true,
  useDefaultExtendedAbstract: true,
  useDefaultFollowUpQuestionsInstruction: true,
};
