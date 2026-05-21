#!/usr/bin/env bash
# End-to-end PaperQA smoke test: minimal PDF + mock LLM server (no external provider).
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
IMAGE="${PAPERQA2_RUNNER_IMAGE:-localhost/aissistaint/paperqa2-paper-reader:latest}"
CLI_DIR="$REPO_ROOT/agent-repo/skills/paper-reader-summary/cli"
FIXTURE_PDF="$REPO_ROOT/agent-repo/skills/paper-reader-summary/fixtures/minimal.pdf"
MOCK_PORT="${MOCK_LLM_PORT:-14009}"
MOCK_HOST="${MOCK_LLM_HOST:-127.0.0.1}"
MOCK_URL="http://${MOCK_HOST}:${MOCK_PORT}"

if ! command -v podman >/dev/null 2>&1; then
  echo "SKIP: podman not available." >&2
  exit 0
fi

if ! podman image exists "$IMAGE" >/dev/null 2>&1; then
  echo "SKIP: image $IMAGE not found. Build with podman_services/build_paperqa2_runner.sh" >&2
  exit 0
fi

if [[ ! -f "$FIXTURE_PDF" ]]; then
  echo "==> generating minimal PDF fixture"
  node "$REPO_ROOT/scripts/generate-minimal-pdf.mjs"
fi

MOCK_STARTED_BY_US=0
MOCK_PID=""

if [[ "${MOCK_LLM_FRESH:-1}" == "1" ]] && command -v fuser >/dev/null 2>&1; then
  fuser -k "${MOCK_PORT}/tcp" 2>/dev/null || true
  sleep 0.3
fi

if curl -sf "$MOCK_URL/health" >/dev/null 2>&1; then
  echo "==> reusing mock LLM already listening on $MOCK_URL"
else
  echo "==> starting mock LLM on $MOCK_URL"
  node "$REPO_ROOT/server/mockLlmServer.mjs" --host "$MOCK_HOST" --port "$MOCK_PORT" &
  MOCK_PID=$!
  MOCK_STARTED_BY_US=1
  cleanup() {
    if [[ "$MOCK_STARTED_BY_US" == 1 && -n "$MOCK_PID" ]]; then
      kill "$MOCK_PID" 2>/dev/null || true
      wait "$MOCK_PID" 2>/dev/null || true
    fi
  }
  trap cleanup EXIT

  ready=0
  for _ in $(seq 1 30); do
    if curl -sf "$MOCK_URL/health" >/dev/null 2>&1; then
      ready=1
      break
    fi
    if ! kill -0 "$MOCK_PID" 2>/dev/null; then
      break
    fi
    sleep 0.2
  done
  if [[ "$ready" != 1 ]]; then
    echo "Could not start mock LLM on $MOCK_URL (port may be in use by a non-mock process)." >&2
    echo "Stop the other listener or set MOCK_LLM_PORT to a free port." >&2
    exit 1
  fi
fi

curl -sf "$MOCK_URL/health" >/dev/null || {
  echo "Mock LLM server is not reachable at $MOCK_URL" >&2
  exit 1
}

WORK_DIR="$(mktemp -d)"
INPUT_DIR="$WORK_DIR/input"
OUTPUT_DIR="$WORK_DIR/output"
mkdir -p "$INPUT_DIR" "$OUTPUT_DIR"
FIXTURE_STEM="e2e-mock-minimal"
cp "$FIXTURE_PDF" "$INPUT_DIR/${FIXTURE_STEM}.pdf"
cat >"$INPUT_DIR/litellm-runtime.json" <<EOF
{
  "modelAlias": "LLM_A",
  "litellmUrl": "$MOCK_URL",
  "requestTimeoutSeconds": 120,
  "providerModel": "mock",
  "configuredName": "LLM_A"
}
EOF

cat >"$INPUT_DIR/skill-runtime.json" <<EOF
{
  "fileId": "e2e-mock-file-id",
  "fileName": "minimal.pdf",
  "objectKey": "loaded/${FIXTURE_STEM}.pdf",
  "citationLabel": "${FIXTURE_STEM}",
  "instructions": {
    "extendedAbstract": "Expand the mock abstract to roughly five times its length using only the paper.",
    "followUpQuestions": "Return JSON only with keys \"depth\" and \"breadth\", each an array of exactly five question strings grounded in the paper.",
    "extendedAbstractEnabled": true,
    "followUpQuestionsEnabled": true
  }
}
EOF

echo "==> paper-reader-summary E2E (mock LLM, --network=host)"
podman run --rm --network=host \
  --user 0:0 \
  -v "$INPUT_DIR:/workspace/input:ro,Z" \
  -v "$OUTPUT_DIR:/workspace/output:rw,Z" \
  -v "$CLI_DIR:/workspace/cli:ro" \
  -e PYTHONPATH=/workspace/cli \
  -e "PAPERQA_LITELLM_URL=$MOCK_URL" \
  -e PAPERQA_LITELLM_API_KEY=mock-smoke-key \
  -e PAPERQA_DISABLE_DOC_VALID_CHECK=1 \
  -e HF_HOME=/workspace/output/.hf \
  --entrypoint python \
  "$IMAGE" \
  -m paper_reader_summary \
  --input "/workspace/input/${FIXTURE_STEM}.pdf" \
  --output /workspace/output \
  --litellm-url "$MOCK_URL" \
  --litellm-runtime /workspace/input/litellm-runtime.json \
  --runtime-config /workspace/input/skill-runtime.json \
  --paper-id e2e-mock-file-id \
  --citation-label "$FIXTURE_STEM" \
  --llm-model LLM_A \
  --summary-llm-model LLM_A \
  --embedding-model st-multi-qa-MiniLM-L6-cos-v1

for artifact in extracted.txt abstract.txt figures_manifest.json summary.md summary.json extended_abstract.md follow_up_questions.json knowledge_graph.json; do
  if [[ ! -f "$OUTPUT_DIR/$artifact" ]]; then
    echo "Missing expected artifact: $artifact" >&2
    ls -la "$OUTPUT_DIR" >&2 || true
    exit 1
  fi
done

if ! grep -q 'MOCK_SMOKE_TEST_SUMMARY' "$OUTPUT_DIR/summary.md"; then
  echo "summary.md does not contain mock marker (mock LLM may not have been used)" >&2
  head -n 20 "$OUTPUT_DIR/summary.md" >&2 || true
  exit 1
fi

if grep -q 'paper.pdf' "$OUTPUT_DIR/summary.md"; then
  echo "summary.md still cites generic paper.pdf; expected stem ${FIXTURE_STEM}.pdf" >&2
  exit 1
fi

if ! grep -q 'MOCK_SMOKE_TEST_SUMMARY' "$OUTPUT_DIR/extended_abstract.md"; then
  echo "extended_abstract.md missing mock marker" >&2
  exit 1
fi

if ! python3 -c "import json; d=json.load(open('$OUTPUT_DIR/follow_up_questions.json')); assert len(d.get('depth',[]))==5 and len(d.get('breadth',[]))==5"; then
  echo "follow_up_questions.json invalid" >&2
  cat "$OUTPUT_DIR/follow_up_questions.json" >&2 || true
  exit 1
fi

if ! python3 -c "import json; d=json.load(open('$OUTPUT_DIR/knowledge_graph.json')); assert isinstance(d.get('entities'), list) and isinstance(d.get('relationships'), list)"; then
  echo "knowledge_graph.json invalid" >&2
  cat "$OUTPUT_DIR/knowledge_graph.json" >&2 || true
  exit 1
fi

echo "OK: PaperQA E2E mock LLM smoke passed"
echo "  summary.md: $(wc -c <"$OUTPUT_DIR/summary.md") bytes"
echo "  extracted.txt: $(wc -c <"$OUTPUT_DIR/extracted.txt") bytes"
