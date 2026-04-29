# Component Interactions

This graph highlights the main AIssistAInt components, their trust boundaries, and the data or secret flows between them.

```mermaid
flowchart TD
  user["User or Admin Browser"]
  caddy["Caddy TLS Gateway"]
  ui["Vite React UI"]
  api["Node API\nserver/index.mjs"]
  adminBroker["LiteLLM Admin Broker\nserver/litellm-admin-broker.mjs"]
  secretBroker["LiteLLM Secret Broker\n/internal/litellm/secrets/:modelAlias"]
  keycloak["Keycloak\nOIDC, roles, groups"]
  keycloakDb["Keycloak Postgres"]
  appDb["App Postgres\nprojects, membership"]
  minio["MinIO\nproject buckets and metadata"]
  openbao["OpenBao\nencrypted provider records"]
  litellm["LiteLLM Proxy\nmodel routing"]
  provider["External LLM Provider\nallowed HTTPS host"]
  runtimeEnv["Generated Runtime Env\nrouting and file pointers"]
  secretFiles["Split Secret Env Files\n0600 local secrets"]
  bootstrap["Podman Bootstrapper\npodman_infra_bootstrap.sh"]
  adminHelper["Keycloak User Admin Helper\nkeycloak_user_admin.sh"]

  user -->|"HTTPS app access"| caddy
  caddy -->|"UI requests"| ui
  ui -->|"Bearer token API calls"| api
  ui -->|"OIDC login redirect"| keycloak
  keycloak -->|"stores realm state"| keycloakDb

  api -->|"verify issuer, azp, aud"| keycloak
  api -->|"project metadata and membership"| appDb
  api -->|"project objects and metadata files"| minio
  api -->|"encrypted provider config and aliases"| openbao
  api -->|"configure model alias, broker token"| adminBroker

  adminBroker -->|"LiteLLM admin key stays here"| litellm
  litellm -->|"aissistaint alias secret lookup"| secretBroker
  secretBroker -->|"read and decrypt provider key"| openbao
  litellm -->|"chat completions via configured alias"| provider
  api -->|"runtime chat/test requests"| litellm

  bootstrap -->|"creates and configures"| caddy
  bootstrap -->|"creates and configures"| keycloak
  bootstrap -->|"creates and configures"| openbao
  bootstrap -->|"creates and configures"| minio
  bootstrap -->|"creates and configures"| litellm
  bootstrap -->|"writes"| runtimeEnv
  bootstrap -->|"writes"| secretFiles

  runtimeEnv -->|"PLATFORM_ENV_FILE"| api
  runtimeEnv -->|"PLATFORM_ENV_FILE"| adminBroker
  secretFiles -->|"API and broker secrets"| api
  secretFiles -->|"admin key and broker token"| adminBroker
  secretFiles -->|"secret broker token"| litellm

  adminHelper -->|"add, list, disable, reset users"| keycloak

  classDef ui fill:#d9f7d9,stroke:#2f8f2f,color:#102a10
  classDef permanent fill:#ffe4bd,stroke:#b36b00,color:#332000
  classDef security fill:#dbeafe,stroke:#2563eb,color:#102040

  class user,ui ui
  class caddy,api,keycloakDb,appDb,minio,litellm,provider,runtimeEnv,bootstrap permanent
  class keycloak,openbao,adminBroker,secretBroker,secretFiles,adminHelper security
```

Color guide:

- Green: user-facing UI and browser entry points.
- Orange: long-running or persistent runtime components.
- Blue: identity, secret, broker, and administrative security controls.

## Key Interaction Notes

- Browser-to-API calls use Keycloak bearer tokens; the API verifies issuer and client audience/azp before processing protected routes.
- Provider API keys are write-only from the UI perspective. The API encrypts them and stores encrypted records in OpenBao.
- The API does not hold the LiteLLM admin key directly. It asks the LiteLLM admin broker to configure model aliases with a dedicated broker token.
- LiteLLM receives `aissistaint://` secret references. It resolves them through the API secret broker, which validates aliases and decrypts provider keys from OpenBao.
- External LLM provider access is constrained by the configured endpoint policy: HTTPS by default, host allowlist, and private-address blocking unless explicit dev flags are enabled.
- The bootstrapper owns local service wiring and writes runtime env pointers separately from high-sensitivity secret env files.

## Primary Trust Boundaries

- Browser and public HTTPS gateway
- API and internal service network
- API and OpenBao secret store
- API and LiteLLM admin broker
- LiteLLM and API secret broker
- Local generated runtime env files and local secret env files
