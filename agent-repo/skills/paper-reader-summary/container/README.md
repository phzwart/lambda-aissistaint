# PaperQA2 Paper Reader Container

This image packages the `paper-reader-summary` CLI with PaperQA2 dependencies. It expects the host to mount one PDF at `/workspace/input/paper.pdf`, mount an output directory at `/workspace/output`, and inject LiteLLM endpoint/key environment variables.

The image does not contain provider keys, MinIO credentials, project state, or a hardcoded model choice.

## Verify after build

From the repo root:

```bash
./podman_services/build_paperqa2_runner.sh
npm run test:paperqa:container
```

Or run the full suite (Node + PaperQA host tests + container smoke when the image exists):

```bash
npm test
```

### End-to-end with mock LLM (no external provider)

After image build, either:

**Option A** — one command (starts mock LLM if port 14009 is free):

```bash
npm run test:paperqa:e2e
```

**Option B** — keep mock running in another terminal (set `MOCK_LLM_FRESH=0` so E2E reuses it):

```bash
npm run mock-llm    # terminal 1
MOCK_LLM_FRESH=0 npm run test:paperqa:e2e   # terminal 2
```

By default `MOCK_LLM_FRESH=1` restarts the mock so the latest `mockLlmServer.mjs` is loaded.

After changing Python runner code, rebuild the image: `podman_services/build_paperqa2_runner.sh` (E2E mounts `cli/` from the repo, so host-only Python edits apply without rebuild).

This runs PaperQA against `fixtures/minimal.pdf` and a local OpenAI-compatible mock at `http://127.0.0.1:14009`. The summary must contain `MOCK_SMOKE_TEST_SUMMARY`.
