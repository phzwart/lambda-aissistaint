/**
 * Minimal OpenAI-compatible chat API for PaperQA / LiteLLM smoke tests.
 * No external LLM calls — returns deterministic structured summaries.
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { URL } from 'node:url';

export const MOCK_SMOKE_MARKER = 'MOCK_SMOKE_TEST_SUMMARY';

const MOCK_STRUCTURED_SUMMARY = `# Mock Paper Summary (${MOCK_SMOKE_MARKER})

## Citation Header
- **title:** Mock Smoke Test Paper
- **authors:** AIssistAInt Test Harness
- **venue/year:** Synthetic / 2026

## Executive Summary
This is a deterministic mock summary for end-to-end PaperQA smoke testing. ${MOCK_SMOKE_MARKER}
The mock LLM server returned this text without calling an external provider.
PaperQA extracted the PDF, built a local index, and requested a structured summary.

## Research Question
Can the paper processing pipeline complete using a mock LiteLLM-compatible server?

## Approach / Methods
A minimal PDF fixture and a local HTTP mock implement the LLM leg of the workflow.

## Data / Experimental Setup
Single-page synthetic PDF fixture; no external datasets.

## Main Findings
- Extraction succeeded.
- Mock LLM responses were accepted.
- Required output artifacts can be produced offline.

## Claimed Contributions
Provides a repeatable smoke path for CI and local development.

## Limitations / Caveats
This is not a real scientific summary — only a pipeline health check.

## Evidence Anchors
- p. 1 — title text "Mock smoke paper"

## Confidence / Ambiguity Notes
All content is synthetic for testing.
`;

const MOCK_SHORT_ANSWER =
  'The document states this is a mock smoke paper used to validate the processing pipeline (p. 1).';

const isChatPath = (pathname) =>
  pathname === '/chat/completions' ||
  pathname === '/v1/chat/completions' ||
  pathname.endsWith('/chat/completions');

const messageContent = (entry) => {
  const content = entry?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => part?.text ?? part?.content ?? '').join('\n');
  }
  return String(content ?? '');
};

const messageText = (messages) =>
  (Array.isArray(messages) ? messages : []).map((entry) => messageContent(entry)).join('\n');

const lastUserMessageText = (messages) => {
  if (!Array.isArray(messages)) {
    return '';
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return messageContent(messages[index]);
    }
  }
  return '';
};

const wantsStructuredSummary = (messages) => {
  const text = messageText(messages).toLowerCase();
  return (
    text.includes('structured summary') ||
    text.includes('return the answer with exactly these sections') ||
    text.includes('citation header') ||
    text.includes('evidence anchors') ||
    text.includes('read the provided paper')
  );
};

/** PaperQA context-building prompts expect JSON with summary + relevant_score. */
const wantsJsonContext = (messages) => {
  const text = messageText(messages).toLowerCase();
  const wantsFollowUp = text.includes('"depth"') && text.includes('"breadth"');
  if (wantsFollowUp) {
    return false;
  }
  return (
    text.includes('relevant information') ||
    text.includes('relevant_score') ||
    text.includes('could help answer') ||
    (text.includes('"summary"') && text.includes('json'))
  );
};

const wantsFollowUpQuestions = (messages) => {
  const text = lastUserMessageText(messages).toLowerCase();
  return (
    (text.includes('"depth"') && text.includes('"breadth"')) ||
    text.includes('follow-up questions') ||
    text.includes('in-depth follow-up')
  );
};

const allUserMessageText = (messages) => {
  if (!Array.isArray(messages)) {
    return '';
  }
  return messages
    .filter((entry) => entry?.role === 'user')
    .map((entry) => messageContent(entry))
    .join('\n')
    .toLowerCase();
};

const wantsFollowUpQuestionsRequest = (messages) => {
  const allUsers = allUserMessageText(messages);
  return (
    allUsers.includes('return json only with keys') &&
    allUsers.includes('## structured summary') &&
    allUsers.includes('## extended abstract')
  );
};

const wantsFollowUpFinalAnswer = (messages) => {
  if (wantsFollowUpQuestionsRequest(messages)) {
    return true;
  }
  const last = lastUserMessageText(messages).toLowerCase();
  const allUsers = allUserMessageText(messages);
  return (
    last.includes('answer in a direct and concise tone') &&
    allUsers.includes('"depth"') &&
    allUsers.includes('"breadth"')
  );
};

const wantsExtendedAbstract = (messages) => {
  const text = lastUserMessageText(messages).toLowerCase();
  if (wantsJsonContext(messages)) {
    return false;
  }
  return (
    text.includes('## original abstract (verbatim') ||
    (text.includes('target length') && text.includes('write plain markdown prose'))
  );
};

const wantsExtendedAbstractFinalAnswer = (messages) => {
  const last = lastUserMessageText(messages).toLowerCase();
  const allUsers = allUserMessageText(messages);
  return (
    last.includes('answer in a direct and concise tone') &&
    (allUsers.includes('## original abstract (verbatim') ||
      (allUsers.includes('target length') && allUsers.includes('write plain markdown prose')))
  );
};

const MOCK_EXTENDED_ABSTRACT = `# Extended Abstract (${MOCK_SMOKE_MARKER})

This mock extended abstract expands the smoke-test paper abstract with additional pipeline detail.
The document validates PDF extraction, mock LiteLLM routing, and artifact generation without external providers.
Methods include a one-page synthetic PDF and deterministic HTTP responses.
Key results confirm structured summaries, abstract files, and follow-up question JSON can be produced offline.
`;

const MOCK_FOLLOW_UP_QUESTIONS = {
  depth: [
    'How does the mock LLM distinguish structured summary prompts from context-building JSON?',
    'What failure modes occur if abstract extraction finds no Abstract heading?',
    'How should citation labels use upload stems instead of generic paper.pdf?',
    'What validation ensures follow-up JSON contains exactly five depth and breadth items?',
    'How does PaperQA2 timeout configuration propagate from host env to litellm_params?',
  ],
  breadth: [
    'How would this pipeline integrate with per-project wiki ingest from summary.md?',
    'What comparisons apply between heuristic abstract extraction and LLM-only extraction?',
    'How could batch processing reuse a long-running mock-llm server across E2E runs?',
    'What adjacent tooling could consume follow_up_questions.json for literature review?',
    'How do container rebuild requirements affect CI when only Python runner code changes?',
  ],
};

export const buildMockChatCompletion = (body, { callIndex = 0 } = {}) => {
  const messages = body?.messages ?? [];
  const lastUser = lastUserMessageText(messages).toLowerCase();
  let content;

  if (lastUser.includes('answer in a direct and concise tone')) {
    if (callIndex >= 6) {
      content = JSON.stringify(MOCK_FOLLOW_UP_QUESTIONS);
    } else if (callIndex >= 4) {
      content = MOCK_EXTENDED_ABSTRACT;
    } else {
      content = MOCK_STRUCTURED_SUMMARY;
    }
  } else if (wantsFollowUpFinalAnswer(messages)) {
    content = JSON.stringify(MOCK_FOLLOW_UP_QUESTIONS);
  } else if (wantsJsonContext(messages)) {
    content = JSON.stringify({
      summary:
        'Mock evidence: the document describes a smoke-test PDF used to validate the processing pipeline (p. 1).',
      relevant_score: 8,
    });
  } else if (wantsExtendedAbstractFinalAnswer(messages) || wantsExtendedAbstract(messages)) {
    content = MOCK_EXTENDED_ABSTRACT;
  } else if (wantsStructuredSummary(messages)) {
    content = MOCK_STRUCTURED_SUMMARY;
  } else {
    content = MOCK_SHORT_ANSWER;
  }
  return {
    id: `chatcmpl-mock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body?.model ?? 'LLM_A',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 42,
      completion_tokens: content.length,
      total_tokens: 42 + content.length,
    },
  };
};

export const createMockLlmServer = ({ port = 0, host = '127.0.0.1', onRequest } = {}) => {
  let requestCount = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/health/liveliness')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', mock: true }));
      return;
    }

    if (req.method === 'POST' && isChatPath(url.pathname)) {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        let body = {};
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          body = raw ? JSON.parse(raw) : {};
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Invalid JSON body' } }));
          return;
        }

        requestCount += 1;
        onRequest?.({ body, requestCount });

        const payload = buildMockChatCompletion(body, { callIndex: requestCount });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Mock LLM: no handler for ${req.method} ${url.pathname}` } }));
  });

  const listen = () =>
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      });
    });

  const close = () =>
    new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });

  return { server, listen, close, getRequestCount: () => requestCount };
};

const runCli = async () => {
  const args = process.argv.slice(2);
  let port = Number.parseInt(process.env.MOCK_LLM_PORT ?? '14009', 10) || 14009;
  let host = process.env.MOCK_LLM_HOST ?? '127.0.0.1';

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--port' && args[index + 1]) {
      port = Number.parseInt(args[index + 1], 10) || port;
      index += 1;
    } else if (args[index] === '--host' && args[index + 1]) {
      host = args[index + 1];
      index += 1;
    }
  }

  const mock = createMockLlmServer({
    host,
    port,
    onRequest: ({ requestCount, body }) => {
      const preview = messageText(body.messages).slice(0, 80).replace(/\s+/g, ' ');
      console.log(`[mock-llm] #${requestCount} model=${body.model ?? '?'} preview="${preview}"`);
    },
  });

  const boundPort = await mock.listen();
  console.log(`Mock LLM listening on http://${host}:${boundPort}`);
  console.log(`  POST http://${host}:${boundPort}/chat/completions`);
  console.log(`  Marker in structured replies: ${MOCK_SMOKE_MARKER}`);

  const shutdown = async () => {
    await mock.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
