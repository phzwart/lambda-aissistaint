# AI System Inventory

This inventory describes the AIssistAInt components that process prompts, provider configuration, project data, and operational secrets. It is the starting point for NIST AI RMF Map/Govern reviews and should be updated when services, providers, or data flows change.

## Components

| Component | Role | Data classes | Identity and access | Storage | Secrets | Deploy artifact |
| --- | --- | --- | --- | --- | --- | --- |
| Browser UI | Collects project workflow input, LLM provider settings, and test prompts | Prompt text, project metadata, transient provider keys during save | Keycloak OIDC public client | Browser memory; mock mode may use localStorage | Does not receive stored provider keys from API | Vite dev server behind Caddy |
| Node API | Enforces auth, project APIs, LLM config APIs, secret broker endpoint | Project metadata, prompt text, model aliases, encrypted token records | Verifies Keycloak issuer and client audience/azp | Postgres, MinIO, OpenBao | API runtime secret file, OpenBao app token, LiteLLM broker tokens | `server/index.mjs` |
| LiteLLM admin broker | Isolates LiteLLM admin key from the main API | Model alias, provider endpoint, provider model, secret reference | Bearer token from API secret env | LiteLLM model registry | LiteLLM admin key, admin broker token | `server/litellm-admin-broker.mjs` |
| LiteLLM secret broker | Lets LiteLLM resolve `aissistaint://` provider keys through the API | Model alias and decrypted provider key response | Dedicated bearer token from LiteLLM | OpenBao read via API | LiteLLM secret broker token, encryption key file | `/internal/litellm/secrets/:modelAlias` in `server/index.mjs` |
| Goose headless server | Runs the managed chatbot/agent service behind the API | Chatbot message history, Goose session metadata | API-held Goose secret key; provider calls use LiteLLM runtime key | Goose config and workspace directories | Goose secret key, LiteLLM runtime chat key | `${STACK_NAME}-goose` |
| Keycloak | Issues user tokens and roles | User identity, roles, groups | Admin user and realm clients | Keycloak Postgres | Keycloak admin password, client secrets | `${STACK_NAME}-keycloak` |
| OpenBao | Stores scoped app tokens and encrypted provider key records | Encrypted provider tokens, alias records, app token material | OpenBao policies and app token | Raft storage | OpenBao root/unseal/app tokens | `${STACK_NAME}-openbao` |
| MinIO | Stores project buckets and metadata objects | Uploaded/loaded/parsed project data, project metadata | Scoped app and removal credentials | MinIO object storage | MinIO app/removal/root credentials | `${STACK_NAME}-minio` |
| App Postgres | Stores project metadata and membership | Project names, descriptions, membership, bucket pointers | API database credentials | Postgres data directory | App DB password | `${STACK_NAME}-app-postgres` |
| Caddy gateway | Local TLS and reverse proxy for browser-facing services | HTTP routing metadata | Local TLS trust | Caddy config/data | Local CA material | `${STACK_NAME}-gateway` |

## Trust Boundaries

- Browser to API: browser sends Keycloak bearer tokens through `src/services/apiClient.ts`; provider keys are write-only from the browser perspective.
- API to OpenBao: API uses `OPENBAO_APP_TOKEN` and never returns stored provider key values to the browser.
- API to LiteLLM admin broker: API uses `LITELLM_ADMIN_BROKER_TOKEN`; the broker alone holds the LiteLLM admin key.
- API to Goose: API uses `GOOSE_SECRET_KEY` and keeps Goose behind the internal service boundary.
- LiteLLM to API secret broker: LiteLLM uses `LITELLM_SECRET_BROKER_TOKEN` to resolve only validated `aissistaint://` aliases.
- API to external LLM providers: provider endpoints are constrained by `LLM_ALLOWED_HOSTS`, HTTPS policy, and private-address blocking unless explicit dev flags are enabled.

## Configuration Sources

- `.env.example` documents the runtime contract and safe defaults.
- `podman_services/podman_infra_bootstrap.sh` generates stack runtime env files and split secret files.
- `podman_services/keycloak_user_admin.sh` is the high-privilege operational helper for user and client administration.
