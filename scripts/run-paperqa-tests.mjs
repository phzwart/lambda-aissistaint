#!/usr/bin/env node
/**
 * Runs PaperQA runner unit tests on the host, then container smoke tests when the image exists.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliDir = join(root, 'agent-repo/skills/paper-reader-summary/cli');
const testsDir = join(cliDir, 'tests');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
};

if (!existsSync(testsDir)) {
  console.error(`Missing PaperQA tests directory: ${testsDir}`);
  process.exit(1);
}

console.log('==> PaperQA Python unit tests (host)');
const hostStatus = run(
  process.env.PYTHON ?? 'python3',
  ['-m', 'unittest', 'discover', '-s', testsDir, '-p', 'test_*.py', '-v'],
  {
    env: {
      ...process.env,
      PYTHONPATH: [cliDir, process.env.PYTHONPATH].filter(Boolean).join(':'),
    },
  },
);

if (hostStatus !== 0) {
  process.exit(hostStatus);
}

const smokeScript = join(root, 'podman_services/test_paperqa2_runner.sh');
if (existsSync(smokeScript)) {
  console.log('==> PaperQA container smoke tests');
  const containerStatus = run('bash', [smokeScript], { cwd: root });
  process.exit(containerStatus);
}

process.exit(0);
