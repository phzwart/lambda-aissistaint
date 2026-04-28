#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${STACK_NAME:-platform-demo}"
BASE_DIR="${BASE_DIR:-$HOME/$STACK_NAME}"
NETWORK_NAME="${NETWORK_NAME:-${STACK_NAME}-net}"
KC_REALM="${KC_REALM:-minio}"
KC_GROUP="${KC_GROUP:-platform-users}"
KC_ADMIN_USER="${KC_ADMIN_USER:-admin}"
KC_ADMIN_PASSWORD="${KC_ADMIN_PASSWORD:-ChangeKeycloakAdminPassword123!}"
KC_DB_PASSWORD="${KC_DB_PASSWORD:-ChangeKeycloakDbPassword123!}"
APP_POSTGRES_DB="${APP_POSTGRES_DB:-aissistaint}"
APP_POSTGRES_USER="${APP_POSTGRES_USER:-aissistaint}"
APP_POSTGRES_PASSWORD="${APP_POSTGRES_PASSWORD:-ChangeAppPostgresPassword123!}"
APP_POSTGRES_PORT="${APP_POSTGRES_PORT:-5433}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-ChangeMinioRootPassword123!}"
MINIO_BUCKET="${MINIO_BUCKET:-project-a}"
MINIO_POLICY_NAME="${MINIO_POLICY_NAME:-project-a-rw}"
OPENBAO_KV_MOUNT="${OPENBAO_KV_MOUNT:-secret}"
OPENBAO_RW_PREFIX="${OPENBAO_RW_PREFIX:-app-tokens}"
CLEAN_DATA="${CLEAN_DATA:-0}"

POSTGRES_IMAGE="${POSTGRES_IMAGE:-docker.io/library/postgres:16}"
KEYCLOAK_IMAGE="${KEYCLOAK_IMAGE:-quay.io/keycloak/keycloak:26.6.1}"
OPENBAO_IMAGE="${OPENBAO_IMAGE:-quay.io/openbao/openbao:latest}"
MINIO_IMAGE="${MINIO_IMAGE:-quay.io/minio/minio:RELEASE.2025-02-18T16-25-55Z}"
MINIO_MC_IMAGE="${MINIO_MC_IMAGE:-quay.io/minio/mc:latest}"

POSTGRES_CONTAINER="${STACK_NAME}-postgres"
APP_POSTGRES_CONTAINER="${STACK_NAME}-app-postgres"
KEYCLOAK_CONTAINER="${STACK_NAME}-keycloak"
OPENBAO_CONTAINER="${STACK_NAME}-openbao"
MINIO_CONTAINER="${STACK_NAME}-minio"
MINIO_CLIENT_ID="${MINIO_CLIENT_ID:-minio-console}"
OPENBAO_CLIENT_ID="${OPENBAO_CLIENT_ID:-openbao}"
AISSISTAINT_UI_CLIENT_ID="${AISSISTAINT_UI_CLIENT_ID:-aissistaint-ui}"
AISSISTAINT_UI_DEV_PORT="${AISSISTAINT_UI_DEV_PORT:-5173}"

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
ENV_FILE="$BASE_DIR/${STACK_NAME}.env"
KEYCLOAK_SECRETS_OUT="$BASE_DIR/keycloak-secrets.out"

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

wait_for_openbao() {
  local tries="${1:-120}"
  local code i
  for ((i=1; i<=tries; i++)); do
    code="$(curl -ksS -o /dev/null -w '%{http_code}' http://127.0.0.1:8200/v1/sys/health || true)"
    case "$code" in
      200|429|472|473|501|503) return 0 ;;
    esac
    sleep 2
  done
  echo "Timed out waiting for OpenBao API" >&2
  return 1
}

json_extract_value() {
  sed -n 's/.*"value"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
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

write_openbao_config() {
  cat > "$OPENBAO_CONFIG_FILE" <<CFG
ui = true

disable_mlock = true
api_addr = "http://localhost:8200"
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

write_minio_policy() {
  cat > "$MINIO_POLICY_FILE" <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetBucketLocation",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::${MINIO_BUCKET}"
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
        "arn:aws:s3:::${MINIO_BUCKET}/*"
      ]
    }
  ]
}
POLICY
}

prepare_dirs() {
  mkdir -p "$POSTGRES_DATA_DIR" "$APP_POSTGRES_DATA_DIR" "$OPENBAO_DATA_DIR" "$OPENBAO_CONFIG_DIR" "$MINIO_DATA_DIR" "$MINIO_MC_DIR"
  mkdir -p "$BASE_OPENBAO_DIR" "$BASE_MINIO_DIR" "$BASE_KEYCLOAK_DIR" "$BASE_APP_POSTGRES_DIR"
  chmod 700 "$BASE_DIR" "$BASE_OPENBAO_DIR" 2>/dev/null || true

  if [[ "$CLEAN_DATA" == "1" ]]; then
    warn "CLEAN_DATA=1 set. Removing data under $BASE_DIR"
    rm -rf "$POSTGRES_DATA_DIR" "$APP_POSTGRES_DATA_DIR" "$OPENBAO_DATA_DIR" "$OPENBAO_CONFIG_DIR" "$MINIO_DATA_DIR" "$MINIO_MC_DIR" "$OPENBAO_INIT_FILE" "$ENV_FILE" "$KEYCLOAK_SECRETS_OUT" "$MINIO_POLICY_FILE"
    mkdir -p "$POSTGRES_DATA_DIR" "$APP_POSTGRES_DATA_DIR" "$OPENBAO_DATA_DIR" "$OPENBAO_CONFIG_DIR" "$MINIO_DATA_DIR" "$MINIO_MC_DIR"
  fi

  write_openbao_config
  write_minio_policy

  # OpenBao container runs as a non-root user; make the persistent data dir writable
  # under the rootless Podman user namespace before starting the container.
  podman unshare chown -R 100:100 "$OPENBAO_DATA_DIR" >/dev/null 2>&1 || true
  chmod 700 "$OPENBAO_DATA_DIR" 2>/dev/null || true
}

pull_images() {
  info "Pulling container images"
  podman pull "$POSTGRES_IMAGE" >/dev/null
  podman pull "$KEYCLOAK_IMAGE" >/dev/null
  podman pull "$OPENBAO_IMAGE" >/dev/null
  podman pull "$MINIO_IMAGE" >/dev/null
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

  for c in "$MINIO_CONTAINER" "$OPENBAO_CONTAINER" "$KEYCLOAK_CONTAINER" "$APP_POSTGRES_CONTAINER" "$POSTGRES_CONTAINER"; do
    if container_exists "$c"; then
      info "Removing existing container $c"
      podman rm -f "$c" >/dev/null || true
    fi
  done

  info "Starting PostgreSQL"
  podman run -d \
    --name "$POSTGRES_CONTAINER" \
    --network "$NETWORK_NAME" \
    -e POSTGRES_DB=keycloak \
    -e POSTGRES_USER=keycloak \
    -e POSTGRES_PASSWORD="$KC_DB_PASSWORD" \
    -v "$POSTGRES_DATA_DIR:/var/lib/postgresql/data:Z" \
    "$POSTGRES_IMAGE" >/dev/null

  info "Starting app PostgreSQL"
  podman run -d \
    --name "$APP_POSTGRES_CONTAINER" \
    --network "$NETWORK_NAME" \
    -p "${APP_POSTGRES_PORT}:5432" \
    -e POSTGRES_DB="$APP_POSTGRES_DB" \
    -e POSTGRES_USER="$APP_POSTGRES_USER" \
    -e POSTGRES_PASSWORD="$APP_POSTGRES_PASSWORD" \
    -v "$APP_POSTGRES_DATA_DIR:/var/lib/postgresql/data:Z" \
    "$POSTGRES_IMAGE" >/dev/null

  info "Starting Keycloak"
  podman run -d \
    --name "$KEYCLOAK_CONTAINER" \
    --network "$NETWORK_NAME" \
    -p 8080:8080 \
    -e KC_BOOTSTRAP_ADMIN_USERNAME="$KC_ADMIN_USER" \
    -e KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
    -e KC_DB=postgres \
    -e KC_DB_URL="jdbc:postgresql://$POSTGRES_CONTAINER:5432/keycloak" \
    -e KC_DB_USERNAME=keycloak \
    -e KC_DB_PASSWORD="$KC_DB_PASSWORD" \
    "$KEYCLOAK_IMAGE" \
    start-dev >/dev/null

  info "Starting OpenBao (non-dev, single-node raft)"
  podman run -d \
    --name "$OPENBAO_CONTAINER" \
    --network "$NETWORK_NAME" \
    -p 8200:8200 \
    -p 8201:8201 \
    -v "$OPENBAO_CONFIG_FILE:/etc/openbao/openbao.hcl:Z,ro" \
    -v "$OPENBAO_DATA_DIR:/openbao/data:Z" \
    "$OPENBAO_IMAGE" \
    server -config=/etc/openbao/openbao.hcl >/dev/null

  info "Starting MinIO"
  podman run -d \
    --name "$MINIO_CONTAINER" \
    -p 9000:9000 \
    -p 9001:9001 \
    -v "$MINIO_DATA_DIR:/data:Z" \
    -e MINIO_ROOT_USER="$MINIO_ROOT_USER" \
    -e MINIO_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD" \
    "$MINIO_IMAGE" \
    server /data --console-address ':9001' >/dev/null

  assert_container_running "$POSTGRES_CONTAINER"
  assert_container_running "$APP_POSTGRES_CONTAINER"
  assert_container_running "$KEYCLOAK_CONTAINER"
  assert_container_running "$OPENBAO_CONTAINER"
  assert_container_running "$MINIO_CONTAINER"
}

configure_keycloak() {
  info "Waiting for Keycloak"
  wait_for_http_200 "http://127.0.0.1:8080/realms/master/.well-known/openid-configuration" "Keycloak"

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

create_client_if_missing() {
  local client_id=\"\$1\"
  local client_file=\"\$2\"
  if ! kcadm.sh get clients -r '$KC_REALM' -q clientId=\"\$client_id\" | grep -q '\"clientId\"'; then
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
  \"redirectUris\": [\"http://$HOST_IP:9001/oauth_callback\"],
  \"webOrigins\": [\"http://$HOST_IP:9001\"]
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
    \"http://localhost:8200/v1/auth/oidc/oidc/callback\",
    \"http://localhost:8200/ui/vault/auth/oidc/oidc/callback\"
  ],
  \"webOrigins\": [\"http://localhost:8200\"]
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
    \"post.logout.redirect.uris\": \"http://localhost:$AISSISTAINT_UI_DEV_PORT/*##http://127.0.0.1:$AISSISTAINT_UI_DEV_PORT/*##http://$HOST_IP:$AISSISTAINT_UI_DEV_PORT/*\"
  },
  \"redirectUris\": [
    \"http://localhost:$AISSISTAINT_UI_DEV_PORT/*\",
    \"http://127.0.0.1:$AISSISTAINT_UI_DEV_PORT/*\",
    \"http://$HOST_IP:$AISSISTAINT_UI_DEV_PORT/*\"
  ],
  \"webOrigins\": [
    \"http://localhost:$AISSISTAINT_UI_DEV_PORT\",
    \"http://127.0.0.1:$AISSISTAINT_UI_DEV_PORT\",
    \"http://$HOST_IP:$AISSISTAINT_UI_DEV_PORT\"
  ]
}
JSON

create_client_if_missing '$MINIO_CLIENT_ID' /tmp/minio-client.json
create_client_if_missing '$OPENBAO_CLIENT_ID' /tmp/openbao-client.json
if kcadm.sh get clients -r '$KC_REALM' -q clientId='$AISSISTAINT_UI_CLIENT_ID' | grep -q '\"clientId\"'; then
  AISSISTAINT_UI_CLIENT_UUID=\$(kcadm.sh get clients -r '$KC_REALM' -q clientId='$AISSISTAINT_UI_CLIENT_ID' | sed -n 's/.*\"id\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p' | head -n1)
  kcadm.sh update clients/\$AISSISTAINT_UI_CLIENT_UUID -r '$KC_REALM' -f /tmp/aissistaint-ui-client.json >/dev/null
else
  kcadm.sh create clients -r '$KC_REALM' -f /tmp/aissistaint-ui-client.json >/dev/null
fi

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

  local minio_secret openbao_secret
  minio_secret="$(sed -n '1,/---OPENBAO-SECRET---/p' "$KEYCLOAK_SECRETS_OUT" | json_extract_value)"
  openbao_secret="$(sed -n '/---OPENBAO-SECRET---/,$p' "$KEYCLOAK_SECRETS_OUT" | json_extract_value)"

  if [[ -z "$minio_secret" || -z "$openbao_secret" ]]; then
    echo "Failed to extract Keycloak client secrets" >&2
    exit 1
  fi

  cat > "$ENV_FILE" <<ENV
STACK_NAME=$STACK_NAME
BASE_DIR=$BASE_DIR
NETWORK_NAME=$NETWORK_NAME
HOST_IP=$HOST_IP
KC_REALM=$KC_REALM
KC_GROUP=$KC_GROUP
KC_ADMIN_USER=$KC_ADMIN_USER
KC_ADMIN_PASSWORD=$KC_ADMIN_PASSWORD
KEYCLOAK_CONTAINER=$KEYCLOAK_CONTAINER
POSTGRES_CONTAINER=$POSTGRES_CONTAINER
APP_POSTGRES_CONTAINER=$APP_POSTGRES_CONTAINER
APP_POSTGRES_DB=$APP_POSTGRES_DB
APP_POSTGRES_USER=$APP_POSTGRES_USER
APP_POSTGRES_PASSWORD=$APP_POSTGRES_PASSWORD
APP_POSTGRES_PORT=$APP_POSTGRES_PORT
APP_DATABASE_URL=postgres://$APP_POSTGRES_USER:$APP_POSTGRES_PASSWORD@127.0.0.1:$APP_POSTGRES_PORT/$APP_POSTGRES_DB
OPENBAO_CONTAINER=$OPENBAO_CONTAINER
MINIO_CONTAINER=$MINIO_CONTAINER
MINIO_ROOT_USER=$MINIO_ROOT_USER
MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD
MINIO_BUCKET=$MINIO_BUCKET
MINIO_POLICY_NAME=$MINIO_POLICY_NAME
MINIO_CLIENT_ID=$MINIO_CLIENT_ID
MINIO_CLIENT_SECRET=$minio_secret
OPENBAO_CLIENT_ID=$OPENBAO_CLIENT_ID
OPENBAO_CLIENT_SECRET=$openbao_secret
AISSISTAINT_UI_CLIENT_ID=$AISSISTAINT_UI_CLIENT_ID
AISSISTAINT_UI_DEV_PORT=$AISSISTAINT_UI_DEV_PORT
VITE_USE_MOCK_SERVICES=false
VITE_KEYCLOAK_URL=http://$HOST_IP:8080
VITE_KEYCLOAK_REALM=$KC_REALM
VITE_KEYCLOAK_CLIENT_ID=$AISSISTAINT_UI_CLIENT_ID
VITE_OPENBAO_URL=http://localhost:8200
OPENBAO_KV_MOUNT=$OPENBAO_KV_MOUNT
OPENBAO_RW_PREFIX=$OPENBAO_RW_PREFIX
ENV
  chmod 600 "$ENV_FILE"
}

configure_minio() {
  info "Waiting for MinIO"
  wait_for_http_200 "http://127.0.0.1:9000/minio/health/live" "MinIO"

  info "Configuring MinIO alias"
  podman run --rm --network host -v "$MINIO_MC_DIR:/root/.mc:Z" "$MINIO_MC_IMAGE" \
    alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null

  info "Creating bucket $MINIO_BUCKET"
  podman run --rm --network host -v "$MINIO_MC_DIR:/root/.mc:Z" "$MINIO_MC_IMAGE" \
    mb --ignore-existing "local/$MINIO_BUCKET" >/dev/null

  info "Loading MinIO policy $MINIO_POLICY_NAME"
  podman run --rm --network host -v "$MINIO_MC_DIR:/root/.mc:Z" -v "$BASE_DIR:/work:Z" "$MINIO_MC_IMAGE" \
    admin policy create local "$MINIO_POLICY_NAME" "/work/$(basename "$MINIO_POLICY_FILE")" >/dev/null || true

  info "Configuring MinIO OIDC"
  . "$ENV_FILE"
  podman run --rm --network host -v "$MINIO_MC_DIR:/root/.mc:Z" "$MINIO_MC_IMAGE" \
    admin config set local identity_openid \
    config_url="http://${HOST_IP}:8080/realms/${KC_REALM}/.well-known/openid-configuration" \
    client_id="$MINIO_CLIENT_ID" \
    client_secret="$MINIO_CLIENT_SECRET" \
    claim_name='policy' \
    scopes='openid,profile,email' \
    display_name='Keycloak' \
    redirect_uri="http://${HOST_IP}:9001/oauth_callback" >/dev/null

  info "Restarting MinIO container"
  podman restart "$MINIO_CONTAINER" >/dev/null
  wait_for_http_200 "http://127.0.0.1:9000/minio/health/live" "MinIO after restart" 60 2
}

configure_openbao() {
  info "Waiting for OpenBao API"
  if ! wait_for_openbao 30; then
    show_container_logs "$OPENBAO_CONTAINER"
    exit 1
  fi

  if ! curl -ksS http://127.0.0.1:8200/v1/sys/init | grep -q '"initialized":true'; then
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

  if curl -ksS http://127.0.0.1:8200/v1/sys/seal-status | grep -q '"sealed":true'; then
    info "Unsealing OpenBao"
    podman exec "$OPENBAO_CONTAINER" sh -lc "
      export BAO_ADDR=http://127.0.0.1:8200
      bao operator unseal '$unseal_key' >/dev/null
    "
  fi

  if ! grep -q '^OPENBAO_ROOT_TOKEN=' "$ENV_FILE" 2>/dev/null; then
    {
      printf 'OPENBAO_UNSEAL_KEY=%s\n' "$unseal_key"
      printf 'OPENBAO_ROOT_TOKEN=%s\n' "$root_token"
    } >> "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi

  info "Enabling KV v2 and configuring OpenBao OIDC"
  . "$ENV_FILE"
  podman exec "$OPENBAO_CONTAINER" sh -lc "
    export BAO_ADDR=http://127.0.0.1:8200
    export BAO_TOKEN='$OPENBAO_ROOT_TOKEN'

    bao secrets enable -path='$OPENBAO_KV_MOUNT' -version=2 kv >/dev/null 2>&1 || true
    bao auth enable oidc >/dev/null 2>&1 || true

    bao write auth/oidc/config \
      oidc_discovery_url='http://$KEYCLOAK_CONTAINER:8080/realms/$KC_REALM' \
      oidc_client_id='$OPENBAO_CLIENT_ID' \
      oidc_client_secret='$OPENBAO_CLIENT_SECRET' \
      default_role='default' >/dev/null

    cat >/tmp/app-tokens-rw.hcl <<POLICY
path \"$OPENBAO_KV_MOUNT/data/$OPENBAO_RW_PREFIX/*\" {
  capabilities = [\"create\", \"update\", \"read\", \"delete\"]
}

path \"$OPENBAO_KV_MOUNT/metadata/$OPENBAO_RW_PREFIX/*\" {
  capabilities = [\"read\", \"list\"]
}
POLICY

    bao policy write app-tokens-rw /tmp/app-tokens-rw.hcl >/dev/null

    bao write auth/oidc/role/default \
      role_type='oidc' \
      user_claim='sub' \
      token_policies='app-tokens-rw' \
      oidc_scopes='profile,email' \
      callback_mode='direct' \
      oidc_disable_confirmation='true' \
      allowed_redirect_uris='http://localhost:8200/v1/auth/oidc/oidc/callback' \
      allowed_redirect_uris='http://localhost:8200/ui/vault/auth/oidc/oidc/callback' >/dev/null
  "
}

print_summary() {
  . "$ENV_FILE"
  cat <<SUMMARY

Bootstrap complete.

Admin endpoints:
  Keycloak admin console: http://$HOST_IP:8080/admin
  Keycloak account UI:    http://$HOST_IP:8080/realms/$KC_REALM/account
  AISSIStaint UI client:  $AISSISTAINT_UI_CLIENT_ID
  App Postgres:           127.0.0.1:$APP_POSTGRES_PORT/$APP_POSTGRES_DB
  MinIO console:          http://$HOST_IP:9001
  MinIO endpoint:         http://$HOST_IP:9000
  OpenBao UI:             http://localhost:8200/ui

Important local files:
  Environment + secrets:  $ENV_FILE
  OpenBao init material:  $OPENBAO_INIT_FILE
  MinIO policy file:      $MINIO_POLICY_FILE

Containers:
  $POSTGRES_CONTAINER
  $APP_POSTGRES_CONTAINER
  $KEYCLOAK_CONTAINER
  $OPENBAO_CONTAINER
  $MINIO_CONTAINER

Realm and access model:
  Realm:                  $KC_REALM
  Default group name:     $KC_GROUP
  MinIO policy name:      $MINIO_POLICY_NAME
  OpenBao KV mount:       $OPENBAO_KV_MOUNT
  OpenBao writable prefix:$OPENBAO_RW_PREFIX/

Next step:
  Use the admin helper script to add users.
  New users should get a temporary password and be forced to change it on first login.
SUMMARY
}

main() {
  require_cmd podman
  require_cmd curl
  require_cmd sed

  info "Using HOST_IP=$HOST_IP"
  start_infra
  configure_keycloak
  configure_minio
  configure_openbao
  print_summary
}

main "$@"
