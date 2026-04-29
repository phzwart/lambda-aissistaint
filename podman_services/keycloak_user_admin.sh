#!/usr/bin/env bash
set -euo pipefail

ENV_FILE_DEFAULT="$HOME/platform-demo/platform-demo.env"
ENV_FILE="${ENV_FILE:-$ENV_FILE_DEFAULT}"
TEMP_PASSWORD=""
EMAIL=""
FIRST_NAME=""
LAST_NAME=""
TEMPORARY="true"
CMD=""
USERNAME=""
PRINT_PASSWORD=0
PASSWORD_OUT_FILE="${PASSWORD_OUT_FILE:-}"

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") [--env-file FILE] add USERNAME [--password PASS] [--email EMAIL] [--first FIRST] [--last LAST] [--temporary true|false] [--print-password]
  $(basename "$0") [--env-file FILE] reset-password USERNAME --password PASS [--temporary true|false]
  $(basename "$0") [--env-file FILE] enable USERNAME
  $(basename "$0") [--env-file FILE] disable USERNAME
  $(basename "$0") [--env-file FILE] delete USERNAME
  $(basename "$0") [--env-file FILE] setup-ui-client
  $(basename "$0") [--env-file FILE] list
USAGE
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

rand_password() {
  tr -dc 'A-Za-z0-9!@#%^*_-+=' </dev/urandom | head -c 18
  printf '\n'
}

load_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Environment file not found: $ENV_FILE" >&2
    echo "Run the bootstrap script first, or set ENV_FILE=/path/to/env." >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  : "${BASE_DIR:=$HOME/platform-demo}"
  : "${KEYCLOAK_CONTAINER:?missing in env file}"
  : "${KC_REALM:?missing in env file}"
  : "${KC_ADMIN_USER:?missing in env file}"
  : "${KC_ADMIN_PASSWORD:?missing in env file}"
  : "${KC_GROUP:?missing in env file}"
  : "${MINIO_POLICY_NAME:?missing in env file}"
  : "${HOST_IP:=127.0.0.1}"
  : "${AISSISTAINT_UI_CLIENT_ID:=aissistaint-ui}"
  : "${AISSISTAINT_UI_DEV_PORT:=5173}"
  : "${PUBLIC_APP_URL:=https://aissistaint.localhost:8443}"
  : "${PUBLIC_KEYCLOAK_URL:=https://keycloak.aissistaint.localhost:8443}"
  : "${PASSWORD_OUT_FILE:=$BASE_DIR/keycloak-user-passwords.out}"
}

kc_login_and_exec() {
  local script="$1"
  shift || true
  podman exec -i \
    -e KC_REALM="$KC_REALM" \
    -e KC_ADMIN_USER="$KC_ADMIN_USER" \
    -e KC_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
    -e KC_GROUP="$KC_GROUP" \
    -e MINIO_POLICY_NAME="$MINIO_POLICY_NAME" \
    "$@" \
    "$KEYCLOAK_CONTAINER" bash -s <<EOF2
set -euo pipefail
export PATH=/opt/keycloak/bin:\$PATH
kcadm.sh config credentials --server http://127.0.0.1:8080 --realm master --user "\$KC_ADMIN_USER" --password "\$KC_ADMIN_PASSWORD" >/dev/null
$script
EOF2
}

# Helper to run code in the container with extra environment variables.
kc_exec_with_env() {
  local script="$1"
  shift || true
  podman exec -i \
    -e KC_REALM="$KC_REALM" \
    -e KC_ADMIN_USER="$KC_ADMIN_USER" \
    -e KC_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
    -e KC_GROUP="$KC_GROUP" \
    -e MINIO_POLICY_NAME="$MINIO_POLICY_NAME" \
    "$@" \
    "$KEYCLOAK_CONTAINER" bash -s <<'EOF2'
set -euo pipefail
export PATH=/opt/keycloak/bin:$PATH
kcadm.sh config credentials --server http://127.0.0.1:8080 --realm master --user "$KC_ADMIN_USER" --password "$KC_ADMIN_PASSWORD" >/dev/null

user_id() {
  kcadm.sh get users -r "$KC_REALM" -q "username=$1" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
}

group_id() {
  local gid=""
  local current_id=""
  local current_name=""
  while IFS= read -r line; do
    case "$line" in
      *'"id"'*)
        current_id="$(printf '%s\n' "$line" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
        ;;
      *'"name"'*)
        current_name="$(printf '%s\n' "$line" | sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
        if [[ "$current_name" == "$KC_GROUP" ]]; then
          gid="$current_id"
          break
        fi
        ;;
    esac
  done < <(kcadm.sh get groups -r "$KC_REALM")
  printf '%s\n' "$gid"
}

${KC_SCRIPT}
EOF2
}

add_user() {
  local username="$1"
  local password="$TEMP_PASSWORD"
  local generated_password=0
  if [[ -z "$password" ]]; then
    password="$(rand_password)"
    generated_password=1
  fi

  KC_SCRIPT='USER_ID="$(user_id "$USERNAME")"
if [[ -z "$USER_ID" ]]; then
  create_args=(create users -r "$KC_REALM" -s "username=$USERNAME" -s "enabled=true")
  [[ -n "${EMAIL:-}" ]] && create_args+=(-s "email=$EMAIL")
  [[ -n "${FIRST_NAME:-}" ]] && create_args+=(-s "firstName=$FIRST_NAME")
  [[ -n "${LAST_NAME:-}" ]] && create_args+=(-s "lastName=$LAST_NAME")
  kcadm.sh "${create_args[@]}" >/dev/null
  USER_ID="$(user_id "$USERNAME")"
fi
[[ -n "$USER_ID" ]] || { echo "Failed to resolve user id for $USERNAME" >&2; exit 1; }
GROUP_ID="$(group_id)"
kcadm.sh set-password -r "$KC_REALM" --username "$USERNAME" --new-password "$PASSWORD" --temporary="$TEMPORARY" >/dev/null
if [[ "$TEMPORARY" == "true" ]]; then
  kcadm.sh update "users/$USER_ID" -r "$KC_REALM" -s "requiredActions=[\"UPDATE_PASSWORD\"]" >/dev/null
else
  kcadm.sh update "users/$USER_ID" -r "$KC_REALM" -s "requiredActions=[]" >/dev/null
fi
if [[ -n "$GROUP_ID" ]]; then
  kcadm.sh update "users/$USER_ID/groups/$GROUP_ID" -r "$KC_REALM" >/dev/null 2>&1 || true
fi'

  podman exec -i \
    -e KC_REALM="$KC_REALM" \
    -e KC_ADMIN_USER="$KC_ADMIN_USER" \
    -e KC_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
    -e KC_GROUP="$KC_GROUP" \
    -e MINIO_POLICY_NAME="$MINIO_POLICY_NAME" \
    -e USERNAME="$username" \
    -e PASSWORD="$password" \
    -e TEMPORARY="$TEMPORARY" \
    -e EMAIL="${EMAIL:-}" \
    -e FIRST_NAME="${FIRST_NAME:-}" \
    -e LAST_NAME="${LAST_NAME:-}" \
    -e KC_SCRIPT="$KC_SCRIPT" \
    "$KEYCLOAK_CONTAINER" bash -s <<'EOF2'
set -euo pipefail
export PATH=/opt/keycloak/bin:$PATH
kcadm.sh config credentials --server http://127.0.0.1:8080 --realm master --user "$KC_ADMIN_USER" --password "$KC_ADMIN_PASSWORD" >/dev/null
user_id() {
  kcadm.sh get users -r "$KC_REALM" -q "username=$1" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1
}
group_id() {
  local gid=""
  local current_id=""
  local current_name=""
  while IFS= read -r line; do
    case "$line" in
      *'"id"'*) current_id="$(printf '%s\n' "$line" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')" ;;
      *'"name"'*)
        current_name="$(printf '%s\n' "$line" | sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
        if [[ "$current_name" == "$KC_GROUP" ]]; then
          gid="$current_id"
          break
        fi
        ;;
    esac
  done < <(kcadm.sh get groups -r "$KC_REALM")
  printf '%s\n' "$gid"
}
eval "$KC_SCRIPT"
EOF2

  local password_line
  if [[ "$PRINT_PASSWORD" == "1" ]]; then
    password_line="  temporary password: $password"
  elif [[ "$generated_password" == "1" ]]; then
    mkdir -p "$(dirname "$PASSWORD_OUT_FILE")"
    {
      printf 'created_at=%s username=%s temporary=%s password=%s\n' "$(date -Is)" "$username" "$TEMPORARY" "$password"
    } >> "$PASSWORD_OUT_FILE"
    chmod 600 "$PASSWORD_OUT_FILE"
    password_line="  temporary password: written to $PASSWORD_OUT_FILE"
  else
    password_line="  temporary password: provided via --password"
  fi

  cat <<OUT
User created or updated.
  username: $username
$password_line
  temporary flag: $TEMPORARY
  realm: $KC_REALM
  account page: $PUBLIC_KEYCLOAK_URL/realms/$KC_REALM/account
  app login: $PUBLIC_APP_URL/login
OUT
}

setup_ui_client() {
  podman exec -i \
    -e KC_REALM="$KC_REALM" \
    -e KC_ADMIN_USER="$KC_ADMIN_USER" \
    -e KC_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
    -e AISSISTAINT_UI_CLIENT_ID="$AISSISTAINT_UI_CLIENT_ID" \
    -e AISSISTAINT_UI_DEV_PORT="$AISSISTAINT_UI_DEV_PORT" \
    -e HOST_IP="$HOST_IP" \
    -e PUBLIC_APP_URL="$PUBLIC_APP_URL" \
    "$KEYCLOAK_CONTAINER" bash -s <<'EOF2'
set -euo pipefail
export PATH=/opt/keycloak/bin:$PATH
kcadm.sh config credentials --server http://127.0.0.1:8080 --realm master --user "$KC_ADMIN_USER" --password "$KC_ADMIN_PASSWORD" >/dev/null

cat >/tmp/aissistaint-ui-client.json <<JSON
{
  "clientId": "$AISSISTAINT_UI_CLIENT_ID",
  "name": "AISSIStaint React UI",
  "description": "Public PKCE client for the Vite React front-end",
  "enabled": true,
  "protocol": "openid-connect",
  "publicClient": true,
  "standardFlowEnabled": true,
  "implicitFlowEnabled": false,
  "directAccessGrantsEnabled": false,
  "serviceAccountsEnabled": false,
  "frontchannelLogout": true,
  "attributes": {
    "pkce.code.challenge.method": "S256",
    "post.logout.redirect.uris": "$PUBLIC_APP_URL/*##http://localhost:$AISSISTAINT_UI_DEV_PORT/*##http://127.0.0.1:$AISSISTAINT_UI_DEV_PORT/*##http://$HOST_IP:$AISSISTAINT_UI_DEV_PORT/*"
  },
  "redirectUris": [
    "$PUBLIC_APP_URL/*",
    "http://localhost:$AISSISTAINT_UI_DEV_PORT/*",
    "http://127.0.0.1:$AISSISTAINT_UI_DEV_PORT/*",
    "http://$HOST_IP:$AISSISTAINT_UI_DEV_PORT/*"
  ],
  "webOrigins": [
    "$PUBLIC_APP_URL",
    "http://localhost:$AISSISTAINT_UI_DEV_PORT",
    "http://127.0.0.1:$AISSISTAINT_UI_DEV_PORT",
    "http://$HOST_IP:$AISSISTAINT_UI_DEV_PORT"
  ]
}
JSON

CLIENT_UUID="$(kcadm.sh get clients -r "$KC_REALM" -q clientId="$AISSISTAINT_UI_CLIENT_ID" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
if [[ -n "$CLIENT_UUID" ]]; then
  kcadm.sh update "clients/$CLIENT_UUID" -r "$KC_REALM" -f /tmp/aissistaint-ui-client.json >/dev/null
else
  kcadm.sh create clients -r "$KC_REALM" -f /tmp/aissistaint-ui-client.json >/dev/null
fi
EOF2

  cat <<OUT
AISSIStaint UI Keycloak client configured.
  client id: $AISSISTAINT_UI_CLIENT_ID
  realm: $KC_REALM
  valid app origins:
    $PUBLIC_APP_URL
    http://localhost:$AISSISTAINT_UI_DEV_PORT
    http://127.0.0.1:$AISSISTAINT_UI_DEV_PORT
    http://$HOST_IP:$AISSISTAINT_UI_DEV_PORT
OUT
}

reset_password() {
  local username="$1"
  local password="$TEMP_PASSWORD"
  if [[ -z "$password" ]]; then
    echo "reset-password requires --password" >&2
    exit 1
  fi

  podman exec -i \
    -e KC_REALM="$KC_REALM" \
    -e KC_ADMIN_USER="$KC_ADMIN_USER" \
    -e KC_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
    -e USERNAME="$username" \
    -e PASSWORD="$password" \
    -e TEMPORARY="$TEMPORARY" \
    "$KEYCLOAK_CONTAINER" bash -s <<'EOF2'
set -euo pipefail
export PATH=/opt/keycloak/bin:$PATH
kcadm.sh config credentials --server http://127.0.0.1:8080 --realm master --user "$KC_ADMIN_USER" --password "$KC_ADMIN_PASSWORD" >/dev/null
USER_ID="$(kcadm.sh get users -r "$KC_REALM" -q "username=$USERNAME" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
[[ -n "$USER_ID" ]] || { echo "User not found: $USERNAME" >&2; exit 1; }
kcadm.sh set-password -r "$KC_REALM" --username "$USERNAME" --new-password "$PASSWORD" --temporary="$TEMPORARY" >/dev/null
if [[ "$TEMPORARY" == "true" ]]; then
  kcadm.sh update "users/$USER_ID" -r "$KC_REALM" -s 'requiredActions=["UPDATE_PASSWORD"]' >/dev/null
else
  kcadm.sh update "users/$USER_ID" -r "$KC_REALM" -s 'requiredActions=[]' >/dev/null
fi
EOF2

  echo "Password updated for $username (temporary=$TEMPORARY)."
}

enable_user() {
  local username="$1"
  podman exec -i \
    -e KC_REALM="$KC_REALM" \
    -e KC_ADMIN_USER="$KC_ADMIN_USER" \
    -e KC_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
    -e USERNAME="$username" \
    "$KEYCLOAK_CONTAINER" bash -s <<'EOF2'
set -euo pipefail
export PATH=/opt/keycloak/bin:$PATH
kcadm.sh config credentials --server http://127.0.0.1:8080 --realm master --user "$KC_ADMIN_USER" --password "$KC_ADMIN_PASSWORD" >/dev/null
USER_ID="$(kcadm.sh get users -r "$KC_REALM" -q "username=$USERNAME" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
[[ -n "$USER_ID" ]] || { echo "User not found: $USERNAME" >&2; exit 1; }
kcadm.sh update "users/$USER_ID" -r "$KC_REALM" -s enabled=true >/dev/null
EOF2
  echo "Enabled $username."
}

disable_user() {
  local username="$1"
  podman exec -i \
    -e KC_REALM="$KC_REALM" \
    -e KC_ADMIN_USER="$KC_ADMIN_USER" \
    -e KC_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
    -e USERNAME="$username" \
    "$KEYCLOAK_CONTAINER" bash -s <<'EOF2'
set -euo pipefail
export PATH=/opt/keycloak/bin:$PATH
kcadm.sh config credentials --server http://127.0.0.1:8080 --realm master --user "$KC_ADMIN_USER" --password "$KC_ADMIN_PASSWORD" >/dev/null
USER_ID="$(kcadm.sh get users -r "$KC_REALM" -q "username=$USERNAME" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
[[ -n "$USER_ID" ]] || { echo "User not found: $USERNAME" >&2; exit 1; }
kcadm.sh update "users/$USER_ID" -r "$KC_REALM" -s enabled=false >/dev/null
EOF2
  echo "Disabled $username."
}

delete_user() {
  local username="$1"
  podman exec -i \
    -e KC_REALM="$KC_REALM" \
    -e KC_ADMIN_USER="$KC_ADMIN_USER" \
    -e KC_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
    -e USERNAME="$username" \
    "$KEYCLOAK_CONTAINER" bash -s <<'EOF2'
set -euo pipefail
export PATH=/opt/keycloak/bin:$PATH
kcadm.sh config credentials --server http://127.0.0.1:8080 --realm master --user "$KC_ADMIN_USER" --password "$KC_ADMIN_PASSWORD" >/dev/null
USER_ID="$(kcadm.sh get users -r "$KC_REALM" -q "username=$USERNAME" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
[[ -n "$USER_ID" ]] || { echo "User not found: $USERNAME" >&2; exit 1; }
kcadm.sh delete "users/$USER_ID" -r "$KC_REALM" >/dev/null
EOF2
  echo "Deleted $username."
}

list_users() {
  podman exec -i \
    -e KC_REALM="$KC_REALM" \
    -e KC_ADMIN_USER="$KC_ADMIN_USER" \
    -e KC_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
    "$KEYCLOAK_CONTAINER" bash -s <<'EOF2'
set -euo pipefail
export PATH=/opt/keycloak/bin:$PATH
kcadm.sh config credentials --server http://127.0.0.1:8080 --realm master --user "$KC_ADMIN_USER" --password "$KC_ADMIN_PASSWORD" >/dev/null
kcadm.sh get users -r "$KC_REALM" --fields username,email,enabled | sed 's/},{/},\n{/g'
EOF2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    add|reset-password|enable|disable|delete|setup-ui-client|list)
      CMD="$1"
      shift
      break
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$CMD" ]]; then
  usage
  exit 1
fi

if [[ "$CMD" != "list" && "$CMD" != "setup-ui-client" ]]; then
  USERNAME="${1:-}"
  if [[ -z "$USERNAME" ]]; then
    usage
    exit 1
  fi
  shift || true
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --password)
      TEMP_PASSWORD="$2"
      shift 2
      ;;
    --email)
      EMAIL="$2"
      shift 2
      ;;
    --first)
      FIRST_NAME="$2"
      shift 2
      ;;
    --last)
      LAST_NAME="$2"
      shift 2
      ;;
    --temporary)
      TEMPORARY="$2"
      shift 2
      ;;
    --print-password)
      PRINT_PASSWORD=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  echo "Do not run this script with sudo/root. Use rootless Podman as your normal user." >&2
  exit 1
fi

require_cmd podman
load_env

case "$CMD" in
  add)
    add_user "$USERNAME"
    ;;
  reset-password)
    reset_password "$USERNAME"
    ;;
  enable)
    enable_user "$USERNAME"
    ;;
  disable)
    disable_user "$USERNAME"
    ;;
  delete)
    delete_user "$USERNAME"
    ;;
  setup-ui-client)
    setup_ui_client
    ;;
  list)
    list_users
    ;;
  *)
    usage
    exit 1
    ;;
esac
