import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { paperqaRunnerTimeoutMs } from './paperqaRuntime.mjs';

const defaultTimeoutMs = paperqaRunnerTimeoutMs();

const emitLogLines = (chunk, stream, onLogLine) => {
  const text = chunk.toString();
  if (!onLogLine) {
    return text;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (trimmed) {
      onLogLine(`[${stream}] ${trimmed}`);
    }
  }
  return text;
};

const runProcess = (command, args, { env, timeoutMs, onLogLine }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let logForwarding = true;

    const forwardLog = (chunk, stream) => {
      if (!logForwarding) {
        return '';
      }
      return emitLogLines(chunk, stream, onLogLine);
    };

    const stopForwarding = () => {
      logForwarding = false;
      child.stdout?.removeAllListeners('data');
      child.stderr?.removeAllListeners('data');
    };

    const killGraceMs =
      Number.parseInt(process.env.PAPERQA_RUNNER_KILL_GRACE_MS ?? '5000', 10) || 5000;

    const terminateChild = async () => {
      stopForwarding();
      child.kill('SIGTERM');
      await Promise.race([
        once(child, 'close'),
        new Promise((resolveAfterGrace) => setTimeout(resolveAfterGrace, killGraceMs)),
      ]);
      if (child.exitCode === null) {
        child.kill('SIGKILL');
        await Promise.race([once(child, 'close'), new Promise((r) => setTimeout(r, 2000))]);
      }
    };

    child.stdout.on('data', (chunk) => {
      stdout += forwardLog(chunk, 'stdout');
    });
    child.stderr.on('data', (chunk) => {
      stderr += forwardLog(chunk, 'stderr');
    });

    const timer = setTimeout(() => {
      void (async () => {
        await terminateChild();
        if (settled) {
          return;
        }
        settled = true;
        reject(
          Object.assign(new Error(`PaperQA runner timed out after ${timeoutMs}ms.`), {
            status: 504,
            stderr,
          }),
        );
      })();
    }, timeoutMs);

    const finish = (handler) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      stopForwarding();
      handler();
    };

    child.on('error', (error) => {
      finish(() => reject(error));
    });

    child.on('close', (code) => {
      finish(() => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        const detail = stderr.trim() || stdout.trim() || `exit code ${code}`;
        reject(
          Object.assign(new Error(`PaperQA runner failed: ${detail}`), {
            status: 502,
            stderr,
            stdout,
          }),
        );
      });
    });
  });

export const runPaperqaSummary = async ({
  inputPdfPath,
  outputDir,
  llmModel,
  summaryLlmModel,
  embeddingModel,
  litellmUrl,
  litellmApiKey,
  litellmRuntime,
  skillRuntimePath,
  paperId,
  citationLabel,
  sourceHash,
  onLogLine,
  image = process.env.PAPERQA2_RUNNER_IMAGE ?? 'localhost/aissistaint/paperqa2-paper-reader:latest',
  timeoutMs = defaultTimeoutMs,
}) => {
  if (!litellmUrlGuard(litellmUrl)) {
    throw Object.assign(new Error('PAPERQA_LITELLM_URL (or LiteLLM URL) is not configured.'), { status: 503 });
  }
  if (!litellmApiKey?.trim()) {
    throw Object.assign(
      new Error('PAPERQA_LITELLM_API_KEY or LITELLM_API_KEY is required for PaperQA processing.'),
      { status: 503 },
    );
  }
  if (!llmModel?.trim() || !summaryLlmModel?.trim() || !embeddingModel?.trim()) {
    throw Object.assign(new Error('LiteLLM model aliases are required for PaperQA processing.'), { status: 400 });
  }

  try {
    await access(inputPdfPath, constants.R_OK);
  } catch {
    throw Object.assign(new Error(`Input PDF is not readable: ${inputPdfPath}`), { status: 400 });
  }

  const inputDir = dirname(inputPdfPath);
  const inputBasename = basename(inputPdfPath);
  const containerInputPath = `/workspace/input/${inputBasename}`;
  const runtimePath = join(inputDir, 'litellm-runtime.json');
  const normalizedUrl = litellmUrl.replace(/\/$/, '');
  const runtimePayload = litellmRuntime ?? {
    modelAlias: llmModel,
    litellmUrl: normalizedUrl,
  };
  await writeFile(
    runtimePath,
    `${JSON.stringify({ ...runtimePayload, litellmUrl: normalizedUrl }, null, 2)}\n`,
    'utf8',
  );

  const podman = process.env.PODMAN_BIN ?? 'podman';
  const network = process.env.PAPERQA_PODMAN_NETWORK ?? 'host';
  const args = [
    'run',
    '--rm',
    '--user',
    '0:0',
    `--network=${network}`,
    '-v',
    `${inputDir}:/workspace/input:ro,Z`,
    '-v',
    `${outputDir}:/workspace/output:rw,Z`,
    '-e',
    `PAPERQA_LITELLM_URL=${normalizedUrl}`,
    '-e',
    `PAPERQA_LITELLM_API_KEY=${litellmApiKey}`,
    image,
    '--input',
    containerInputPath,
    '--output',
    '/workspace/output',
    '--litellm-url',
    normalizedUrl,
    '--litellm-runtime',
    '/workspace/input/litellm-runtime.json',
    '--llm-model',
    llmModel,
    '--summary-llm-model',
    summaryLlmModel,
    '--embedding-model',
    embeddingModel,
  ];

  if (skillRuntimePath) {
    try {
      await access(skillRuntimePath, constants.R_OK);
      args.push('--runtime-config', '/workspace/input/skill-runtime.json');
    } catch {
      // optional host-side config
    }
  }
  if (paperId?.trim()) {
    args.push('--paper-id', paperId.trim());
  }
  if (citationLabel?.trim()) {
    args.push('--citation-label', citationLabel.trim());
  }
  if (sourceHash?.trim()) {
    args.push('--source-hash', sourceHash.trim());
  }

  if (onLogLine) {
    onLogLine(`[info] podman ${args.slice(0, 8).join(' ')} …`);
  }

  const litellmTimeoutSeconds =
    Number(litellmRuntime?.requestTimeoutSeconds) ||
    Number.parseInt(process.env.PAPERQA_LITELLM_TIMEOUT_S ?? '900', 10) ||
    900;

  const { stdout, stderr } = await runProcess(podman, args, {
    timeoutMs,
    onLogLine,
    env: {
      PAPERQA_LITELLM_URL: normalizedUrl,
      PAPERQA_LITELLM_API_KEY: litellmApiKey,
      PAPERQA_LITELLM_TIMEOUT_S: String(litellmTimeoutSeconds),
    },
  });

  return { stdout, stderr, image };
};

function litellmUrlGuard(url) {
  return Boolean(String(url ?? '').trim().startsWith('http'));
}
