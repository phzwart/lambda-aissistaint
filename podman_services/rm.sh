#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${STACK_NAME:-platform-demo}"
ROOTFUL_CLEANUP="${ROOTFUL_CLEANUP:-0}"
KILL_STALE_HELPERS="${KILL_STALE_HELPERS:-0}"

containers=(
  "${STACK_NAME}-postgres"
  "${STACK_NAME}-app-postgres"
  "${STACK_NAME}-keycloak"
  "${STACK_NAME}-openbao"
  "${STACK_NAME}-minio"
  "${STACK_NAME}-litellm"
  "${STACK_NAME}-gateway"
)

echo "Removing rootless Podman containers for ${STACK_NAME}..."
podman rm -f "${containers[@]}" 2>/dev/null || true

if [[ "$ROOTFUL_CLEANUP" == "1" ]]; then
  echo "ROOTFUL_CLEANUP=1 set. Removing matching rootful Podman containers..."
  sudo podman rm -f "${containers[@]}" 2>/dev/null || true
else
  echo "Skipping rootful container cleanup. Re-run with ROOTFUL_CLEANUP=1 only if you accidentally used sudo podman."
fi

if [[ "$KILL_STALE_HELPERS" == "1" ]]; then
  echo "KILL_STALE_HELPERS=1 set. Killing stale root-owned helper processes matching ${STACK_NAME}..."
  sudo pkill -f "conmon.*${STACK_NAME}-" 2>/dev/null || true
  sudo pkill -f "rootlessport.*${STACK_NAME}-" 2>/dev/null || true
else
  echo "Skipping process killing. Re-run with KILL_STALE_HELPERS=1 only for confirmed stale conmon/rootlessport helpers."
fi

echo "Remaining listeners on stack ports, if any:"
ss -ltnp '( sport = :5433 or sport = :8080 or sport = :8200 or sport = :8201 or sport = :9000 or sport = :9001 or sport = :4000 or sport = :8088 or sport = :8443 )' || true

