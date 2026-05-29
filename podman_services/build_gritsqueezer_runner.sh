#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
IMAGE="${GRITSQUEEZER_RUNNER_IMAGE:-localhost/aissistaint/paper-gritsqueezer:latest}"

# pygrits is installed from GitHub during the build; override to pin a version.
PYGRITS_URL="${PYGRITS_URL:-git+https://github.com/phzwart/pygrits}"
PYGRITS_REF="${PYGRITS_REF:-main}"

cd "$REPO_ROOT"

podman build \
  -t "$IMAGE" \
  --build-arg "PYGRITS_URL=$PYGRITS_URL" \
  --build-arg "PYGRITS_REF=$PYGRITS_REF" \
  -f "agent-repo/skills/paper-gritsqueezer/container/Containerfile" \
  "agent-repo/skills/paper-gritsqueezer"

printf 'Built %s\n' "$IMAGE"
