import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { directClaimId } from '../provenance/claimId.mjs';
import { provenanceKindForTier, validateClaim } from '../provenance/claimSchema.mjs';
import { detectParentCycle } from '../provenance/cycleDetection.mjs';
import { buildProvenanceDag } from '../provenance/buildDag.mjs';
import { normalizedSimilarity } from './levenshtein.mjs';

const ROUND_TRIP_THRESHOLD = 0.85;

const readJsonl = async (path) => {
  try {
    const text = await readFile(path, 'utf8');
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

const readJson = async (path) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
};

const parseLlmClaims = (raw) => {
  const text = String(raw ?? '').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) {
    return [];
  }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const buildClaimPrompt = ({ summaryMarkdown, spans, evidence }) => {
  const spanLines = spans
    .slice(0, 40)
    .map(
      (span) =>
        `- span_id=${span.span_id} page=${span.page ?? '?'} chars=${span.char_start}-${span.char_end}`,
    )
    .join('\n');
  const contextLines = (evidence?.passes ?? [])
    .flatMap((pass) => pass.contexts ?? [])
    .slice(0, 12)
    .map((ctx, index) => `- [${index}] ${String(ctx.text ?? '').slice(0, 200)}`)
    .join('\n');
  return [
    'Extract atomic factual claims from the paper package below.',
    'Return JSON array only. Each item:',
    '{ "text": string, "span_id": string, "confidence": number 0-1 }',
    'Use span_id from the list. Do not invent span ids.',
    '',
    'Available spans:',
    spanLines || '(none)',
    '',
    'Retrieved evidence snippets:',
    contextLines || '(none)',
    '',
    'Structured summary:',
    summaryMarkdown.slice(0, 12000),
  ].join('\n');
};

const heuristicClaimsFromKg = ({ kg, sourceHash, ingestId, spans }) => {
  const claims = [];
  const kgClaims = Array.isArray(kg?.claims) ? kg.claims : [];
  const defaultSpan = spans[0] ?? null;
  for (const entry of kgClaims) {
    const text = String(entry.statement ?? entry.text ?? entry.label ?? '').trim();
    if (!text) {
      continue;
    }
    const sourceSpanId = defaultSpan
      ? {
          source_hash: sourceHash,
          span_id: defaultSpan.span_id,
          chunk_index: defaultSpan.chunk_index,
          char_start: defaultSpan.char_start,
          char_end: defaultSpan.char_end,
        }
      : null;
    const extractionStepId = 'claim_extract_heuristic';
    const claim = {
      claim_id: directClaimId({ text, sourceSpanId, extractionStepId }),
      text,
      source_span_id: sourceSpanId,
      extraction_step_id: extractionStepId,
      confidence: null,
      provenance_kind: 'heuristic',
      parent_claim_ids: [],
      root_sources: [sourceHash],
      ingest_id: ingestId,
      derived_from: null,
      verified_by: null,
    };
    claims.push(claim);
  }
  return claims;
};

const resolveSpanText = (extractedText, span) => {
  if (!span) {
    return '';
  }
  const raw = extractedText.slice(span.char_start, span.char_end);
  return raw.replace(/\[Page\s+\d+\]/gi, ' ').replace(/\s+/g, ' ').trim();
};

export const verifyClaimRoundTrip = (claim, { extractedText, spansById }) => {
  const spanId = claim.source_span_id?.span_id;
  const span = spanId ? spansById.get(spanId) : null;
  const spanText = resolveSpanText(extractedText, span);
  if (!spanText.trim()) {
    return { ok: false, reason: 'span not resolved' };
  }
  const score = normalizedSimilarity(claim.text, spanText);
  if (score < ROUND_TRIP_THRESHOLD) {
    return { ok: false, reason: `similarity ${score.toFixed(3)} below ${ROUND_TRIP_THRESHOLD}` };
  }
  return { ok: true, score };
};

export const extractClaims = async ({
  outputDir,
  sourceHash,
  ingestId,
  tier = 'a',
  callLlmChatEndpoint,
  extractLlmAnswer,
  modelAlias,
  traceBuilder,
}) => {
  const spans = await readJsonl(join(outputDir, 'source_spans.jsonl'));
  const evidence = await readJson(join(outputDir, 'paperqa_evidence.json'));
  const summaryMarkdown = await readFile(join(outputDir, 'summary.md'), 'utf8').catch(() => '');
  const extractedText = await readFile(join(outputDir, 'extracted.txt'), 'utf8').catch(() => '');
  const kg = await readJson(join(outputDir, 'knowledge_graph.json'));

  const spansById = new Map(spans.map((span) => [span.span_id, span]));
  const provenanceKind = provenanceKindForTier(tier);
  const claims = [];
  const parentMap = new Map();

  if (callLlmChatEndpoint && extractLlmAnswer && modelAlias && summaryMarkdown.trim()) {
    const prompt = buildClaimPrompt({ summaryMarkdown, spans, evidence });
    const started = Date.now();
    const body = await callLlmChatEndpoint({ modelAlias }, prompt, { maxTokens: 4096, temperature: 0 });
    const raw = extractLlmAnswer(body);
    traceBuilder?.recordLlmCall?.({
      extractionStepId: 'claim_extract_llm',
      modelAlias,
      prompt,
      response: raw,
      durationMs: Date.now() - started,
      usage: body.usage,
    });
    for (const item of parseLlmClaims(raw)) {
      const text = String(item.text ?? '').trim();
      const spanId = String(item.span_id ?? '').trim();
      const span = spansById.get(spanId) ?? spans[0];
      if (!text || !span) {
        continue;
      }
      const sourceSpanId = {
        source_hash: sourceHash,
        span_id: span.span_id,
        chunk_index: span.chunk_index,
        char_start: span.char_start,
        char_end: span.char_end,
      };
      const extractionStepId = 'claim_extract_llm';
      const claim = {
        claim_id: directClaimId({ text, sourceSpanId, extractionStepId }),
        text,
        source_span_id: sourceSpanId,
        extraction_step_id: extractionStepId,
        confidence: Math.min(1, Math.max(0, Number(item.confidence ?? 0.5))),
        provenance_kind: provenanceKind,
        parent_claim_ids: [],
        root_sources: [sourceHash],
        ingest_id: ingestId,
        derived_from: null,
        verified_by: null,
      };
      const cycleError = detectParentCycle(parentMap, claim.claim_id, claim.parent_claim_ids);
      if (cycleError) {
        throw Object.assign(new Error(cycleError), { status: 422 });
      }
      const validation = validateClaim(claim);
      if (!validation.ok) {
        continue;
      }
      parentMap.set(claim.claim_id, claim.parent_claim_ids);
      claims.push(claim);
    }
  }

  if (claims.length === 0) {
    for (const claim of heuristicClaimsFromKg({ kg, sourceHash, ingestId, spans })) {
      const validation = validateClaim(claim);
      if (validation.ok) {
        claims.push(claim);
      }
    }
  }

  for (const claim of claims) {
    const roundTrip = verifyClaimRoundTrip(claim, { extractedText, spansById });
    if (!roundTrip.ok && claim.provenance_kind.startsWith('llm-tier')) {
      claim.provenance_kind = 'heuristic';
      claim.confidence = null;
    }
  }

  const claimsPath = join(outputDir, 'claims.jsonl');
  const lines = claims.map((claim) => JSON.stringify(claim));
  await writeFile(claimsPath, `${lines.join('\n')}\n`, 'utf8');

  const dag = buildProvenanceDag({
    claims,
    spans,
    evidence,
    llmCalls: await readJsonl(join(outputDir, 'llm_calls.jsonl')),
    sourceHash,
    ingestId,
  });
  await writeFile(join(outputDir, 'provenance_dag.json'), `${JSON.stringify(dag, null, 2)}\n`, 'utf8');

  return { claims, claimsPath, dag };
};

export const writeIngestManifest = async ({
  outputDir,
  ingestId,
  sourceHash,
  stem,
  startedAt,
  finishedAt,
  extractionSteps,
}) => {
  const manifest = {
    ingest_id: ingestId,
    source_hash: sourceHash,
    stem,
    started_at: startedAt,
    finished_at: finishedAt,
    extraction_steps: extractionSteps,
  };
  await writeFile(join(outputDir, 'ingest_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
};

export const newIngestId = () => randomUUID();
