#!/usr/bin/env bash
# Smoke-test the PaperQA2 runner image: CLI help + unit tests inside the container.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
IMAGE="${PAPERQA2_RUNNER_IMAGE:-localhost/aissistaint/paperqa2-paper-reader:latest}"
CLI_DIR="$REPO_ROOT/agent-repo/skills/paper-reader-summary/cli"

if ! command -v podman >/dev/null 2>&1; then
  echo "SKIP: podman not available; container smoke tests not run." >&2
  exit 0
fi

if ! podman image exists "$IMAGE" >/dev/null 2>&1; then
  echo "SKIP: image $IMAGE not found. Build with podman_services/build_paperqa2_runner.sh" >&2
  exit 0
fi

echo "==> paper-reader-summary --help"
podman run --rm --entrypoint paper-reader-summary "$IMAGE" --help >/dev/null

echo "==> verify installed package includes LiteLLM timeout wiring"
podman run --rm --entrypoint python "$IMAGE" -c "
from paper_reader_summary import paperqa_settings as ps
if not hasattr(ps, '_litellm_params'):
    raise SystemExit(
        'Installed paper_reader_summary is missing _litellm_params. '
        'Rebuild: ./podman_services/build_paperqa2_runner.sh'
    )
runtime = ps.RuntimeSettings(
    llm_model='LLM_A',
    summary_llm_model='LLM_A',
    embedding_model='st-multi-qa-MiniLM-L6-cos-v1',
    litellm_url='http://127.0.0.1:4000',
    litellm_api_key='test',
    pqa_home='/workspace/.pqa',
    request_timeout_seconds=600,
)
params = ps._litellm_params(runtime, proxy_model='litellm_proxy/LLM_A')
assert params.get('timeout') == 600, params
print('timeout wiring ok')
"

echo "==> unittest (repo cli/ mounted — should match image after rebuild)"
podman run --rm \
  --entrypoint python \
  -v "$CLI_DIR:/workspace/cli:ro" \
  -e PYTHONPATH=/workspace/cli \
  "$IMAGE" \
  -m unittest discover -s /workspace/cli/tests -p 'test_*.py' -v

echo "OK: PaperQA2 runner image smoke tests passed ($IMAGE)"
