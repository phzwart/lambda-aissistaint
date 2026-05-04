#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${STACK_NAME:-platform-demo}"
BASE_DIR="${BASE_DIR:-$HOME/$STACK_NAME}"
NETWORK_NAME="${NETWORK_NAME:-${STACK_NAME}-net}"
KC_REALM="${KC_REALM:-minio}"
KC_GROUP="${KC_GROUP:-platform-users}"
KC_ADMIN_USER="${KC_ADMIN_USER:-admin}"
KC_ADMIN_PASSWORD="${KC_ADMIN_PASSWORD:-}"
KC_DB_PASSWORD="${KC_DB_PASSWORD:-}"
APP_POSTGRES_DB="${APP_POSTGRES_DB:-aissistaint}"
APP_POSTGRES_USER="${APP_POSTGRES_USER:-aissistaint}"
APP_POSTGRES_PASSWORD="${APP_POSTGRES_PASSWORD:-}"
APP_POSTGRES_PORT="${APP_POSTGRES_PORT:-5433}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-}"
MINIO_APP_ACCESS_KEY="${MINIO_APP_ACCESS_KEY:-aissistaint-app}"
MINIO_APP_SECRET_KEY="${MINIO_APP_SECRET_KEY:-}"
MINIO_REMOVAL_ACCESS_KEY="${MINIO_REMOVAL_ACCESS_KEY:-aissistaint-removal}"
MINIO_REMOVAL_SECRET_KEY="${MINIO_REMOVAL_SECRET_KEY:-}"
MINIO_BUCKET="${MINIO_BUCKET:-project-a}"
MINIO_POLICY_NAME="${MINIO_POLICY_NAME:-project-a-rw}"
MINIO_APP_POLICY_NAME="${MINIO_APP_POLICY_NAME:-aissistaint-app-rw}"
MINIO_REMOVAL_POLICY_NAME="${MINIO_REMOVAL_POLICY_NAME:-project-removal-rw}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://127.0.0.1:9000}"
PROJECT_BUCKET_PREFIX="${PROJECT_BUCKET_PREFIX:-aissistaint-project}"
PROJECT_LOADED_PREFIX="${PROJECT_LOADED_PREFIX:-loaded}"
PROJECT_PARSED_PREFIX="${PROJECT_PARSED_PREFIX:-parsed}"
PROJECT_METADATA_OBJECT_KEY="${PROJECT_METADATA_OBJECT_KEY:-project.json}"
VITE_LLM_TIERS="${VITE_LLM_TIERS:-A,B,C}"
CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-https://aissistaint.localhost:8443,http://localhost:5173,http://127.0.0.1:5173}"
LLM_ALLOWED_HOSTS="${LLM_ALLOWED_HOSTS:-api.cborg.lbl.gov}"
LLM_ALLOW_PRIVATE_ENDPOINTS="${LLM_ALLOW_PRIVATE_ENDPOINTS:-false}"
LLM_ALLOW_HTTP_ENDPOINTS="${LLM_ALLOW_HTTP_ENDPOINTS:-false}"
LLM_ALLOW_ANY_HOSTS="${LLM_ALLOW_ANY_HOSTS:-false}"
LLM_DEV_MODE="${LLM_DEV_MODE:-false}"
LLM_REQUEST_TIMEOUT_MS="${LLM_REQUEST_TIMEOUT_MS:-30000}"
API_PORT="${API_PORT:-8787}"
LITELLM_PORT="${LITELLM_PORT:-4000}"
LITELLM_MASTER_KEY="${LITELLM_MASTER_KEY:-}"
LITELLM_ADMIN_KEY="${LITELLM_ADMIN_KEY:-}"
LITELLM_API_KEY="${LITELLM_API_KEY:-}"
LITELLM_API_KEY_MODEL_SCOPE_VERSION="${LITELLM_API_KEY_MODEL_SCOPE_VERSION:-}"
LITELLM_DATABASE_URL="${LITELLM_DATABASE_URL:-}"
LITELLM_ADMIN_BROKER_HOST="${LITELLM_ADMIN_BROKER_HOST:-127.0.0.1}"
LITELLM_ADMIN_BROKER_PORT="${LITELLM_ADMIN_BROKER_PORT:-8788}"
LITELLM_ADMIN_BROKER_URL="${LITELLM_ADMIN_BROKER_URL:-http://${LITELLM_ADMIN_BROKER_HOST}:${LITELLM_ADMIN_BROKER_PORT}}"
LITELLM_ADMIN_BROKER_TOKEN="${LITELLM_ADMIN_BROKER_TOKEN:-}"
LITELLM_SECRET_BROKER_TOKEN="${LITELLM_SECRET_BROKER_TOKEN:-}"
GOOSE_PORT="${GOOSE_PORT:-3284}"
GOOSE_PROVIDER="${GOOSE_PROVIDER:-openai}"
GOOSE_MODEL="${GOOSE_MODEL:-LLM_A}"
GOOSE_SECRET_KEY="${GOOSE_SECRET_KEY:-}"
GOOSE_WORKING_DIR="${GOOSE_WORKING_DIR:-/workspace}"
GOOSE_CHATBOT_BACKEND="${GOOSE_CHATBOT_BACKEND:-goose}"
GOOSE_CHATBOT_DEFAULT_TIER="${GOOSE_CHATBOT_DEFAULT_TIER:-A}"
GOOSE_CHATBOT_MAX_MESSAGES="${GOOSE_CHATBOT_MAX_MESSAGES:-24}"
GOOSE_CHATBOT_MAX_TOKENS="${GOOSE_CHATBOT_MAX_TOKENS:-768}"
GOOSE_CHATBOT_TEMPERATURE="${GOOSE_CHATBOT_TEMPERATURE:-0.2}"
GOOSE_CHATBOT_SYSTEM_PROMPT="${GOOSE_CHATBOT_SYSTEM_PROMPT:-You are Goose, a concise AI assistant embedded in AIssistAInt. Answer helpfully, avoid exposing secrets, and ask for missing project context when needed.}"
SECRET_STORE_PROVIDER="${SECRET_STORE_PROVIDER:-openbao}"
SECRET_ENCRYPTION_KEY="${SECRET_ENCRYPTION_KEY:-}"
SECRET_ENCRYPTION_KEY_VERSION="${SECRET_ENCRYPTION_KEY_VERSION:-v1}"
TLS_GATEWAY_ENABLED="${TLS_GATEWAY_ENABLED:-1}"
TLS_GATEWAY_PORT="${TLS_GATEWAY_PORT:-8443}"
TLS_HTTP_PORT="${TLS_HTTP_PORT:-8088}"
EXPOSE_RAW_SERVICE_PORTS="${EXPOSE_RAW_SERVICE_PORTS:-1}"
API_HOST="${API_HOST:-127.0.0.1}"
GATEWAY_BIND_HOST="${GATEWAY_BIND_HOST:-127.0.0.1}"
APP_PUBLIC_HOST="${APP_PUBLIC_HOST:-aissistaint.localhost}"
KEYCLOAK_PUBLIC_HOST="${KEYCLOAK_PUBLIC_HOST:-keycloak.aissistaint.localhost}"
OPENBAO_PUBLIC_HOST="${OPENBAO_PUBLIC_HOST:-openbao.aissistaint.localhost}"
MINIO_PUBLIC_HOST="${MINIO_PUBLIC_HOST:-minio.aissistaint.localhost}"
MINIO_CONSOLE_PUBLIC_HOST="${MINIO_CONSOLE_PUBLIC_HOST:-minio-console.aissistaint.localhost}"
OPENBAO_KV_MOUNT="${OPENBAO_KV_MOUNT:-secret}"
OPENBAO_RW_PREFIX="${OPENBAO_RW_PREFIX:-app-tokens}"
CLEAN_DATA="${CLEAN_DATA:-0}"
MANAGE_TLS_GATEWAY="${MANAGE_TLS_GATEWAY:-1}"
MANAGE_KEYCLOAK_POSTGRES="${MANAGE_KEYCLOAK_POSTGRES:-1}"
MANAGE_KEYCLOAK="${MANAGE_KEYCLOAK:-1}"
MANAGE_APP_POSTGRES="${MANAGE_APP_POSTGRES:-1}"
MANAGE_OPENBAO="${MANAGE_OPENBAO:-1}"
MANAGE_MINIO="${MANAGE_MINIO:-1}"
MANAGE_LITELLM="${MANAGE_LITELLM:-1}"
MANAGE_GOOSE="${MANAGE_GOOSE:-1}"

CADDY_IMAGE="${CADDY_IMAGE:-docker.io/library/caddy:2}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-docker.io/library/postgres:16}"
KEYCLOAK_IMAGE="${KEYCLOAK_IMAGE:-quay.io/keycloak/keycloak:26.6.1}"
OPENBAO_IMAGE="${OPENBAO_IMAGE:-quay.io/openbao/openbao:latest}"
MINIO_IMAGE="${MINIO_IMAGE:-quay.io/minio/minio:RELEASE.2025-02-18T16-25-55Z}"
MINIO_MC_IMAGE="${MINIO_MC_IMAGE:-quay.io/minio/mc:latest}"
LITELLM_IMAGE="${LITELLM_IMAGE:-ghcr.io/berriai/litellm:main-latest}"
GOOSE_IMAGE="${GOOSE_IMAGE:-ghcr.io/aaif-goose/goose:latest}"

CADDY_CONTAINER="${STACK_NAME}-gateway"
POSTGRES_CONTAINER="${STACK_NAME}-postgres"
APP_POSTGRES_CONTAINER="${STACK_NAME}-app-postgres"
KEYCLOAK_CONTAINER="${STACK_NAME}-keycloak"
OPENBAO_CONTAINER="${STACK_NAME}-openbao"
MINIO_CONTAINER="${STACK_NAME}-minio"
LITELLM_CONTAINER="${STACK_NAME}-litellm"
GOOSE_CONTAINER="${STACK_NAME}-goose"
MINIO_CLIENT_ID="${MINIO_CLIENT_ID:-minio-console}"
OPENBAO_CLIENT_ID="${OPENBAO_CLIENT_ID:-openbao}"
AISSISTAINT_UI_CLIENT_ID="${AISSISTAINT_UI_CLIENT_ID:-aissistaint-ui}"
AISSISTAINT_UI_DEV_PORT="${AISSISTAINT_UI_DEV_PORT:-5173}"

PUBLIC_APP_URL="${PUBLIC_APP_URL:-https://${APP_PUBLIC_HOST}:${TLS_GATEWAY_PORT}}"
PUBLIC_KEYCLOAK_URL="${PUBLIC_KEYCLOAK_URL:-https://${KEYCLOAK_PUBLIC_HOST}:${TLS_GATEWAY_PORT}}"
PUBLIC_OPENBAO_URL="${PUBLIC_OPENBAO_URL:-https://${OPENBAO_PUBLIC_HOST}:${TLS_GATEWAY_PORT}}"
PUBLIC_MINIO_URL="${PUBLIC_MINIO_URL:-https://${MINIO_PUBLIC_HOST}:${TLS_GATEWAY_PORT}}"
PUBLIC_MINIO_CONSOLE_URL="${PUBLIC_MINIO_CONSOLE_URL:-https://${MINIO_CONSOLE_PUBLIC_HOST}:${TLS_GATEWAY_PORT}}"
INTERNAL_KEYCLOAK_URL="${INTERNAL_KEYCLOAK_URL:-http://127.0.0.1:8080}"
INTERNAL_OPENBAO_URL="${INTERNAL_OPENBAO_URL:-http://127.0.0.1:8200}"
INTERNAL_MINIO_ENDPOINT="${INTERNAL_MINIO_ENDPOINT:-http://127.0.0.1:9000}"
INTERNAL_LITELLM_URL="${INTERNAL_LITELLM_URL:-http://127.0.0.1:${LITELLM_PORT}}"
INTERNAL_GOOSE_URL="${INTERNAL_GOOSE_URL:-http://127.0.0.1:${GOOSE_PORT}}"
GATEWAY_KEYCLOAK_UPSTREAM="${GATEWAY_KEYCLOAK_UPSTREAM:-http://${KEYCLOAK_CONTAINER}:8080}"
GATEWAY_OPENBAO_UPSTREAM="${GATEWAY_OPENBAO_UPSTREAM:-http://${OPENBAO_CONTAINER}:8200}"
GATEWAY_MINIO_UPSTREAM="${GATEWAY_MINIO_UPSTREAM:-http://${MINIO_CONTAINER}:9000}"
GATEWAY_MINIO_CONSOLE_UPSTREAM="${GATEWAY_MINIO_CONSOLE_UPSTREAM:-http://${MINIO_CONTAINER}:9001}"

HOST_IP="${HOST_IP:-}"
if [[ -z "$HOST_IP" ]]; then
  read -r HOST_IP _ < <(hostname -I 2>/dev/null || true)
fi
if [[ -z "$HOST_IP" ]]; then
  ROUTE_INFO="$(ip route get 1.1.1.1 2>/dev/null || true)"
  set -- $ROUTE_INFO
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "src" && $# -gt 1 ]]; then
      HOST_IP="$2"
      break
    fi
    shift
  done
fi
if [[ -z "$HOST_IP" ]]; then
  echo "Could not determine HOST_IP. Set HOST_IP manually and rerun." >&2
  exit 1
fi

BASE_KEYCLOAK_DIR="$BASE_DIR/keycloak"
POSTGRES_DATA_DIR="$BASE_KEYCLOAK_DIR/postgres-data"
BASE_APP_POSTGRES_DIR="$BASE_DIR/app-postgres"
APP_POSTGRES_DATA_DIR="$BASE_APP_POSTGRES_DIR/data"
BASE_OPENBAO_DIR="$BASE_DIR/openbao"
OPENBAO_DATA_DIR="$BASE_OPENBAO_DIR/data"
OPENBAO_CONFIG_DIR="$BASE_OPENBAO_DIR/config"
OPENBAO_CONFIG_FILE="$OPENBAO_CONFIG_DIR/openbao.hcl"
OPENBAO_INIT_FILE="$BASE_OPENBAO_DIR/openbao-init.txt"
BASE_MINIO_DIR="$BASE_DIR/minio"
MINIO_DATA_DIR="$BASE_MINIO_DIR/data"
MINIO_MC_DIR="$BASE_MINIO_DIR/mc"
MINIO_POLICY_FILE="$BASE_DIR/${MINIO_POLICY_NAME}.json"
MINIO_APP_POLICY_FILE="$BASE_DIR/${MINIO_APP_POLICY_NAME}.json"
MINIO_REMOVAL_POLICY_FILE="$BASE_DIR/${MINIO_REMOVAL_POLICY_NAME}.json"
BASE_LITELLM_DIR="$BASE_DIR/litellm"
LITELLM_CONFIG_DIR="$BASE_LITELLM_DIR/config"
LITELLM_CONFIG_FILE="$LITELLM_CONFIG_DIR/config.yaml"
LITELLM_SECRET_MANAGER_FILE="$LITELLM_CONFIG_DIR/openbao_secret_manager.py"
BASE_GOOSE_DIR="$BASE_DIR/goose"
GOOSE_CONFIG_DIR="$BASE_GOOSE_DIR/config"
GOOSE_WORKSPACE_DIR="$BASE_GOOSE_DIR/workspace"
BASE_SECRET_DIR="$BASE_DIR/secrets"
SECRET_ENCRYPTION_KEY_FILE="${SECRET_ENCRYPTION_KEY_FILE:-$BASE_SECRET_DIR/provider-key-encryption.key}"
API_SECRET_ENV_FILE="${API_SECRET_ENV_FILE:-$BASE_SECRET_DIR/api-runtime.env}"
API_REMOVAL_ENV_FILE="${API_REMOVAL_ENV_FILE:-$BASE_SECRET_DIR/api-removal.env}"
API_LOAD_REMOVAL_SECRETS="${API_LOAD_REMOVAL_SECRETS:-false}"
LITELLM_ADMIN_BROKER_ENV_FILE="${LITELLM_ADMIN_BROKER_ENV_FILE:-$BASE_SECRET_DIR/litellm-admin-broker.env}"
LITELLM_SECRET_BROKER_ENV_FILE="${LITELLM_SECRET_BROKER_ENV_FILE:-$BASE_SECRET_DIR/litellm-secret-broker.env}"
GOOSE_SECRET_ENV_FILE="${GOOSE_SECRET_ENV_FILE:-$BASE_SECRET_DIR/goose.env}"
BASE_CADDY_DIR="$BASE_DIR/caddy"
CADDY_CONFIG_DIR="$BASE_CADDY_DIR/config"
CADDY_DATA_DIR="$BASE_CADDY_DIR/data"
CADDYFILE="$CADDY_CONFIG_DIR/Caddyfile"
ENV_FILE="$BASE_DIR/${STACK_NAME}.env"
RUNTIME_ENV_FILE="${RUNTIME_ENV_FILE:-$BASE_DIR/${STACK_NAME}-runtime.env}"
KEYCLOAK_SECRETS_OUT="$BASE_DIR/keycloak-secrets.out"
PASSWORD_OUT_FILE="${PASSWORD_OUT_FILE:-$BASE_DIR/keycloak-user-passwords.out}"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

info() { printf '\n==> %s\n' "$*"; }
warn() { printf '\n[warn] %s\n' "$*" >&2; }

container_exists() { podman container exists "$1" >/dev/null 2>&1; }
network_exists() { podman network exists "$1" >/dev/null 2>&1; }

wait_for_http_200() {
  local url="$1"
  local name="$2"
  local tries="${3:-120}"
  local sleep_sec="${4:-2}"
  local code i
  for ((i=1; i<=tries; i++)); do
    code="$(curl -ksS -o /dev/null -w '%{http_code}' "$url" || true)"
    if [[ "$code" == "200" ]]; then
      return 0
    fi
    sleep "$sleep_sec"
  done
  echo "Timed out waiting for $name at $url" >&2
  return 1
}

wait_for_file() {
  local path="$1"
  local name="$2"
  local tries="${3:-60}"
  local sleep_sec="${4:-1}"
  local i
  for ((i=1; i<=tries; i++)); do
    if [[ -s "$path" ]]; then
      return 0
    fi
    sleep "$sleep_sec"
  done
  echo "Timed out waiting for $name at $path" >&2
  return 1
}

wait_for_openbao() {
  local tries="${1:-120}"
  local code i
  for ((i=1; i<=tries; i++)); do
    code="$(curl -ksS -o /dev/null -w '%{http_code}' "$INTERNAL_OPENBAO_URL/v1/sys/health" || true)"
    case "$code" in
      200|429|472|473|501|503) return 0 ;;
    esac
    sleep 2
  done
  echo "Timed out waiting for OpenBao API" >&2
  return 1
}

wait_for_postgres() {
  local container="$1"
  local user="$2"
  local db="$3"
  local tries="${4:-60}"
  local i
  for ((i=1; i<=tries; i++)); do
    if podman exec "$container" pg_isready -U "$user" -d "$db" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for PostgreSQL container $container" >&2
  return 1
}

sync_postgres_user_password() {
  local container="$1"
  local user="$2"
  local db="$3"
  local password="$4"

  wait_for_postgres "$container" "$user" "$db"
  podman exec \
    -e TARGET_USER="$user" \
    -e TARGET_DB="$db" \
    -e TARGET_PASSWORD="$password" \
    "$container" bash -lc '
      set -euo pipefail
      escaped_password="$(printf "%s" "$TARGET_PASSWORD" | sed "s/'\''/'\'''\''/g")"
      psql -v ON_ERROR_STOP=1 -U "$TARGET_USER" -d "$TARGET_DB" \
        -c "ALTER USER \"$TARGET_USER\" WITH PASSWORD '\''$escaped_password'\'';" >/dev/null
    '
}

ensure_keycloak_admin_login() {
  if podman exec \
    -e KC_ADMIN_USER="$KC_ADMIN_USER" \
    -e KC_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
    "$KEYCLOAK_CONTAINER" bash -lc '
      set -euo pipefail
      export PATH=/opt/keycloak/bin:$PATH
      kcadm.sh config credentials --server http://127.0.0.1:8080 --realm master --user "$KC_ADMIN_USER" --password "$KC_ADMIN_PASSWORD" >/dev/null
    '; then
    return 0
  fi

  warn "Keycloak master admin login failed. Creating a temporary recovery admin to reset $KC_ADMIN_USER."
  local recovery_user="aissistaint-recovery-admin"
  local recovery_password
  recovery_password="$(rand_secret)"

  if ! podman exec \
    -e RECOVERY_PASSWORD="$recovery_password" \
    "$KEYCLOAK_CONTAINER" /opt/keycloak/bin/kc.sh bootstrap-admin user \
      --username "$recovery_user" \
      --password:env RECOVERY_PASSWORD \
      --no-prompt \
      --db postgres \
      --db-url "jdbc:postgresql://$POSTGRES_CONTAINER:5432/keycloak" \
      --db-username keycloak \
      --db-password "$KC_DB_PASSWORD" >/dev/null; then
    echo "Failed to create temporary Keycloak recovery admin." >&2
    show_container_logs "$KEYCLOAK_CONTAINER"
    exit 1
  fi

  podman exec \
    -e RECOVERY_USER="$recovery_user" \
    -e RECOVERY_PASSWORD="$recovery_password" \
    -e KC_ADMIN_USER="$KC_ADMIN_USER" \
    -e KC_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
    "$KEYCLOAK_CONTAINER" bash -lc '
      set -euo pipefail
      export PATH=/opt/keycloak/bin:$PATH
      kcadm.sh config credentials --server http://127.0.0.1:8080 --realm master --user "$RECOVERY_USER" --password "$RECOVERY_PASSWORD" >/dev/null
      kcadm.sh set-password -r master --username "$KC_ADMIN_USER" --new-password "$KC_ADMIN_PASSWORD" --temporary=false >/dev/null
      RECOVERY_ID="$(kcadm.sh get users -r master -q "username=$RECOVERY_USER" | sed -n "s/.*\"id\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n1)"
      if [[ -n "$RECOVERY_ID" ]]; then
        kcadm.sh delete "users/$RECOVERY_ID" -r master >/dev/null
      fi
    '
}

json_extract_value() {
  sed -n 's/.*"value"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
}

rand_secret() {
  od -An -tx1 -N24 /dev/urandom | tr -d ' \n'
}

rand_hex32() {
  od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
}

shell_escape() {
  printf '%q' "$1"
}

effective_litellm_database_url() {
  printf '%s' "${LITELLM_DATABASE_URL:-postgresql://$APP_POSTGRES_USER:$APP_POSTGRES_PASSWORD@$APP_POSTGRES_CONTAINER:5432/$APP_POSTGRES_DB}"
}

load_existing_runtime_env() {
  if [[ -f "$ENV_FILE" ]]; then
    # Preserve generated credentials across container-only restarts. Existing
    # data volumes still expect the passwords that initialized them.
    # Older env files may contain an unquoted prompt with spaces; skip it here
    # and let write_runtime_env rewrite it safely.
    local filtered_env
    filtered_env="$(mktemp)"
    sed '/^GOOSE_CHATBOT_SYSTEM_PROMPT=/d' "$ENV_FILE" > "$filtered_env"
    # shellcheck disable=SC1090
    . "$filtered_env"
    rm -f "$filtered_env"
  fi
}

initialize_generated_secrets() {
  : "${KC_ADMIN_PASSWORD:=$(rand_secret)}"
  : "${KC_DB_PASSWORD:=$(rand_secret)}"
  : "${APP_POSTGRES_PASSWORD:=$(rand_secret)}"
  : "${MINIO_ROOT_PASSWORD:=$(rand_secret)}"
  : "${MINIO_APP_SECRET_KEY:=$(rand_secret)}"
  : "${MINIO_REMOVAL_SECRET_KEY:=$(rand_secret)}"
  : "${LITELLM_MASTER_KEY:=sk-$(rand_secret)}"
  : "${LITELLM_ADMIN_KEY:=$LITELLM_MASTER_KEY}"
  : "${LITELLM_API_KEY:=}"
  if [[ "$LITELLM_API_KEY" == "$LITELLM_MASTER_KEY" || "$LITELLM_API_KEY" == "$LITELLM_ADMIN_KEY" ]]; then
    LITELLM_API_KEY=""
  fi
  : "${LITELLM_ADMIN_BROKER_TOKEN:=sk-$(rand_secret)}"
  : "${LITELLM_SECRET_BROKER_TOKEN:=sk-$(rand_secret)}"
  : "${GOOSE_SECRET_KEY:=sk-$(rand_secret)}"
  if [[ -z "$SECRET_ENCRYPTION_KEY" && -f "$SECRET_ENCRYPTION_KEY_FILE" ]]; then
    SECRET_ENCRYPTION_KEY="$(tr -d '[:space:]' < "$SECRET_ENCRYPTION_KEY_FILE")"
  fi
  : "${SECRET_ENCRYPTION_KEY:=$(rand_hex32)}"
}

write_secret_key_file() {
  mkdir -p "$BASE_SECRET_DIR"
  chmod 700 "$BASE_SECRET_DIR" 2>/dev/null || true
  if [[ ! -f "$SECRET_ENCRYPTION_KEY_FILE" ]]; then
    local old_umask
    old_umask="$(umask)"
    umask 177
    printf '%s\n' "$SECRET_ENCRYPTION_KEY" > "$SECRET_ENCRYPTION_KEY_FILE"
    umask "$old_umask"
  fi
  chmod 600 "$SECRET_ENCRYPTION_KEY_FILE"
}

write_secret_env_file() {
  local path="$1"
  shift
  mkdir -p "$(dirname "$path")"
  chmod 700 "$(dirname "$path")" 2>/dev/null || true
  local old_umask
  old_umask="$(umask)"
  umask 177
  : > "$path"
  for entry in "$@"; do
    printf '%s\n' "$entry" >> "$path"
  done
  umask "$old_umask"
  chmod 600 "$path"
}

validate_litellm_topology() {
  if [[ "$MANAGE_LITELLM" != "1" || "$EXPOSE_RAW_SERVICE_PORTS" == "1" ]]; then
    return 0
  fi

  if [[ "$INTERNAL_LITELLM_URL" =~ ^https?://(127\.0\.0\.1|localhost)(:|/) ]]; then
    echo "MANAGE_LITELLM=1 with EXPOSE_RAW_SERVICE_PORTS=0 requires INTERNAL_LITELLM_URL to point somewhere reachable by the host-run API." >&2
    echo "Either set EXPOSE_RAW_SERVICE_PORTS=1, run the API inside the Podman network, or set INTERNAL_LITELLM_URL to a reachable external LiteLLM endpoint." >&2
    exit 1
  fi
}

validate_goose_topology() {
  if [[ "$MANAGE_GOOSE" != "1" || "$GOOSE_CHATBOT_BACKEND" != "goose" || "$EXPOSE_RAW_SERVICE_PORTS" == "1" ]]; then
    return 0
  fi

  if [[ "$INTERNAL_GOOSE_URL" =~ ^https?://(127\.0\.0\.1|localhost)(:|/) ]]; then
    echo "MANAGE_GOOSE=1 with GOOSE_CHATBOT_BACKEND=goose and EXPOSE_RAW_SERVICE_PORTS=0 requires INTERNAL_GOOSE_URL to point somewhere reachable by the host-run API." >&2
    echo "Either set EXPOSE_RAW_SERVICE_PORTS=1, run the API inside the Podman network, or set INTERNAL_GOOSE_URL to a reachable external Goose endpoint." >&2
    exit 1
  fi
}

show_container_logs() {
  local name="$1"
  echo "----- $name logs -----" >&2
  podman logs "$name" >&2 || true
  echo "----------------------" >&2
}

assert_container_running() {
  local name="$1"
  local state
  state="$(podman inspect -f '{{.State.Status}}' "$name" 2>/dev/null || true)"
  if [[ "$state" != "running" ]]; then
    echo "Container $name is not running (state=$state)" >&2
    show_container_logs "$name"
    exit 1
  fi
}

write_runtime_env() {
  local minio_secret="${1:-${MINIO_CLIENT_SECRET:-}}"
  local openbao_secret="${2:-${OPENBAO_CLIENT_SECRET:-}}"
  local effective_litellm_db_url
  local escaped_goose_chatbot_system_prompt
  effective_litellm_db_url="$(effective_litellm_database_url)"
  escaped_goose_chatbot_system_prompt="$(shell_escape "$GOOSE_CHATBOT_SYSTEM_PROMPT")"

  cat > "$ENV_FILE" <<ENV
STACK_NAME=$STACK_NAME
BASE_DIR=$BASE_DIR
NETWORK_NAME=$NETWORK_NAME
HOST_IP=$HOST_IP
RUNTIME_ENV_FILE=$RUNTIME_ENV_FILE
API_SECRET_ENV_FILE=$API_SECRET_ENV_FILE
API_REMOVAL_ENV_FILE=$API_REMOVAL_ENV_FILE
API_LOAD_REMOVAL_SECRETS=$API_LOAD_REMOVAL_SECRETS
LITELLM_ADMIN_BROKER_ENV_FILE=$LITELLM_ADMIN_BROKER_ENV_FILE
LITELLM_SECRET_BROKER_ENV_FILE=$LITELLM_SECRET_BROKER_ENV_FILE
GOOSE_SECRET_ENV_FILE=$GOOSE_SECRET_ENV_FILE
MANAGE_TLS_GATEWAY=$MANAGE_TLS_GATEWAY
MANAGE_KEYCLOAK_POSTGRES=$MANAGE_KEYCLOAK_POSTGRES
MANAGE_KEYCLOAK=$MANAGE_KEYCLOAK
MANAGE_APP_POSTGRES=$MANAGE_APP_POSTGRES
MANAGE_OPENBAO=$MANAGE_OPENBAO
MANAGE_MINIO=$MANAGE_MINIO
MANAGE_LITELLM=$MANAGE_LITELLM
MANAGE_GOOSE=$MANAGE_GOOSE
TLS_GATEWAY_ENABLED=$TLS_GATEWAY_ENABLED
TLS_GATEWAY_PORT=$TLS_GATEWAY_PORT
TLS_HTTP_PORT=$TLS_HTTP_PORT
EXPOSE_RAW_SERVICE_PORTS=$EXPOSE_RAW_SERVICE_PORTS
API_HOST=$API_HOST
API_PORT=$API_PORT
GATEWAY_BIND_HOST=$GATEWAY_BIND_HOST
APP_PUBLIC_HOST=$APP_PUBLIC_HOST
KEYCLOAK_PUBLIC_HOST=$KEYCLOAK_PUBLIC_HOST
OPENBAO_PUBLIC_HOST=$OPENBAO_PUBLIC_HOST
MINIO_PUBLIC_HOST=$MINIO_PUBLIC_HOST
MINIO_CONSOLE_PUBLIC_HOST=$MINIO_CONSOLE_PUBLIC_HOST
PUBLIC_APP_URL=$PUBLIC_APP_URL
PUBLIC_KEYCLOAK_URL=$PUBLIC_KEYCLOAK_URL
PUBLIC_OPENBAO_URL=$PUBLIC_OPENBAO_URL
PUBLIC_MINIO_URL=$PUBLIC_MINIO_URL
PUBLIC_MINIO_CONSOLE_URL=$PUBLIC_MINIO_CONSOLE_URL
INTERNAL_KEYCLOAK_URL=$INTERNAL_KEYCLOAK_URL
INTERNAL_OPENBAO_URL=$INTERNAL_OPENBAO_URL
INTERNAL_MINIO_ENDPOINT=$INTERNAL_MINIO_ENDPOINT
INTERNAL_LITELLM_URL=$INTERNAL_LITELLM_URL
INTERNAL_GOOSE_URL=$INTERNAL_GOOSE_URL
GATEWAY_KEYCLOAK_UPSTREAM=$GATEWAY_KEYCLOAK_UPSTREAM
GATEWAY_OPENBAO_UPSTREAM=$GATEWAY_OPENBAO_UPSTREAM
GATEWAY_MINIO_UPSTREAM=$GATEWAY_MINIO_UPSTREAM
GATEWAY_MINIO_CONSOLE_UPSTREAM=$GATEWAY_MINIO_CONSOLE_UPSTREAM
KC_REALM=$KC_REALM
KC_GROUP=$KC_GROUP
KC_ADMIN_USER=$KC_ADMIN_USER
KC_ADMIN_PASSWORD=$KC_ADMIN_PASSWORD
KC_DB_PASSWORD=$KC_DB_PASSWORD
KEYCLOAK_CONTAINER=$KEYCLOAK_CONTAINER
CADDY_CONTAINER=$CADDY_CONTAINER
CADDY_CA_ROOT=$CADDY_DATA_DIR/caddy/pki/authorities/local/root.crt
POSTGRES_CONTAINER=$POSTGRES_CONTAINER
APP_POSTGRES_CONTAINER=$APP_POSTGRES_CONTAINER
APP_POSTGRES_DB=$APP_POSTGRES_DB
APP_POSTGRES_USER=$APP_POSTGRES_USER
APP_POSTGRES_PASSWORD=$APP_POSTGRES_PASSWORD
APP_POSTGRES_PORT=$APP_POSTGRES_PORT
APP_DATABASE_URL=${APP_DATABASE_URL:-postgres://$APP_POSTGRES_USER:$APP_POSTGRES_PASSWORD@127.0.0.1:$APP_POSTGRES_PORT/$APP_POSTGRES_DB}
OPENBAO_CONTAINER=$OPENBAO_CONTAINER
OPENBAO_UNSEAL_KEY=${OPENBAO_UNSEAL_KEY:-}
OPENBAO_ROOT_TOKEN=${OPENBAO_ROOT_TOKEN:-}
OPENBAO_APP_TOKEN=${OPENBAO_APP_TOKEN:-}
MINIO_CONTAINER=$MINIO_CONTAINER
MINIO_ROOT_USER=$MINIO_ROOT_USER
MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD
MINIO_APP_ACCESS_KEY=$MINIO_APP_ACCESS_KEY
MINIO_APP_SECRET_KEY=$MINIO_APP_SECRET_KEY
MINIO_REMOVAL_ACCESS_KEY=$MINIO_REMOVAL_ACCESS_KEY
MINIO_REMOVAL_SECRET_KEY=$MINIO_REMOVAL_SECRET_KEY
MINIO_BUCKET=$MINIO_BUCKET
MINIO_POLICY_NAME=$MINIO_POLICY_NAME
MINIO_APP_POLICY_NAME=$MINIO_APP_POLICY_NAME
MINIO_REMOVAL_POLICY_NAME=$MINIO_REMOVAL_POLICY_NAME
MINIO_ENDPOINT=$MINIO_ENDPOINT
LITELLM_CONTAINER=$LITELLM_CONTAINER
LITELLM_PORT=$LITELLM_PORT
LITELLM_MASTER_KEY=$LITELLM_MASTER_KEY
LITELLM_ADMIN_KEY=$LITELLM_ADMIN_KEY
LITELLM_API_KEY=$LITELLM_API_KEY
LITELLM_API_KEY_MODEL_SCOPE_VERSION=$LITELLM_API_KEY_MODEL_SCOPE_VERSION
LITELLM_DATABASE_URL=$effective_litellm_db_url
LITELLM_ADMIN_BROKER_HOST=$LITELLM_ADMIN_BROKER_HOST
LITELLM_ADMIN_BROKER_PORT=$LITELLM_ADMIN_BROKER_PORT
LITELLM_ADMIN_BROKER_URL=$LITELLM_ADMIN_BROKER_URL
LITELLM_ADMIN_BROKER_TOKEN=$LITELLM_ADMIN_BROKER_TOKEN
LITELLM_SECRET_BROKER_TOKEN=$LITELLM_SECRET_BROKER_TOKEN
GOOSE_CONTAINER=$GOOSE_CONTAINER
GOOSE_IMAGE=$GOOSE_IMAGE
GOOSE_PORT=$GOOSE_PORT
GOOSE_PROVIDER=$GOOSE_PROVIDER
GOOSE_MODEL=$GOOSE_MODEL
GOOSE_WORKING_DIR=$GOOSE_WORKING_DIR
GOOSE_CHATBOT_BACKEND=$GOOSE_CHATBOT_BACKEND
GOOSE_CHATBOT_DEFAULT_TIER=$GOOSE_CHATBOT_DEFAULT_TIER
GOOSE_CHATBOT_MAX_MESSAGES=$GOOSE_CHATBOT_MAX_MESSAGES
GOOSE_CHATBOT_MAX_TOKENS=$GOOSE_CHATBOT_MAX_TOKENS
GOOSE_CHATBOT_TEMPERATURE=$GOOSE_CHATBOT_TEMPERATURE
GOOSE_CHATBOT_SYSTEM_PROMPT=$escaped_goose_chatbot_system_prompt
PROJECT_BUCKET_PREFIX=$PROJECT_BUCKET_PREFIX
PROJECT_LOADED_PREFIX=$PROJECT_LOADED_PREFIX
PROJECT_PARSED_PREFIX=$PROJECT_PARSED_PREFIX
PROJECT_METADATA_OBJECT_KEY=$PROJECT_METADATA_OBJECT_KEY
MINIO_CLIENT_ID=$MINIO_CLIENT_ID
MINIO_CLIENT_SECRET=$minio_secret
OPENBAO_CLIENT_ID=$OPENBAO_CLIENT_ID
OPENBAO_CLIENT_SECRET=$openbao_secret
AISSISTAINT_UI_CLIENT_ID=$AISSISTAINT_UI_CLIENT_ID
AISSISTAINT_UI_DEV_PORT=$AISSISTAINT_UI_DEV_PORT
VITE_USE_MOCK_SERVICES=false
VITE_KEYCLOAK_URL=$PUBLIC_KEYCLOAK_URL
VITE_KEYCLOAK_REALM=$KC_REALM
VITE_KEYCLOAK_CLIENT_ID=$AISSISTAINT_UI_CLIENT_ID
VITE_API_BASE_URL=
VITE_OPENBAO_URL=$PUBLIC_OPENBAO_URL
VITE_LLM_TIERS=$VITE_LLM_TIERS
CORS_ALLOWED_ORIGINS=$CORS_ALLOWED_ORIGINS
LLM_ALLOWED_HOSTS=$LLM_ALLOWED_HOSTS
LLM_ALLOW_PRIVATE_ENDPOINTS=$LLM_ALLOW_PRIVATE_ENDPOINTS
LLM_ALLOW_HTTP_ENDPOINTS=$LLM_ALLOW_HTTP_ENDPOINTS
LLM_ALLOW_ANY_HOSTS=$LLM_ALLOW_ANY_HOSTS
LLM_DEV_MODE=$LLM_DEV_MODE
LLM_REQUEST_TIMEOUT_MS=$LLM_REQUEST_TIMEOUT_MS
SECRET_STORE_PROVIDER=$SECRET_STORE_PROVIDER
SECRET_ENCRYPTION_KEY_FILE=$SECRET_ENCRYPTION_KEY_FILE
SECRET_ENCRYPTION_KEY_VERSION=$SECRET_ENCRYPTION_KEY_VERSION
OPENBAO_KV_MOUNT=$OPENBAO_KV_MOUNT
OPENBAO_RW_PREFIX=$OPENBAO_RW_PREFIX
ENV
  chmod 600 "$ENV_FILE"

  cat > "$RUNTIME_ENV_FILE" <<ENV
STACK_NAME=$STACK_NAME
BASE_DIR=$BASE_DIR
NETWORK_NAME=$NETWORK_NAME
HOST_IP=$HOST_IP
API_HOST=$API_HOST
API_PORT=$API_PORT
API_SECRET_ENV_FILE=$API_SECRET_ENV_FILE
API_REMOVAL_ENV_FILE=$API_REMOVAL_ENV_FILE
API_LOAD_REMOVAL_SECRETS=$API_LOAD_REMOVAL_SECRETS
LITELLM_ADMIN_BROKER_ENV_FILE=$LITELLM_ADMIN_BROKER_ENV_FILE
LITELLM_SECRET_BROKER_ENV_FILE=$LITELLM_SECRET_BROKER_ENV_FILE
GOOSE_SECRET_ENV_FILE=$GOOSE_SECRET_ENV_FILE
PUBLIC_APP_URL=$PUBLIC_APP_URL
PUBLIC_KEYCLOAK_URL=$PUBLIC_KEYCLOAK_URL
PUBLIC_OPENBAO_URL=$PUBLIC_OPENBAO_URL
PUBLIC_MINIO_URL=$PUBLIC_MINIO_URL
PUBLIC_MINIO_CONSOLE_URL=$PUBLIC_MINIO_CONSOLE_URL
INTERNAL_KEYCLOAK_URL=$INTERNAL_KEYCLOAK_URL
INTERNAL_OPENBAO_URL=$INTERNAL_OPENBAO_URL
INTERNAL_MINIO_ENDPOINT=$INTERNAL_MINIO_ENDPOINT
INTERNAL_LITELLM_URL=$INTERNAL_LITELLM_URL
INTERNAL_GOOSE_URL=$INTERNAL_GOOSE_URL
MINIO_ENDPOINT=$MINIO_ENDPOINT
MINIO_REMOVAL_POLICY_NAME=$MINIO_REMOVAL_POLICY_NAME
LITELLM_ADMIN_BROKER_URL=$LITELLM_ADMIN_BROKER_URL
PROJECT_BUCKET_PREFIX=$PROJECT_BUCKET_PREFIX
PROJECT_LOADED_PREFIX=$PROJECT_LOADED_PREFIX
PROJECT_PARSED_PREFIX=$PROJECT_PARSED_PREFIX
PROJECT_METADATA_OBJECT_KEY=$PROJECT_METADATA_OBJECT_KEY
AISSISTAINT_UI_CLIENT_ID=$AISSISTAINT_UI_CLIENT_ID
VITE_USE_MOCK_SERVICES=false
VITE_KEYCLOAK_URL=$PUBLIC_KEYCLOAK_URL
VITE_KEYCLOAK_REALM=$KC_REALM
VITE_KEYCLOAK_CLIENT_ID=$AISSISTAINT_UI_CLIENT_ID
VITE_API_BASE_URL=
VITE_OPENBAO_URL=$PUBLIC_OPENBAO_URL
VITE_LLM_TIERS=$VITE_LLM_TIERS
CORS_ALLOWED_ORIGINS=$CORS_ALLOWED_ORIGINS
LLM_ALLOWED_HOSTS=$LLM_ALLOWED_HOSTS
LLM_ALLOW_PRIVATE_ENDPOINTS=$LLM_ALLOW_PRIVATE_ENDPOINTS
LLM_ALLOW_HTTP_ENDPOINTS=$LLM_ALLOW_HTTP_ENDPOINTS
LLM_ALLOW_ANY_HOSTS=$LLM_ALLOW_ANY_HOSTS
LLM_DEV_MODE=$LLM_DEV_MODE
LLM_REQUEST_TIMEOUT_MS=$LLM_REQUEST_TIMEOUT_MS
GOOSE_CHATBOT_BACKEND=$GOOSE_CHATBOT_BACKEND
GOOSE_CHATBOT_DEFAULT_TIER=$GOOSE_CHATBOT_DEFAULT_TIER
GOOSE_CHATBOT_MAX_MESSAGES=$GOOSE_CHATBOT_MAX_MESSAGES
GOOSE_CHATBOT_MAX_TOKENS=$GOOSE_CHATBOT_MAX_TOKENS
GOOSE_CHATBOT_TEMPERATURE=$GOOSE_CHATBOT_TEMPERATURE
GOOSE_CHATBOT_SYSTEM_PROMPT=$escaped_goose_chatbot_system_prompt
SECRET_STORE_PROVIDER=$SECRET_STORE_PROVIDER
SECRET_ENCRYPTION_KEY_FILE=$SECRET_ENCRYPTION_KEY_FILE
SECRET_ENCRYPTION_KEY_VERSION=$SECRET_ENCRYPTION_KEY_VERSION
OPENBAO_KV_MOUNT=$OPENBAO_KV_MOUNT
OPENBAO_RW_PREFIX=$OPENBAO_RW_PREFIX
ENV
  chmod 600 "$RUNTIME_ENV_FILE"

  write_secret_env_file "$API_SECRET_ENV_FILE" \
    "APP_DATABASE_URL=${APP_DATABASE_URL:-postgres://$APP_POSTGRES_USER:$APP_POSTGRES_PASSWORD@127.0.0.1:$APP_POSTGRES_PORT/$APP_POSTGRES_DB}" \
    "MINIO_APP_ACCESS_KEY=$MINIO_APP_ACCESS_KEY" \
    "MINIO_APP_SECRET_KEY=$MINIO_APP_SECRET_KEY" \
    "LITELLM_API_KEY=$LITELLM_API_KEY" \
    "LITELLM_API_KEY_MODEL_SCOPE_VERSION=$LITELLM_API_KEY_MODEL_SCOPE_VERSION" \
    "LITELLM_ADMIN_BROKER_TOKEN=$LITELLM_ADMIN_BROKER_TOKEN" \
    "OPENBAO_APP_TOKEN=${OPENBAO_APP_TOKEN:-}" \
    "GOOSE_SECRET_KEY=$GOOSE_SECRET_KEY" \
    "SECRET_ENCRYPTION_KEY_FILE=$SECRET_ENCRYPTION_KEY_FILE"

  write_secret_env_file "$API_REMOVAL_ENV_FILE" \
    "MINIO_REMOVAL_ACCESS_KEY=$MINIO_REMOVAL_ACCESS_KEY" \
    "MINIO_REMOVAL_SECRET_KEY=$MINIO_REMOVAL_SECRET_KEY"

  write_secret_env_file "$LITELLM_ADMIN_BROKER_ENV_FILE" \
    "LITELLM_ADMIN_KEY=$LITELLM_ADMIN_KEY" \
    "LITELLM_ADMIN_BROKER_TOKEN=$LITELLM_ADMIN_BROKER_TOKEN" \
    "LITELLM_ADMIN_BROKER_HOST=$LITELLM_ADMIN_BROKER_HOST" \
    "LITELLM_ADMIN_BROKER_PORT=$LITELLM_ADMIN_BROKER_PORT" \
    "INTERNAL_LITELLM_URL=$INTERNAL_LITELLM_URL" \
    "LITELLM_SECRET_BROKER_URL=http://127.0.0.1:$API_PORT" \
    "LITELLM_SECRET_BROKER_TOKEN=$LITELLM_SECRET_BROKER_TOKEN" \
    "LLM_ALLOWED_HOSTS=$LLM_ALLOWED_HOSTS" \
    "LLM_ALLOW_PRIVATE_ENDPOINTS=$LLM_ALLOW_PRIVATE_ENDPOINTS" \
    "LLM_ALLOW_HTTP_ENDPOINTS=$LLM_ALLOW_HTTP_ENDPOINTS" \
    "LLM_ALLOW_ANY_HOSTS=$LLM_ALLOW_ANY_HOSTS" \
    "LLM_DEV_MODE=$LLM_DEV_MODE"

  write_secret_env_file "$LITELLM_SECRET_BROKER_ENV_FILE" \
    "LITELLM_SECRET_BROKER_TOKEN=$LITELLM_SECRET_BROKER_TOKEN" \
    "DATABASE_URL=$effective_litellm_db_url" \
    "STORE_MODEL_IN_DB=True"

  write_secret_env_file "$GOOSE_SECRET_ENV_FILE" \
    "GOOSE_SECRET_KEY=$GOOSE_SECRET_KEY" \
    "OPENAI_API_KEY=$LITELLM_API_KEY"
}

write_openbao_config() {
  cat > "$OPENBAO_CONFIG_FILE" <<CFG
ui = true

disable_mlock = true
api_addr = "$PUBLIC_OPENBAO_URL"
cluster_addr = "http://127.0.0.1:8201"

storage "raft" {
  path    = "/openbao/data"
  node_id = "${STACK_NAME}-openbao-1"
}

listener "tcp" {
  address         = "0.0.0.0:8200"
  cluster_address = "0.0.0.0:8201"
  tls_disable     = true
}
CFG
}

write_caddyfile() {
  cat > "$CADDYFILE" <<CADDY
{
  local_certs
  auto_https disable_redirects
}

$PUBLIC_APP_URL {
  tls internal

  handle /api* {
    reverse_proxy host.containers.internal:8787
  }

  handle {
    reverse_proxy host.containers.internal:$AISSISTAINT_UI_DEV_PORT
  }
}

$PUBLIC_KEYCLOAK_URL {
  tls internal
  reverse_proxy $GATEWAY_KEYCLOAK_UPSTREAM
}

$PUBLIC_OPENBAO_URL {
  tls internal
  reverse_proxy $GATEWAY_OPENBAO_UPSTREAM
}

$PUBLIC_MINIO_URL {
  tls internal
  reverse_proxy $GATEWAY_MINIO_UPSTREAM
}

$PUBLIC_MINIO_CONSOLE_URL {
  tls internal
  reverse_proxy $GATEWAY_MINIO_CONSOLE_UPSTREAM
}
CADDY
}

write_litellm_config() {
  cat > "$LITELLM_CONFIG_FILE" <<YAML
model_list: []

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  store_model_in_db: true
  key_management_system: custom
  key_management_settings:
    custom_secret_manager: openbao_secret_manager.OpenBaoSecretManager
    access_mode: read_only

litellm_settings:
  drop_params: true
YAML

  cat > "$LITELLM_SECRET_MANAGER_FILE" <<'PY'
import json
import os
import urllib.error
import urllib.parse
import urllib.request

try:
    from litellm.integrations.custom_secret_manager import CustomSecretManager
except Exception:
    try:
        from litellm.types.secret_managers.main import CustomSecretManager
    except Exception:
        from litellm.secret_managers.main import CustomSecretManager


class OpenBaoSecretManager(CustomSecretManager):
    def __init__(self):
        try:
            super().__init__(secret_manager_name="openbao_secret_manager")
        except TypeError:
            super().__init__()

    def _read_openbao_secret(self, secret_name):
        if not secret_name:
            return None

        if secret_name.startswith("os.environ/"):
            env_name = secret_name.split("/", 1)[1]
            env_value = os.environ.get(env_name)
            if env_value:
                return env_value
            secret_name = env_name

        if secret_name.startswith("aissistaint://"):
            alias = secret_name.removeprefix("aissistaint://")
            broker_url = os.environ.get("LITELLM_SECRET_BROKER_URL", "").rstrip("/")
            broker_token = os.environ.get("LITELLM_SECRET_BROKER_TOKEN")
            if not broker_url or not broker_token or not alias:
                return None

            request = urllib.request.Request(
                f"{broker_url}/internal/litellm/secrets/{urllib.parse.quote(alias, safe='')}",
                headers={"Authorization": f"Bearer {broker_token}"},
            )
            try:
                with urllib.request.urlopen(request, timeout=5) as response:
                    payload = json.loads(response.read().decode("utf-8"))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
                return None
            value = payload.get("value")
            return value if isinstance(value, str) and value else None

        if not secret_name.startswith("openbao://"):
            return os.environ.get(secret_name)

        reference = secret_name.removeprefix("openbao://")
        secret_path, _, field = reference.partition("#")
        field = field or "token"

        openbao_url = os.environ.get("LITELLM_OPENBAO_URL", "http://127.0.0.1:8200").rstrip("/")
        openbao_token = os.environ.get("LITELLM_OPENBAO_TOKEN")
        if not openbao_token:
            return None

        request = urllib.request.Request(
            f"{openbao_url}/v1/{secret_path.lstrip('/')}",
            headers={"X-Vault-Token": openbao_token},
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return None

        data = payload.get("data", {})
        if isinstance(data.get("data"), dict):
            data = data["data"]
        value = data.get(field)
        return value if isinstance(value, str) and value else None

    def sync_read_secret(self, secret_name, optional_params=None, timeout=None):
        return self._read_openbao_secret(secret_name)

    async def async_read_secret(self, secret_name, optional_params=None, timeout=None):
        return self._read_openbao_secret(secret_name)
PY
}

write_minio_policy() {
  cat > "$MINIO_POLICY_FILE" <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetBucketLocation",
        "s3:ListAllMyBuckets",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::*",
        "arn:aws:s3:::${MINIO_BUCKET}",
        "arn:aws:s3:::${PROJECT_BUCKET_PREFIX}-*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::${MINIO_BUCKET}/*",
        "arn:aws:s3:::${PROJECT_BUCKET_PREFIX}-*/*"
      ]
    }
  ]
}
POLICY
}

write_minio_app_policy() {
  cat > "$MINIO_APP_POLICY_FILE" <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:GetBucketLocation",
        "s3:ListAllMyBuckets",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::${PROJECT_BUCKET_PREFIX}-*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::${PROJECT_BUCKET_PREFIX}-*/*"
      ]
    }
  ]
}
POLICY
}

write_minio_removal_policy() {
  cat > "$MINIO_REMOVAL_POLICY_FILE" <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetBucketLocation",
        "s3:ListAllMyBuckets",
        "s3:ListBucket",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:PutBucketPolicy"
      ],
      "Resource": [
        "arn:aws:s3:::${PROJECT_BUCKET_PREFIX}-*",
        "arn:aws:s3:::${PROJECT_BUCKET_PREFIX}-*/*"
      ]
    }
  ]
}
POLICY
}

prepare_dirs() {
  mkdir -p "$POSTGRES_DATA_DIR" "$APP_POSTGRES_DATA_DIR" "$OPENBAO_DATA_DIR" "$OPENBAO_CONFIG_DIR" "$MINIO_DATA_DIR" "$MINIO_MC_DIR" "$LITELLM_CONFIG_DIR" "$GOOSE_CONFIG_DIR" "$GOOSE_WORKSPACE_DIR"
  mkdir -p "$BASE_OPENBAO_DIR" "$BASE_MINIO_DIR" "$BASE_LITELLM_DIR" "$BASE_GOOSE_DIR" "$BASE_KEYCLOAK_DIR" "$BASE_APP_POSTGRES_DIR" "$BASE_CADDY_DIR" "$CADDY_CONFIG_DIR" "$CADDY_DATA_DIR" "$BASE_SECRET_DIR"
  chmod 700 "$BASE_DIR" "$BASE_OPENBAO_DIR" "$BASE_SECRET_DIR" 2>/dev/null || true

  if [[ "$CLEAN_DATA" == "1" ]]; then
    warn "CLEAN_DATA=1 set. Removing data under $BASE_DIR"
    rm -rf "$POSTGRES_DATA_DIR" "$APP_POSTGRES_DATA_DIR" "$OPENBAO_DATA_DIR" "$OPENBAO_CONFIG_DIR" "$MINIO_DATA_DIR" "$MINIO_MC_DIR" "$LITELLM_CONFIG_DIR" "$GOOSE_CONFIG_DIR" "$GOOSE_WORKSPACE_DIR" "$CADDY_CONFIG_DIR" "$CADDY_DATA_DIR" "$BASE_SECRET_DIR" "$OPENBAO_INIT_FILE" "$ENV_FILE" "$RUNTIME_ENV_FILE" "$KEYCLOAK_SECRETS_OUT" "$MINIO_POLICY_FILE" "$MINIO_APP_POLICY_FILE" "$MINIO_REMOVAL_POLICY_FILE"
    mkdir -p "$POSTGRES_DATA_DIR" "$APP_POSTGRES_DATA_DIR" "$OPENBAO_DATA_DIR" "$OPENBAO_CONFIG_DIR" "$MINIO_DATA_DIR" "$MINIO_MC_DIR" "$LITELLM_CONFIG_DIR" "$GOOSE_CONFIG_DIR" "$GOOSE_WORKSPACE_DIR" "$CADDY_CONFIG_DIR" "$CADDY_DATA_DIR" "$BASE_SECRET_DIR"
    chmod 700 "$BASE_SECRET_DIR" 2>/dev/null || true
  fi

  write_secret_key_file
  write_openbao_config
  write_caddyfile
  write_litellm_config
  write_minio_policy
  write_minio_app_policy
  write_minio_removal_policy

  # OpenBao stores raft data as its non-root image user. Repair ownership and
  # modes inside the rootless Podman namespace so container-only restarts keep
  # working against existing vault.db files.
  podman unshare chown -R 100:100 "$OPENBAO_DATA_DIR" >/dev/null 2>&1 || true
  podman unshare chmod -R u+rwX,go-rwx "$OPENBAO_DATA_DIR" >/dev/null 2>&1 || true
}

pull_images() {
  info "Pulling container images"
  [[ "$MANAGE_TLS_GATEWAY" == "1" ]] && podman pull "$CADDY_IMAGE" >/dev/null
  if [[ "$MANAGE_KEYCLOAK_POSTGRES" == "1" || "$MANAGE_APP_POSTGRES" == "1" ]]; then
    podman pull "$POSTGRES_IMAGE" >/dev/null
  fi
  [[ "$MANAGE_KEYCLOAK" == "1" ]] && podman pull "$KEYCLOAK_IMAGE" >/dev/null
  [[ "$MANAGE_OPENBAO" == "1" ]] && podman pull "$OPENBAO_IMAGE" >/dev/null
  [[ "$MANAGE_MINIO" == "1" ]] && podman pull "$MINIO_IMAGE" >/dev/null
  [[ "$MANAGE_LITELLM" == "1" ]] && podman pull "$LITELLM_IMAGE" >/dev/null
  [[ "$MANAGE_GOOSE" == "1" ]] && podman pull "$GOOSE_IMAGE" >/dev/null
  podman pull "$MINIO_MC_IMAGE" >/dev/null
}

start_infra() {
  info "Preparing directories under $BASE_DIR"
  prepare_dirs

  if ! network_exists "$NETWORK_NAME"; then
    info "Creating Podman network $NETWORK_NAME"
    podman network create "$NETWORK_NAME" >/dev/null
  fi

  pull_images

  for c in "$CADDY_CONTAINER" "$GOOSE_CONTAINER" "$LITELLM_CONTAINER" "$MINIO_CONTAINER" "$OPENBAO_CONTAINER" "$KEYCLOAK_CONTAINER" "$APP_POSTGRES_CONTAINER" "$POSTGRES_CONTAINER"; do
    local manage_container=1
    case "$c" in
      "$CADDY_CONTAINER") manage_container="$MANAGE_TLS_GATEWAY" ;;
      "$GOOSE_CONTAINER") manage_container="$MANAGE_GOOSE" ;;
      "$LITELLM_CONTAINER") manage_container="$MANAGE_LITELLM" ;;
      "$MINIO_CONTAINER") manage_container="$MANAGE_MINIO" ;;
      "$OPENBAO_CONTAINER") manage_container="$MANAGE_OPENBAO" ;;
      "$KEYCLOAK_CONTAINER") manage_container="$MANAGE_KEYCLOAK" ;;
      "$APP_POSTGRES_CONTAINER") manage_container="$MANAGE_APP_POSTGRES" ;;
      "$POSTGRES_CONTAINER") manage_container="$MANAGE_KEYCLOAK_POSTGRES" ;;
    esac
    if [[ "$manage_container" == "1" ]] && container_exists "$c"; then
      info "Removing existing container $c"
      podman rm -f "$c" >/dev/null || true
    fi
  done

  local app_postgres_ports=()
  local keycloak_ports=()
  local openbao_ports=()
  local minio_ports=()
  local litellm_ports=()
  if [[ "$EXPOSE_RAW_SERVICE_PORTS" == "1" ]]; then
    app_postgres_ports=(-p "127.0.0.1:${APP_POSTGRES_PORT}:5432")
    keycloak_ports=(-p 127.0.0.1:8080:8080)
    openbao_ports=(-p 127.0.0.1:8200:8200 -p 127.0.0.1:8201:8201)
    minio_ports=(-p 127.0.0.1:9000:9000 -p 127.0.0.1:9001:9001)
    litellm_ports=(-p "127.0.0.1:${LITELLM_PORT}:4000")
  fi

  if [[ "$MANAGE_KEYCLOAK_POSTGRES" == "1" ]]; then
    info "Starting PostgreSQL"
    podman run -d \
      --name "$POSTGRES_CONTAINER" \
      --network "$NETWORK_NAME" \
      -e POSTGRES_DB=keycloak \
      -e POSTGRES_USER=keycloak \
      -e POSTGRES_PASSWORD="$KC_DB_PASSWORD" \
      -v "$POSTGRES_DATA_DIR:/var/lib/postgresql/data:Z" \
      "$POSTGRES_IMAGE" >/dev/null
  fi

  if [[ "$MANAGE_APP_POSTGRES" == "1" ]]; then
    info "Starting app PostgreSQL"
    podman run -d \
      --name "$APP_POSTGRES_CONTAINER" \
      --network "$NETWORK_NAME" \
      "${app_postgres_ports[@]}" \
      -e POSTGRES_DB="$APP_POSTGRES_DB" \
      -e POSTGRES_USER="$APP_POSTGRES_USER" \
      -e POSTGRES_PASSWORD="$APP_POSTGRES_PASSWORD" \
      -v "$APP_POSTGRES_DATA_DIR:/var/lib/postgresql/data:Z" \
      "$POSTGRES_IMAGE" >/dev/null
  fi

  if [[ "$MANAGE_KEYCLOAK_POSTGRES" == "1" ]]; then
    info "Synchronizing Keycloak PostgreSQL password"
    sync_postgres_user_password "$POSTGRES_CONTAINER" keycloak keycloak "$KC_DB_PASSWORD"
  fi

  if [[ "$MANAGE_APP_POSTGRES" == "1" ]]; then
    info "Synchronizing app PostgreSQL password"
    sync_postgres_user_password "$APP_POSTGRES_CONTAINER" "$APP_POSTGRES_USER" "$APP_POSTGRES_DB" "$APP_POSTGRES_PASSWORD"
  fi

  if [[ "$MANAGE_KEYCLOAK" == "1" ]]; then
    info "Starting Keycloak"
    podman run -d \
      --name "$KEYCLOAK_CONTAINER" \
      --network "$NETWORK_NAME" \
      "${keycloak_ports[@]}" \
      -e KC_BOOTSTRAP_ADMIN_USERNAME="$KC_ADMIN_USER" \
      -e KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
      -e KC_DB=postgres \
      -e KC_DB_URL="jdbc:postgresql://$POSTGRES_CONTAINER:5432/keycloak" \
      -e KC_DB_USERNAME=keycloak \
      -e KC_DB_PASSWORD="$KC_DB_PASSWORD" \
      -e KC_HTTP_ENABLED=true \
      -e KC_PROXY_HEADERS=xforwarded \
      -e KC_HOSTNAME="$PUBLIC_KEYCLOAK_URL" \
      -e KC_HOSTNAME_STRICT=false \
      "$KEYCLOAK_IMAGE" \
      start-dev >/dev/null
  fi

  if [[ "$MANAGE_OPENBAO" == "1" ]]; then
    info "Starting OpenBao (non-dev, single-node raft)"
    podman run -d \
      --name "$OPENBAO_CONTAINER" \
      --network "$NETWORK_NAME" \
      "${openbao_ports[@]}" \
      -v "$OPENBAO_CONFIG_FILE:/etc/openbao/openbao.hcl:Z,ro" \
      -v "$OPENBAO_DATA_DIR:/openbao/data:Z" \
      -v "$CADDY_DATA_DIR:/caddy-data:z,ro" \
      -e SSL_CERT_FILE=/caddy-data/caddy/pki/authorities/local/root.crt \
      "$OPENBAO_IMAGE" \
      server -config=/etc/openbao/openbao.hcl >/dev/null
  fi

  if [[ "$MANAGE_MINIO" == "1" ]]; then
    info "Starting MinIO"
    podman run -d \
      --name "$MINIO_CONTAINER" \
      --network "$NETWORK_NAME" \
      "${minio_ports[@]}" \
      -v "$MINIO_DATA_DIR:/data:Z" \
      -v "$CADDY_DATA_DIR:/caddy-data:z,ro" \
      -e MINIO_ROOT_USER="$MINIO_ROOT_USER" \
      -e MINIO_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD" \
      -e MINIO_SERVER_URL="$PUBLIC_MINIO_URL" \
      -e MINIO_BROWSER_REDIRECT_URL="$PUBLIC_MINIO_CONSOLE_URL" \
      -e SSL_CERT_FILE=/caddy-data/caddy/pki/authorities/local/root.crt \
      "$MINIO_IMAGE" \
      server /data --console-address ':9001' >/dev/null
  fi

  if [[ "$TLS_GATEWAY_ENABLED" == "1" && "$MANAGE_TLS_GATEWAY" == "1" ]]; then
    info "Starting TLS gateway"
    podman run -d \
      --name "$CADDY_CONTAINER" \
      --network "$NETWORK_NAME" \
      --network-alias "$APP_PUBLIC_HOST" \
      --network-alias "$KEYCLOAK_PUBLIC_HOST" \
      --network-alias "$OPENBAO_PUBLIC_HOST" \
      --network-alias "$MINIO_PUBLIC_HOST" \
      --network-alias "$MINIO_CONSOLE_PUBLIC_HOST" \
      -p "${GATEWAY_BIND_HOST}:${TLS_HTTP_PORT}:8080" \
      -p "${GATEWAY_BIND_HOST}:${TLS_GATEWAY_PORT}:8443" \
      -v "$CADDYFILE:/etc/caddy/Caddyfile:Z,ro" \
      -v "$CADDY_DATA_DIR:/data:z" \
      -v "$CADDY_CONFIG_DIR:/config:Z" \
      "$CADDY_IMAGE" >/dev/null
  fi

  [[ "$MANAGE_KEYCLOAK_POSTGRES" == "1" ]] && assert_container_running "$POSTGRES_CONTAINER"
  [[ "$MANAGE_APP_POSTGRES" == "1" ]] && assert_container_running "$APP_POSTGRES_CONTAINER"
  [[ "$MANAGE_KEYCLOAK" == "1" ]] && assert_container_running "$KEYCLOAK_CONTAINER"
  [[ "$MANAGE_OPENBAO" == "1" ]] && assert_container_running "$OPENBAO_CONTAINER"
  [[ "$MANAGE_MINIO" == "1" ]] && assert_container_running "$MINIO_CONTAINER"
  if [[ "$TLS_GATEWAY_ENABLED" == "1" && "$MANAGE_TLS_GATEWAY" == "1" ]]; then
    assert_container_running "$CADDY_CONTAINER"
  fi
}

start_litellm() {
  if [[ "$MANAGE_LITELLM" != "1" ]]; then
    info "Skipping managed LiteLLM setup (MANAGE_LITELLM=$MANAGE_LITELLM)"
    return 0
  fi

  local litellm_ports=()
  if [[ "$EXPOSE_RAW_SERVICE_PORTS" == "1" ]]; then
    litellm_ports=(-p "127.0.0.1:${LITELLM_PORT}:4000")
  fi

  if container_exists "$LITELLM_CONTAINER"; then
    info "Removing existing container $LITELLM_CONTAINER"
    podman rm -f "$LITELLM_CONTAINER" >/dev/null || true
  fi

  info "Starting LiteLLM"
  podman run -d \
    --name "$LITELLM_CONTAINER" \
    --network "$NETWORK_NAME" \
    "${litellm_ports[@]}" \
    -v "$LITELLM_CONFIG_FILE:/app/config.yaml:Z,ro" \
    -v "$LITELLM_SECRET_MANAGER_FILE:/app/openbao_secret_manager.py:Z,ro" \
    --env-file "$LITELLM_SECRET_BROKER_ENV_FILE" \
    -e LITELLM_MASTER_KEY="$LITELLM_MASTER_KEY" \
    -e LITELLM_SECRET_BROKER_URL="http://host.containers.internal:${API_PORT}" \
    "$LITELLM_IMAGE" \
    --config /app/config.yaml --host 0.0.0.0 --port 4000 >/dev/null

  assert_container_running "$LITELLM_CONTAINER"

  if [[ -z "$LITELLM_API_KEY" || "$LITELLM_API_KEY_MODEL_SCOPE_VERSION" != "all-models-v1" ]]; then
    info "Generating LiteLLM runtime chat key"
    wait_for_http_200 "$INTERNAL_LITELLM_URL/health/liveliness" "LiteLLM" 60 2 || {
      show_container_logs "$LITELLM_CONTAINER"
      exit 1
    }
    local key_response generated_key runtime_key_alias
    runtime_key_alias="aissistaint-runtime-chat-$(date +%s)"
    key_response="$(curl -fsS -X POST "$INTERNAL_LITELLM_URL/key/generate" \
      -H "Authorization: Bearer $LITELLM_ADMIN_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"duration\":\"365d\",\"key_alias\":\"$runtime_key_alias\"}")"
    generated_key="$(printf '%s' "$key_response" | jq -r '.key // .token // empty')"
    if [[ -z "$generated_key" ]]; then
      echo "LiteLLM runtime key generation did not return a key." >&2
      exit 1
    fi
    # Refresh full bootstrap context before rewriting the split runtime files.
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    LITELLM_API_KEY="$generated_key"
    LITELLM_API_KEY_MODEL_SCOPE_VERSION="all-models-v1"
    write_runtime_env
  fi
}

start_goose() {
  if [[ "$MANAGE_GOOSE" != "1" ]]; then
    info "Skipping managed Goose setup (MANAGE_GOOSE=$MANAGE_GOOSE)"
    return 0
  fi

  local goose_ports=()
  if [[ "$EXPOSE_RAW_SERVICE_PORTS" == "1" ]]; then
    goose_ports=(-p "127.0.0.1:${GOOSE_PORT}:3284")
  fi

  if container_exists "$GOOSE_CONTAINER"; then
    info "Removing existing container $GOOSE_CONTAINER"
    podman rm -f "$GOOSE_CONTAINER" >/dev/null || true
  fi

  info "Starting Goose headless server"
  podman run -d \
    --name "$GOOSE_CONTAINER" \
    --network "$NETWORK_NAME" \
    "${goose_ports[@]}" \
    -v "$GOOSE_CONFIG_DIR:/home/goose/.config/goose:Z" \
    -v "$GOOSE_WORKSPACE_DIR:$GOOSE_WORKING_DIR:Z" \
    --env-file "$GOOSE_SECRET_ENV_FILE" \
    -e GOOSE_PROVIDER="$GOOSE_PROVIDER" \
    -e GOOSE_MODEL="$GOOSE_MODEL" \
    -e GOOSE_DISABLE_KEYRING=1 \
    -e OPENAI_HOST="http://${LITELLM_CONTAINER}:4000" \
    -e OPENAI_BASE_URL="http://${LITELLM_CONTAINER}:4000" \
    -e GOOSE_SECRET_KEY="$GOOSE_SECRET_KEY" \
    "$GOOSE_IMAGE" \
    serve --host 0.0.0.0 --port 3284 >/dev/null

  assert_container_running "$GOOSE_CONTAINER"
}

configure_keycloak() {
  if [[ "$MANAGE_KEYCLOAK" != "1" ]]; then
    info "Skipping managed Keycloak setup (MANAGE_KEYCLOAK=$MANAGE_KEYCLOAK)"
    if [[ -z "${MINIO_CLIENT_SECRET:-}" || -z "${OPENBAO_CLIENT_SECRET:-}" ]]; then
      warn "External Keycloak selected. Set MINIO_CLIENT_SECRET and OPENBAO_CLIENT_SECRET if MinIO/OpenBao OIDC will be configured."
    fi
    write_runtime_env
    return 0
  fi

  info "Waiting for Keycloak"
  if ! wait_for_http_200 "$INTERNAL_KEYCLOAK_URL/realms/master/.well-known/openid-configuration" "Keycloak"; then
    show_container_logs "$KEYCLOAK_CONTAINER"
    exit 1
  fi
  ensure_keycloak_admin_login

  info "Configuring Keycloak realm, group, clients, and mapper"
  podman exec "$KEYCLOAK_CONTAINER" bash -lc "
set -euo pipefail
export PATH=/opt/keycloak/bin:\$PATH

kcadm.sh config credentials --server http://127.0.0.1:8080 --realm master --user '$KC_ADMIN_USER' --password '$KC_ADMIN_PASSWORD' >/dev/null

if ! kcadm.sh get realms/'$KC_REALM' >/dev/null 2>&1; then
  kcadm.sh create realms -s realm='$KC_REALM' -s enabled=true >/dev/null
fi

kcadm.sh update realms/'$KC_REALM' \
  -s displayName='Platform Realm' \
  -s resetPasswordAllowed=true \
  -s registrationAllowed=false \
  -s rememberMe=true \
  -s loginWithEmailAllowed=true >/dev/null

if ! kcadm.sh get groups -r '$KC_REALM' | grep -q '\"name\"[[:space:]]*:[[:space:]]*\"$KC_GROUP\"'; then
  kcadm.sh create groups -r '$KC_REALM' -s name='$KC_GROUP' >/dev/null
fi

for role in aissistaint-admin removal-agent; do
  if ! kcadm.sh get roles/\$role -r '$KC_REALM' >/dev/null 2>&1; then
    kcadm.sh create roles -r '$KC_REALM' -s name=\$role >/dev/null
  fi
done

upsert_client() {
  local client_id=\"\$1\"
  local client_file=\"\$2\"
  if kcadm.sh get clients -r '$KC_REALM' -q clientId=\"\$client_id\" | grep -q '\"clientId\"'; then
    local client_uuid
    client_uuid=\$(kcadm.sh get clients -r '$KC_REALM' -q clientId=\"\$client_id\" | sed -n 's/.*\"id\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p' | head -n1)
    kcadm.sh update clients/\$client_uuid -r '$KC_REALM' -f \"\$client_file\" >/dev/null
  else
    kcadm.sh create clients -r '$KC_REALM' -f \"\$client_file\" >/dev/null
  fi
}

cat >/tmp/minio-client.json <<JSON
{
  \"clientId\": \"$MINIO_CLIENT_ID\",
  \"enabled\": true,
  \"protocol\": \"openid-connect\",
  \"publicClient\": false,
  \"standardFlowEnabled\": true,
  \"redirectUris\": [
    \"$PUBLIC_MINIO_CONSOLE_URL/oauth_callback\"
  ],
  \"webOrigins\": [
    \"$PUBLIC_MINIO_CONSOLE_URL\"
  ]
}
JSON

cat >/tmp/openbao-client.json <<JSON
{
  \"clientId\": \"$OPENBAO_CLIENT_ID\",
  \"enabled\": true,
  \"protocol\": \"openid-connect\",
  \"publicClient\": false,
  \"standardFlowEnabled\": true,
  \"redirectUris\": [
    \"$PUBLIC_OPENBAO_URL/v1/auth/oidc/oidc/callback\",
    \"$PUBLIC_OPENBAO_URL/ui/vault/auth/oidc/oidc/callback\"
  ],
  \"webOrigins\": [\"$PUBLIC_OPENBAO_URL\"]
}
JSON

cat >/tmp/aissistaint-ui-client.json <<JSON
{
  \"clientId\": \"$AISSISTAINT_UI_CLIENT_ID\",
  \"name\": \"AISSIStaint React UI\",
  \"description\": \"Public PKCE client for the Vite React front-end\",
  \"enabled\": true,
  \"protocol\": \"openid-connect\",
  \"publicClient\": true,
  \"standardFlowEnabled\": true,
  \"implicitFlowEnabled\": false,
  \"directAccessGrantsEnabled\": false,
  \"serviceAccountsEnabled\": false,
  \"frontchannelLogout\": true,
  \"attributes\": {
    \"pkce.code.challenge.method\": \"S256\",
    \"post.logout.redirect.uris\": \"$PUBLIC_APP_URL/*##http://localhost:$AISSISTAINT_UI_DEV_PORT/*##http://127.0.0.1:$AISSISTAINT_UI_DEV_PORT/*##http://$HOST_IP:$AISSISTAINT_UI_DEV_PORT/*\"
  },
  \"redirectUris\": [
    \"$PUBLIC_APP_URL/*\",
    \"http://localhost:$AISSISTAINT_UI_DEV_PORT/*\",
    \"http://127.0.0.1:$AISSISTAINT_UI_DEV_PORT/*\",
    \"http://$HOST_IP:$AISSISTAINT_UI_DEV_PORT/*\"
  ],
  \"webOrigins\": [
    \"$PUBLIC_APP_URL\",
    \"http://localhost:$AISSISTAINT_UI_DEV_PORT\",
    \"http://127.0.0.1:$AISSISTAINT_UI_DEV_PORT\",
    \"http://$HOST_IP:$AISSISTAINT_UI_DEV_PORT\"
  ]
}
JSON

upsert_client '$MINIO_CLIENT_ID' /tmp/minio-client.json
upsert_client '$OPENBAO_CLIENT_ID' /tmp/openbao-client.json
upsert_client '$AISSISTAINT_UI_CLIENT_ID' /tmp/aissistaint-ui-client.json

MINIO_CLIENT_UUID=\$(kcadm.sh get clients -r '$KC_REALM' -q clientId='$MINIO_CLIENT_ID' | sed -n 's/.*\"id\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p' | head -n1)
OPENBAO_CLIENT_UUID=\$(kcadm.sh get clients -r '$KC_REALM' -q clientId='$OPENBAO_CLIENT_ID' | sed -n 's/.*\"id\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p' | head -n1)

cat >/tmp/policy-mapper.json <<JSON
{
  \"name\": \"policy\",
  \"protocol\": \"openid-connect\",
  \"protocolMapper\": \"oidc-hardcoded-claim-mapper\",
  \"consentRequired\": false,
  \"config\": {
    \"claim.name\": \"policy\",
    \"claim.value\": \"$MINIO_POLICY_NAME\",
    \"jsonType.label\": \"String\",
    \"id.token.claim\": \"true\",
    \"access.token.claim\": \"true\",
    \"userinfo.token.claim\": \"true\"
  }
}
JSON

POLICY_MAPPER_UUID=\"\"
CURRENT_MAPPER_UUID=\"\"
while IFS= read -r line; do
  case \"\$line\" in
    *'\"id\"'*)
      CURRENT_MAPPER_UUID=\$(printf '%s\n' \"\$line\" | sed -n 's/.*\"id\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p')
      ;;
    *'\"name\"'*'\"policy\"'*)
      POLICY_MAPPER_UUID=\"\$CURRENT_MAPPER_UUID\"
      break
      ;;
  esac
done < <(kcadm.sh get clients/\$MINIO_CLIENT_UUID/protocol-mappers/models -r '$KC_REALM')

if [[ -n \"\$POLICY_MAPPER_UUID\" ]]; then
  kcadm.sh delete clients/\$MINIO_CLIENT_UUID/protocol-mappers/models/\$POLICY_MAPPER_UUID -r '$KC_REALM' >/dev/null
fi
kcadm.sh create clients/\$MINIO_CLIENT_UUID/protocol-mappers/models -r '$KC_REALM' -f /tmp/policy-mapper.json >/dev/null

kcadm.sh get clients/\$MINIO_CLIENT_UUID/client-secret -r '$KC_REALM' > /tmp/minio-secret.json
kcadm.sh get clients/\$OPENBAO_CLIENT_UUID/client-secret -r '$KC_REALM' > /tmp/openbao-secret.json
cat /tmp/minio-secret.json
printf '\n---OPENBAO-SECRET---\n'
cat /tmp/openbao-secret.json
" > "$KEYCLOAK_SECRETS_OUT"
  chmod 600 "$KEYCLOAK_SECRETS_OUT"

  local minio_secret openbao_secret
  minio_secret="$(sed -n '1,/---OPENBAO-SECRET---/p' "$KEYCLOAK_SECRETS_OUT" | json_extract_value)"
  openbao_secret="$(sed -n '/---OPENBAO-SECRET---/,$p' "$KEYCLOAK_SECRETS_OUT" | json_extract_value)"

  if [[ -z "$minio_secret" || -z "$openbao_secret" ]]; then
    echo "Failed to extract Keycloak client secrets" >&2
    exit 1
  fi

  write_runtime_env "$minio_secret" "$openbao_secret"
}

configure_minio() {
  if [[ "$MANAGE_MINIO" != "1" ]]; then
    info "Skipping managed MinIO setup (MANAGE_MINIO=$MANAGE_MINIO)"
    return 0
  fi

  info "Waiting for MinIO"
  wait_for_http_200 "$INTERNAL_MINIO_ENDPOINT/minio/health/live" "MinIO"

  if [[ "$TLS_GATEWAY_ENABLED" == "1" ]]; then
    info "Waiting for Caddy local CA root"
    wait_for_file "$CADDY_DATA_DIR/caddy/pki/authorities/local/root.crt" "Caddy local CA root"

    info "Restarting MinIO with Caddy CA trust"
    podman restart "$MINIO_CONTAINER" >/dev/null
    wait_for_http_200 "$INTERNAL_MINIO_ENDPOINT/minio/health/live" "MinIO with Caddy CA trust" 60 2
  fi

  local minio_mc_network=()
  local minio_mc_endpoint="$INTERNAL_MINIO_ENDPOINT"
  if [[ "$EXPOSE_RAW_SERVICE_PORTS" == "1" ]]; then
    minio_mc_network=(--network host)
  else
    minio_mc_network=(--network "$NETWORK_NAME")
    minio_mc_endpoint="http://$MINIO_CONTAINER:9000"
  fi

  info "Configuring MinIO alias"
  podman run --rm "${minio_mc_network[@]}" -v "$MINIO_MC_DIR:/root/.mc:Z" "$MINIO_MC_IMAGE" \
    alias set local "$minio_mc_endpoint" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null

  info "Creating bucket $MINIO_BUCKET"
  podman run --rm "${minio_mc_network[@]}" -v "$MINIO_MC_DIR:/root/.mc:Z" "$MINIO_MC_IMAGE" \
    mb --ignore-existing "local/$MINIO_BUCKET" >/dev/null

  info "Loading MinIO policy $MINIO_POLICY_NAME"
  podman run --rm "${minio_mc_network[@]}" -v "$MINIO_MC_DIR:/root/.mc:Z" -v "$MINIO_POLICY_FILE:/work/policy.json:Z,ro" "$MINIO_MC_IMAGE" \
    admin policy create local "$MINIO_POLICY_NAME" "/work/policy.json" >/dev/null || true

  info "Loading MinIO app policy $MINIO_APP_POLICY_NAME"
  podman run --rm "${minio_mc_network[@]}" -v "$MINIO_MC_DIR:/root/.mc:Z" -v "$MINIO_APP_POLICY_FILE:/work/policy.json:Z,ro" "$MINIO_MC_IMAGE" \
    admin policy create local "$MINIO_APP_POLICY_NAME" "/work/policy.json" >/dev/null || true

  info "Loading MinIO removal policy $MINIO_REMOVAL_POLICY_NAME"
  podman run --rm "${minio_mc_network[@]}" -v "$MINIO_MC_DIR:/root/.mc:Z" -v "$MINIO_REMOVAL_POLICY_FILE:/work/policy.json:Z,ro" "$MINIO_MC_IMAGE" \
    admin policy create local "$MINIO_REMOVAL_POLICY_NAME" "/work/policy.json" >/dev/null || true

  info "Creating MinIO app service user"
  podman run --rm "${minio_mc_network[@]}" -v "$MINIO_MC_DIR:/root/.mc:Z" "$MINIO_MC_IMAGE" \
    admin user add local "$MINIO_APP_ACCESS_KEY" "$MINIO_APP_SECRET_KEY" >/dev/null || true
  podman run --rm "${minio_mc_network[@]}" -v "$MINIO_MC_DIR:/root/.mc:Z" "$MINIO_MC_IMAGE" \
    admin policy attach local "$MINIO_APP_POLICY_NAME" --user "$MINIO_APP_ACCESS_KEY" >/dev/null

  info "Creating MinIO removal service user"
  podman run --rm "${minio_mc_network[@]}" -v "$MINIO_MC_DIR:/root/.mc:Z" "$MINIO_MC_IMAGE" \
    admin user add local "$MINIO_REMOVAL_ACCESS_KEY" "$MINIO_REMOVAL_SECRET_KEY" >/dev/null || true
  podman run --rm "${minio_mc_network[@]}" -v "$MINIO_MC_DIR:/root/.mc:Z" "$MINIO_MC_IMAGE" \
    admin policy attach local "$MINIO_REMOVAL_POLICY_NAME" --user "$MINIO_REMOVAL_ACCESS_KEY" >/dev/null

  info "Configuring MinIO OIDC"
  . "$ENV_FILE"
  podman run --rm "${minio_mc_network[@]}" -v "$MINIO_MC_DIR:/root/.mc:Z" "$MINIO_MC_IMAGE" \
    admin config set local identity_openid \
    config_url="http://${KEYCLOAK_CONTAINER}:8080/realms/${KC_REALM}/.well-known/openid-configuration" \
    client_id="$MINIO_CLIENT_ID" \
    client_secret="$MINIO_CLIENT_SECRET" \
    claim_name='policy' \
    scopes='openid,profile,email' \
    display_name='Keycloak' \
    redirect_uri="${PUBLIC_MINIO_CONSOLE_URL}/oauth_callback" >/dev/null

  info "Restarting MinIO container"
  podman restart "$MINIO_CONTAINER" >/dev/null
  wait_for_http_200 "$INTERNAL_MINIO_ENDPOINT/minio/health/live" "MinIO after restart" 60 2
}

configure_openbao() {
  if [[ "$MANAGE_OPENBAO" != "1" ]]; then
    info "Skipping managed OpenBao setup (MANAGE_OPENBAO=$MANAGE_OPENBAO)"
    return 0
  fi

  info "Waiting for OpenBao API"
  if ! wait_for_openbao 30; then
    show_container_logs "$OPENBAO_CONTAINER"
    exit 1
  fi

  if [[ "$TLS_GATEWAY_ENABLED" == "1" ]]; then
    info "Waiting for Caddy local CA root for OpenBao"
    wait_for_file "$CADDY_DATA_DIR/caddy/pki/authorities/local/root.crt" "Caddy local CA root"

    info "Restarting OpenBao with Caddy CA trust"
    podman restart "$OPENBAO_CONTAINER" >/dev/null
    if ! wait_for_openbao 30; then
      show_container_logs "$OPENBAO_CONTAINER"
      exit 1
    fi
  fi

  if ! curl -ksS "$INTERNAL_OPENBAO_URL/v1/sys/init" | grep -q '"initialized":true'; then
    info "Initializing OpenBao"
    podman exec "$OPENBAO_CONTAINER" sh -lc '
      export BAO_ADDR=http://127.0.0.1:8200
      bao operator init -format=json -key-shares=1 -key-threshold=1
    ' > "$OPENBAO_INIT_FILE"
    chmod 600 "$OPENBAO_INIT_FILE"
  elif [[ ! -f "$OPENBAO_INIT_FILE" ]]; then
    echo "OpenBao is already initialized, but $OPENBAO_INIT_FILE is missing." >&2
    echo "Either restore that file or rerun with CLEAN_DATA=1." >&2
    exit 1
  fi

  local unseal_key root_token
  if grep -q '^{' "$OPENBAO_INIT_FILE" 2>/dev/null; then
    unseal_key="$(jq -r '.unseal_keys_b64[0] // .recovery_keys_b64[0] // empty' "$OPENBAO_INIT_FILE")"
    root_token="$(jq -r '.root_token // empty' "$OPENBAO_INIT_FILE")"
  else
    unseal_key="$(sed -n 's/^Unseal Key 1:[[:space:]]*//p' "$OPENBAO_INIT_FILE" | head -n1)"
    if [[ -z "$unseal_key" ]]; then
      unseal_key="$(sed -n 's/^Unseal Key:[[:space:]]*//p' "$OPENBAO_INIT_FILE" | head -n1)"
    fi
    root_token="$(sed -n 's/^Initial Root Token:[[:space:]]*//p' "$OPENBAO_INIT_FILE" | head -n1)"
    if [[ -z "$root_token" ]]; then
      root_token="$(sed -n 's/^Root Token:[[:space:]]*//p' "$OPENBAO_INIT_FILE" | head -n1)"
    fi
  fi
  if [[ -z "$unseal_key" || -z "$root_token" ]]; then
    echo "Failed to parse unseal key or root token from $OPENBAO_INIT_FILE" >&2
    cat "$OPENBAO_INIT_FILE" >&2 || true
    exit 1
  fi
  OPENBAO_UNSEAL_KEY="$unseal_key"
  OPENBAO_ROOT_TOKEN="$root_token"

  if curl -ksS "$INTERNAL_OPENBAO_URL/v1/sys/seal-status" | grep -q '"sealed":true'; then
    info "Unsealing OpenBao"
    podman exec "$OPENBAO_CONTAINER" sh -lc "
      export BAO_ADDR=http://127.0.0.1:8200
      bao operator unseal '$unseal_key' >/dev/null
    "
  fi

  write_runtime_env "$MINIO_CLIENT_SECRET" "$OPENBAO_CLIENT_SECRET"

  info "Enabling KV v2 and configuring OpenBao OIDC"
  . "$ENV_FILE"
  podman exec "$OPENBAO_CONTAINER" sh -lc "
    export BAO_ADDR=http://127.0.0.1:8200
    export BAO_TOKEN='$OPENBAO_ROOT_TOKEN'

    bao secrets enable -path='$OPENBAO_KV_MOUNT' -version=2 kv >/dev/null 2>&1 || true
    bao auth enable oidc >/dev/null 2>&1 || true

    bao write auth/oidc/config \
      oidc_discovery_url='$PUBLIC_KEYCLOAK_URL/realms/$KC_REALM' \
      oidc_discovery_ca_pem=@/caddy-data/caddy/pki/authorities/local/root.crt \
      oidc_client_id='$OPENBAO_CLIENT_ID' \
      oidc_client_secret='$OPENBAO_CLIENT_SECRET' \
      default_role='default' >/dev/null

    cat >/tmp/app-tokens-rw.hcl <<POLICY
path \"$OPENBAO_KV_MOUNT/data/$OPENBAO_RW_PREFIX/*\" {
  capabilities = [\"create\", \"update\", \"read\", \"delete\"]
}

path \"$OPENBAO_KV_MOUNT/metadata/$OPENBAO_RW_PREFIX/*\" {
  capabilities = [\"read\", \"list\", \"delete\"]
}
POLICY

    bao policy write app-tokens-rw /tmp/app-tokens-rw.hcl >/dev/null
    bao token create -policy=app-tokens-rw -field=token > /tmp/openbao-app-token

    bao write auth/oidc/role/default \
      role_type='oidc' \
      user_claim='sub' \
      token_policies='app-tokens-rw' \
      oidc_scopes='profile,email' \
      callback_mode='direct' \
      oidc_disable_confirmation='true' \
      allowed_redirect_uris='$PUBLIC_OPENBAO_URL/v1/auth/oidc/oidc/callback' \
      allowed_redirect_uris='$PUBLIC_OPENBAO_URL/ui/vault/auth/oidc/oidc/callback' >/dev/null
  "

  local app_token
  app_token="$(podman exec "$OPENBAO_CONTAINER" sh -lc 'cat /tmp/openbao-app-token')"
  if [[ -n "$app_token" ]]; then
    OPENBAO_APP_TOKEN="$app_token"
  fi
  write_runtime_env "$MINIO_CLIENT_SECRET" "$OPENBAO_CLIENT_SECRET"
}

print_summary() {
  . "$ENV_FILE"
  cat <<SUMMARY

Bootstrap complete.

Admin endpoints:
  App HTTPS URL:          $PUBLIC_APP_URL
  Keycloak admin console: $PUBLIC_KEYCLOAK_URL/admin
  Keycloak account UI:    $PUBLIC_KEYCLOAK_URL/realms/$KC_REALM/account
  AISSIStaint UI client:  $AISSISTAINT_UI_CLIENT_ID
  App Postgres:           127.0.0.1:$APP_POSTGRES_PORT/$APP_POSTGRES_DB
  MinIO console:          $PUBLIC_MINIO_CONSOLE_URL
  MinIO endpoint:         $PUBLIC_MINIO_URL
  OpenBao UI:             $PUBLIC_OPENBAO_URL/ui
  LiteLLM proxy:          $INTERNAL_LITELLM_URL
  LiteLLM admin broker:   $LITELLM_ADMIN_BROKER_URL
  Goose headless server:  $INTERNAL_GOOSE_URL

Important local files:
  Admin/bootstrap env:    $ENV_FILE
  API runtime env:        $RUNTIME_ENV_FILE
  Secret encryption key:  $SECRET_ENCRYPTION_KEY_FILE
  OpenBao init material:  $OPENBAO_INIT_FILE
  MinIO policy file:      $MINIO_POLICY_FILE
  MinIO removal policy:   $MINIO_REMOVAL_POLICY_FILE
  Caddyfile:              $CADDYFILE
  Local CA root:          $CADDY_DATA_DIR/caddy/pki/authorities/local/root.crt

Containers:
  $CADDY_CONTAINER
  $POSTGRES_CONTAINER
  $APP_POSTGRES_CONTAINER
  $KEYCLOAK_CONTAINER
  $OPENBAO_CONTAINER
  $MINIO_CONTAINER
  $LITELLM_CONTAINER
  $GOOSE_CONTAINER

Realm and access model:
  Realm:                  $KC_REALM
  Default group name:     $KC_GROUP
  MinIO policy name:      $MINIO_POLICY_NAME
  Removal policy name:    $MINIO_REMOVAL_POLICY_NAME
  Deletion authority:     aissistaint-admin or removal-agent, with explicit API removal credentials
  Project bucket prefix:  $PROJECT_BUCKET_PREFIX
  Project object prefixes:$PROJECT_LOADED_PREFIX/, $PROJECT_PARSED_PREFIX/
  Project metadata file:  $PROJECT_METADATA_OBJECT_KEY
  OpenBao KV mount:       $OPENBAO_KV_MOUNT
  OpenBao writable prefix:$OPENBAO_RW_PREFIX/
  Raw host ports exposed: $EXPOSE_RAW_SERVICE_PORTS

Service management:
  TLS gateway managed:    $MANAGE_TLS_GATEWAY
  Keycloak DB managed:    $MANAGE_KEYCLOAK_POSTGRES
  Keycloak managed:       $MANAGE_KEYCLOAK
  App Postgres managed:   $MANAGE_APP_POSTGRES
  OpenBao managed:        $MANAGE_OPENBAO
  MinIO managed:          $MANAGE_MINIO
  LiteLLM managed:        $MANAGE_LITELLM
  Goose managed:          $MANAGE_GOOSE

Next steps:
  1. Trust the local TLS CA for browser access.
     Import this CA root into your OS/browser trust store:
       $CADDY_DATA_DIR/caddy/pki/authorities/local/root.crt

  2. Start the AIssistAInt app from the repo root:
       PLATFORM_ENV_FILE="$RUNTIME_ENV_FILE" npm run dev

     If the UI still runs in mock mode, copy .env.example to .env.local and set:
       VITE_USE_MOCK_SERVICES=false
       PLATFORM_ENV_FILE=$RUNTIME_ENV_FILE

  3. Add admin or user accounts with the Keycloak helper:
       podman_services/keycloak_user_admin.sh --env-file "$ENV_FILE" add alice --email alice@example.org --print-password

     New users should receive temporary passwords and change them on first login.
     Generated passwords are recorded in:
       $PASSWORD_OUT_FILE

  4. Open the app and finish admin configuration:
       $PUBLIC_APP_URL

     Sign in, open Preferences, configure provider endpoints/models for LLM_A, LLM_B, and LLM_C,
     and keep provider API keys in the Preferences/OpenBao flow rather than repo env files.

  5. Review operator guidance:
       README.md
       docs/ai-governance/SYSTEM_INVENTORY.md
       docs/ai-governance/RISK_REGISTER.md
       docs/ai-governance/INCIDENT_RESPONSE.md
SUMMARY
}

main() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    echo "Do not run this script with sudo/root. Use rootless Podman as your normal user." >&2
    exit 1
  fi

  require_cmd podman
  require_cmd curl
  require_cmd sed
  require_cmd jq

  load_existing_runtime_env
  initialize_generated_secrets
  mkdir -p "$BASE_DIR"
  chmod 700 "$BASE_DIR" 2>/dev/null || true
  write_secret_key_file
  write_runtime_env
  validate_litellm_topology
  validate_goose_topology
  info "Using HOST_IP=$HOST_IP"
  start_infra
  configure_keycloak
  configure_minio
  configure_openbao
  start_litellm
  start_goose
  print_summary
}

main "$@"
