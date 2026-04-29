# AISSIStaint

Workflow-driven React and Node application for secure LLM setup, document processing, knowledge review, and grounded Q&A. The local stack uses Keycloak, OpenBao, MinIO, Postgres, LiteLLM, and a Caddy TLS gateway managed by Podman scripts.

## Stack

- Vite, React, TypeScript, React Router, Zustand
- Node/Express API and LiteLLM admin broker
- Keycloak for OIDC login and roles
- OpenBao for app/provider secret storage
- MinIO for project objects
- Postgres for project metadata
- LiteLLM for model routing
- Rootless Podman for local service orchestration

## Quick Start

Install dependencies:

```bash
npm install
```

Copy the sample env if you need local overrides:

```bash
cp .env.example .env.local
```

Bootstrap the local platform services:

```bash
podman_services/podman_infra_bootstrap.sh
```

At completion, the bootstrapper prints the generated URLs, env file paths, local CA path, and next-step commands. Review that output before starting the app.

Start the UI, API, and LiteLLM admin broker from the repo root:

```bash
PLATFORM_ENV_FILE="$HOME/platform-demo/platform-demo-runtime.env" npm run dev
```

If you changed `STACK_NAME` or `BASE_DIR`, use the runtime env printed by the bootstrapper instead of the default path.

## Configure Browser Trust

The bootstrapper creates a local Caddy CA. Import the printed CA root into your OS or browser trust store before using the HTTPS URLs:

```text
$HOME/platform-demo/caddy/data/caddy/pki/authorities/local/root.crt
```

Browsers may reject the app, Keycloak, MinIO, or OpenBao HTTPS URLs until this CA is trusted.

## Admin Setup

The bootstrap script creates the Keycloak realm, clients, OpenBao policies, MinIO policies, LiteLLM config, runtime env files, and split secret files. Admins should then create users with the Keycloak helper:

```bash
podman_services/keycloak_user_admin.sh --env-file "$HOME/platform-demo/platform-demo.env" add alice --email alice@example.org --print-password
```

List users:

```bash
podman_services/keycloak_user_admin.sh --env-file "$HOME/platform-demo/platform-demo.env" list
```

Reset a password:

```bash
podman_services/keycloak_user_admin.sh --env-file "$HOME/platform-demo/platform-demo.env" reset-password alice --password 'new-temporary-password' --temporary true
```

Use temporary passwords for new users and require first-login password changes. Generated passwords are written to the password output file printed by the bootstrapper.

## Configure LLM Providers

1. Sign in to the app at the `PUBLIC_APP_URL` printed by the bootstrapper.
2. Open Preferences.
3. Configure the provider endpoint and model for each LLM tier.
4. Enter provider API keys through the Preferences UI.
5. Use the connection test before relying on a provider.

Provider API keys should not be committed to repo env files. The app encrypts provider keys, stores encrypted records through OpenBao, and lets LiteLLM resolve them through the internal secret broker.

Before deploying or changing providers, review:

- `LLM_ALLOWED_HOSTS`
- `LLM_ALLOW_PRIVATE_ENDPOINTS`
- `LLM_ALLOW_HTTP_ENDPOINTS`
- `LLM_ALLOW_ANY_HOSTS`
- `LLM_DEV_MODE`

The default policy requires HTTPS, allows only configured hosts, and blocks private or loopback endpoint resolution.

## User Flow

Users should:

1. Open the app URL printed by the bootstrapper.
2. Sign in with the temporary Keycloak password.
3. Change the password when prompted.
4. Use Preferences only if they are responsible for provider configuration.
5. Use project workflows for file loading, knowledge review, and Q&A after an admin has configured working LLM tiers.

User account management is handled through Keycloak and `podman_services/keycloak_user_admin.sh`.

## Operations

Generated local files are written under `BASE_DIR`, which defaults to `$HOME/platform-demo`.

Important files include:

- Admin/bootstrap env: `$HOME/platform-demo/platform-demo.env`
- API runtime env: `$HOME/platform-demo/platform-demo-runtime.env`
- Secret env files: `$HOME/platform-demo/secrets/`
- Caddyfile and local CA: `$HOME/platform-demo/caddy/`
- OpenBao init material: `$HOME/platform-demo/openbao/`

Stop and remove managed containers with:

```bash
podman_services/rm.sh
```

Use `ROOTFUL_CLEANUP=1` only if containers were accidentally created with `sudo podman`.

## Development

Run all local dev processes:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Build:

```bash
npm run build
```

## Security & AI Governance

The AI governance docs in `docs/ai-governance/` describe the system inventory, risk register, incident response steps, and non-secret audit event schema. Treat `.env.example` as the runtime configuration contract and keep provider keys in the generated secret files/OpenBao flow rather than repo env files.
