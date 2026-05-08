#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
IMAGE="${PAPERQA2_RUNNER_IMAGE:-localhost/aissistaint/paperqa2-paper-reader:latest}"

cd "$REPO_ROOT"

podman build \
  -t "$IMAGE" \
  -f "agent-repo/skills/paper-reader-summary/container/Containerfile" \
  "agent-repo/skills/paper-reader-summary"

printf 'Built %s\n' "$IMAGE"
