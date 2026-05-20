import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMockChatCompletion, createMockLlmServer, MOCK_SMOKE_MARKER } from './mockLlmServer.mjs';

test('buildMockChatCompletion returns structured summary for PaperQA-style prompts', () => {
  const payload = buildMockChatCompletion({
    model: 'LLM_A',
    messages: [{ role: 'user', content: 'Read the provided paper and produce a grounded structured summary.' }],
  });
  assert.ok(payload.choices[0].message.content.includes(MOCK_SMOKE_MARKER));
  assert.ok(payload.choices[0].message.content.includes('Executive Summary'));
});

test('buildMockChatCompletion returns JSON for PaperQA context prompts', () => {
  const payload = buildMockChatCompletion({
    model: 'LLM_A',
    messages: [
      {
        role: 'user',
        content: 'Provide a summary of the relevant information that could help answer the question.',
      },
    ],
  });
  const parsed = JSON.parse(payload.choices[0].message.content);
  assert.ok(parsed.summary);
  assert.equal(typeof parsed.relevant_score, 'number');
});

test('buildMockChatCompletion returns extended abstract markdown', () => {
  const payload = buildMockChatCompletion({
    model: 'LLM_A',
    messages: [
      {
        role: 'user',
        content:
          '## Original abstract (verbatim from paper)\n\nBody.\n\n## Requirements\n\n- Target length: 500 characters\n- Write plain Markdown prose (no JSON).',
      },
    ],
  });
  assert.ok(payload.choices[0].message.content.includes(MOCK_SMOKE_MARKER));
  assert.ok(payload.choices[0].message.content.includes('Extended Abstract'));
});

test('buildMockChatCompletion returns follow-up question JSON', () => {
  const payload = buildMockChatCompletion({
    model: 'LLM_A',
    messages: [
      {
        role: 'user',
        content:
          'Return JSON only with keys "depth" and "breadth".\n\n## Extended abstract\n\nText.\n\n## Structured summary\n\nText.',
      },
    ],
  });
  const parsed = JSON.parse(payload.choices[0].message.content);
  assert.equal(parsed.depth.length, 5);
  assert.equal(parsed.breadth.length, 5);
});

test('buildMockChatCompletion returns short answers for other prompts', () => {
  const payload = buildMockChatCompletion({
    model: 'LLM_A',
    messages: [{ role: 'user', content: 'What evidence supports the main claim?' }],
  });
  assert.ok(!payload.choices[0].message.content.includes('## Citation Header'));
});

test('mock HTTP server handles chat completions', async () => {
  const mock = createMockLlmServer({ port: 0 });
  const boundPort = await mock.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${boundPort}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mock' },
      body: JSON.stringify({
        model: 'LLM_A',
        messages: [{ role: 'user', content: 'structured summary with executive summary sections' }],
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.choices[0].message.content.includes(MOCK_SMOKE_MARKER));
    assert.equal(mock.getRequestCount(), 1);
  } finally {
    await mock.close();
  }
});
