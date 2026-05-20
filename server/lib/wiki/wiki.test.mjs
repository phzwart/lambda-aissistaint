import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';
import {
  buildBacklinkIndex,
  extractWikiLinks,
  findUnresolvedLinks,
} from './linker.mjs';
import {
  buildEmptyPage,
  listManagedSections,
  mergeFrontmatter,
  parsePage,
  sectionIdFromSource,
  serializePage,
  upsertManagedSection,
} from './pageDocument.mjs';
import {
  guessPageRef,
  pageRefKey,
  parseWikiPageKey,
  slugifyTitle,
  wikiCategories,
  wikiPageKey,
} from './paths.mjs';
import {
  appendIngestLogEntry,
  emptyIngestLog,
  emptyProvenanceIndex,
  recordProvenance,
} from './provenance.mjs';
import { heuristicWikiSuggestion, parseSynthesisResponse } from './synthesize.mjs';
import { ingestDocument } from './ingest.mjs';
import { queryWiki, rankWikiPages, tokenizeQuestion } from './query.mjs';

const createMemoryStorage = () => {
  const pages = new Map();
  const metadata = new Map();
  return {
    pages,
    metadata,
    pageKey: (category, slug) => wikiPageKey({ prefix: 'wiki', category, slug }),
    metadataKey: (name) => `metadata/${name}`,
    async readPageMarkdown(category, slug) {
      return pages.get(wikiPageKey({ prefix: 'wiki', category, slug })) ?? null;
    },
    async writePageMarkdown(category, slug, markdown) {
      const key = wikiPageKey({ prefix: 'wiki', category, slug });
      pages.set(key, markdown);
      return key;
    },
    async deletePage(category, slug) {
      pages.delete(wikiPageKey({ prefix: 'wiki', category, slug }));
    },
    async listPageKeys() {
      return [...pages.keys()];
    },
    async listPageRefs() {
      return [...pages.keys()].map((key) => parseWikiPageKey(key, { prefix: 'wiki' })).filter(Boolean);
    },
    async readMetadataJson(name, fallback) {
      return metadata.has(name) ? structuredClone(metadata.get(name)) : (fallback ?? null);
    },
    async writeMetadataJson(name, value) {
      metadata.set(name, structuredClone(value));
    },
  };
};

test('slugifyTitle normalizes accents and punctuation', () => {
  assert.equal(slugifyTitle('Beamline Alignment'), 'beamline-alignment');
  assert.equal(slugifyTitle("X-ray Détecteur (v2)"), 'x-ray-detecteur-v2');
  assert.equal(slugifyTitle('   '), 'page');
});

test('wikiPageKey rejects unsupported categories by falling back to the default', () => {
  const key = wikiPageKey({ prefix: 'wiki', category: 'unsupported-bucket', slug: 'Some Page' });
  assert.equal(key, 'wiki/concepts/some-page.md');
});

test('parseWikiPageKey only recognizes keys inside the configured prefix', () => {
  assert.deepEqual(
    parseWikiPageKey('wiki/protocols/beamline-alignment.md', { prefix: 'wiki' }),
    { category: 'protocols', slug: 'beamline-alignment' },
  );
  assert.equal(parseWikiPageKey('other/protocols/x.md', { prefix: 'wiki' }), null);
  assert.equal(parseWikiPageKey('wiki/unknown/x.md', { prefix: 'wiki' }), null);
});

test('frontmatter parser/serializer roundtrips a typical page', () => {
  const sample = [
    '---',
    'title: "Beamline Alignment"',
    'slug: beamline-alignment',
    'category: protocols',
    'sources:',
    '  - protocol_123.pdf',
    '  - "lab-notes (2026-04-12)"',
    'related: []',
    'confidence: 0.7',
    '---',
    '',
    '# Beamline Alignment',
    '',
    'Body content with a [[Detector Calibration]] link.',
    '',
  ].join('\n');

  const { frontmatter, body } = parseFrontmatter(sample);
  assert.equal(frontmatter.title, 'Beamline Alignment');
  assert.equal(frontmatter.category, 'protocols');
  assert.deepEqual(frontmatter.sources, ['protocol_123.pdf', 'lab-notes (2026-04-12)']);
  assert.deepEqual(frontmatter.related, []);
  assert.equal(frontmatter.confidence, 0.7);
  assert.match(body, /Detector Calibration/);

  const serialized = serializeFrontmatter(frontmatter, body);
  const { frontmatter: roundtripped } = parseFrontmatter(serialized);
  assert.deepEqual(roundtripped.sources, frontmatter.sources);
  assert.equal(roundtripped.confidence, frontmatter.confidence);
});

test('extractWikiLinks dedupes and supports category prefixes and labels', () => {
  const body = [
    'See [[Beamline Alignment]] and [[concepts:Detector Calibration|the calibration page]].',
    'Also [[Beamline Alignment]] again.',
    'External [link](https://example.org) should not match.',
  ].join('\n');
  const links = extractWikiLinks(body);
  assert.equal(links.length, 2);
  const refs = links.map(pageRefKey).sort();
  assert.deepEqual(refs, ['concepts/beamline-alignment', 'concepts/detector-calibration']);
});

test('buildBacklinkIndex aggregates references per target', () => {
  const pages = [
    { category: 'protocols', slug: 'beamline-alignment', body: 'See [[Detector Calibration]] and [[Lab Setup]].' },
    { category: 'concepts', slug: 'lab-setup', body: 'Related to [[Detector Calibration]].' },
  ];
  const index = buildBacklinkIndex(pages);
  assert.ok(index['concepts/detector-calibration']);
  assert.equal(index['concepts/detector-calibration'].length, 2);
  assert.deepEqual(
    index['concepts/detector-calibration'].map((entry) => entry.from).sort(),
    ['concepts/lab-setup', 'protocols/beamline-alignment'],
  );
});

test('findUnresolvedLinks returns only wikilinks without a corresponding page', () => {
  const unresolved = findUnresolvedLinks(
    'See [[Existing Page]] and [[New Concept]].',
    ['concepts/existing-page'],
  );
  assert.deepEqual(unresolved.map(pageRefKey), ['concepts/new-concept']);
});

test('upsertManagedSection replaces an existing section in place', () => {
  const page = buildEmptyPage({ title: 'Test Page', category: 'concepts', slug: 'test-page' });
  let body = upsertManagedSection(page.body, {
    sectionId: sectionIdFromSource('paper-1'),
    sourceId: 'paper-1',
    heading: 'Notes from paper-1',
    content: 'Initial section content with [[Other Page]].',
  });
  assert.equal(listManagedSections(body).length, 1);
  body = upsertManagedSection(body, {
    sectionId: sectionIdFromSource('paper-1'),
    sourceId: 'paper-1',
    heading: 'Notes from paper-1',
    content: 'Updated section content.',
  });
  const sections = listManagedSections(body);
  assert.equal(sections.length, 1);
  assert.match(sections[0].content, /Updated section content\./);
  assert.doesNotMatch(body, /Initial section content/);
});

test('upsertManagedSection appends a new section without disturbing existing markers or prose', () => {
  const page = buildEmptyPage({ title: 'Test Page', category: 'concepts', slug: 'test-page' });
  let body = upsertManagedSection(page.body, {
    sectionId: sectionIdFromSource('paper-1'),
    sourceId: 'paper-1',
    content: 'From paper-1.',
  });
  body = `${body}\n\n## Manual Edit\n\nHandwritten notes preserved across ingests.\n`;
  body = upsertManagedSection(body, {
    sectionId: sectionIdFromSource('paper-2'),
    sourceId: 'paper-2',
    content: 'From paper-2.',
  });
  assert.match(body, /Handwritten notes preserved across ingests\./);
  const sections = listManagedSections(body);
  assert.equal(sections.length, 2);
});

test('mergeFrontmatter unions sources and related while refreshing updated stamp', () => {
  const existing = {
    title: 'Beamline Alignment',
    slug: 'beamline-alignment',
    category: 'protocols',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-02T00:00:00.000Z',
    sources: ['protocol_123.pdf'],
    related: ['concepts/detector-calibration'],
  };
  const merged = mergeFrontmatter(existing, {
    sources: ['protocol_456.pdf', 'protocol_123.pdf'],
    related: ['concepts/detector-calibration', 'concepts/lab-setup'],
    confidence: 0.8,
  });
  assert.deepEqual(merged.sources, ['protocol_123.pdf', 'protocol_456.pdf']);
  assert.deepEqual(merged.related, ['concepts/detector-calibration', 'concepts/lab-setup']);
  assert.equal(merged.confidence, 0.8);
  assert.notEqual(merged.updated, existing.updated);
});

test('parseSynthesisResponse strips code fences and tolerates surrounding prose', () => {
  const wrapped = '```json\n{"title": "Foo", "category": "concepts"}\n```';
  assert.deepEqual(parseSynthesisResponse(wrapped), { title: 'Foo', category: 'concepts' });
  const noisy = 'Sure, here it is: {"title": "Bar", "category": "datasets"} . That is the answer.';
  assert.deepEqual(parseSynthesisResponse(noisy), { title: 'Bar', category: 'datasets' });
});

test('heuristicWikiSuggestion produces a deterministic offline fallback', () => {
  const suggestion = heuristicWikiSuggestion({
    title: 'Catalyst Screening',
    sourceId: 'doc-1',
    chunks: [{ id: 'a', text: 'First sentence. Second sentence. Third sentence.' }],
    suggestedCategory: 'concepts',
  });
  assert.equal(suggestion.category, 'concepts');
  assert.equal(suggestion.fallback, true);
  assert.ok(suggestion.summary.startsWith('First sentence.'));
});

test('ingestDocument writes a markdown page, stubs related concepts, and updates sidecars', async () => {
  const storage = createMemoryStorage();
  const stubLlm = {
    async chat(_config, _messages, _options) {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'Beamline Alignment',
                category: 'protocols',
                summary: 'Procedure for aligning the beamline.',
                section: 'Aligning the beamline involves [[Detector Calibration]] and [[ALS]].',
                related: [
                  { category: 'concepts', title: 'Detector Calibration' },
                  { category: 'entities', title: 'ALS' },
                ],
                confidence: 0.8,
              }),
            },
          },
        ],
      };
    },
  };

  const result = await ingestDocument({
    storage,
    document: {
      sourceId: 'protocol-123',
      title: 'Beamline Protocol v1',
      chunks: [{ id: 'p1', text: 'The alignment procedure starts by zeroing the detector.' }],
      suggestedCategory: 'protocols',
    },
    llmConfig: { modelAlias: 'LLM_A' },
    callLlmChatEndpoint: (config, messages, options) => stubLlm.chat(config, messages, options),
    extractLlmAnswer: (body) => body.choices[0].message.content,
  });

  assert.equal(result.category, 'protocols');
  assert.equal(result.slug, 'beamline-alignment');
  assert.ok(result.createdStubs.some((stub) => stub.slug === 'detector-calibration'));
  assert.ok(result.createdStubs.some((stub) => stub.slug === 'als'));

  const markdown = await storage.readPageMarkdown('protocols', 'beamline-alignment');
  assert.match(markdown, /Aligning the beamline/);
  assert.match(markdown, /\[\[Detector Calibration\]\]/);
  const provenance = await storage.readMetadataJson('provenance.json');
  assert.ok(provenance.entries['protocols/beamline-alignment']?.length);
  const log = await storage.readMetadataJson('ingest_log.json');
  assert.equal(log.entries[0].sourceId, 'protocol-123');
  const backlinks = await storage.readMetadataJson('backlinks.json');
  assert.ok(backlinks.entries['concepts/detector-calibration']);
});

test('ingestDocument falls back to heuristic synthesis when no LLM is configured', async () => {
  const storage = createMemoryStorage();
  const result = await ingestDocument({
    storage,
    document: {
      sourceId: 'doc-fallback',
      title: 'Offline Notes',
      chunks: [{ id: 'a', text: 'Offline ingest sentence one. Offline ingest sentence two.' }],
      suggestedCategory: 'concepts',
    },
  });
  assert.equal(result.suggestion.fallback, true);
  const markdown = await storage.readPageMarkdown(result.category, result.slug);
  assert.match(markdown, /Heuristic extraction/);
});

test('queryWiki returns ranked pages and skips LLM calls when none configured', async () => {
  const storage = createMemoryStorage();
  await storage.writePageMarkdown(
    'concepts',
    'detector-calibration',
    serializePage(parsePage('---\ntitle: Detector Calibration\nslug: detector-calibration\ncategory: concepts\nsources: [protocol_123.pdf]\n---\n\n# Detector Calibration\n\nThe calibration procedure aligns detector channels.\n')),
  );
  await storage.writePageMarkdown(
    'protocols',
    'beamline-alignment',
    serializePage(parsePage('---\ntitle: Beamline Alignment\nslug: beamline-alignment\ncategory: protocols\nsources: []\n---\n\n# Beamline Alignment\n\nUnrelated text about safety briefings.\n')),
  );

  const ranked = await rankWikiPages({ storage, question: 'How is detector calibration performed?' });
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].page.slug, 'detector-calibration');

  const result = await queryWiki({ storage, question: 'How is detector calibration performed?' });
  assert.equal(result.llmUsed, false);
  assert.ok(result.citedPages[0].title.includes('Detector Calibration'));
});

test('tokenizeQuestion removes stop words and short tokens', () => {
  assert.deepEqual(tokenizeQuestion('How is the detector calibrated at ALS?').sort(), [
    'als',
    'calibrated',
    'detector',
  ]);
});

test('provenance + ingest log helpers preserve dedupe semantics', () => {
  let index = recordProvenance(emptyProvenanceIndex(), {
    pageKey: 'protocols/beamline-alignment',
    sectionId: 'src-paper-1',
    sourceId: 'paper-1',
    chunkIds: ['c1'],
    confidence: 0.5,
  });
  index = recordProvenance(index, {
    pageKey: 'protocols/beamline-alignment',
    sectionId: 'src-paper-1',
    sourceId: 'paper-1',
    chunkIds: ['c2'],
    confidence: 0.8,
  });
  assert.equal(index.entries['protocols/beamline-alignment'].length, 1);
  assert.equal(index.entries['protocols/beamline-alignment'][0].confidence, 0.8);

  const log = appendIngestLogEntry(emptyIngestLog(), { sourceId: 's', sourceTitle: 't', affectedPages: ['concepts/x'] });
  assert.equal(log.entries[0].sourceId, 's');
});

test('guessPageRef accepts category-prefixed targets', () => {
  assert.deepEqual(guessPageRef('protocols: Beamline Alignment'), {
    category: 'protocols',
    slug: 'beamline-alignment',
  });
  assert.deepEqual(guessPageRef('Beamline Alignment', { defaultCategory: 'concepts' }), {
    category: 'concepts',
    slug: 'beamline-alignment',
  });
});

test('wikiCategories exports the expected category set', () => {
  assert.deepEqual(wikiCategories, [
    'entities',
    'concepts',
    'projects',
    'protocols',
    'datasets',
    'people',
  ]);
});
