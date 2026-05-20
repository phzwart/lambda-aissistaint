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
3. Configure provider endpoints and models for `LLM_A`, `LLM_B`, and `LLM_C`; at least one must be complete before saving.
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

## Headless Goose Chatbot

The API exposes a headless chatbot route at `POST /api/goose/chat`. Browser or embedding clients send authenticated message history, and the backend routes it through managed Goose when available, with direct LiteLLM endpoint routing as a fallback. Provider keys are not exposed to the client.

The bootstrapper also starts a managed Goose container when `MANAGE_GOOSE=1`. The container uses the official Goose image, runs `goose serve`, and points Goose's OpenAI-compatible provider settings at the managed LiteLLM proxy. The backend prefers this Goose service when `GOOSE_CHATBOT_BACKEND=goose` and falls back to direct LiteLLM routing if Goose is unavailable.

Runtime controls:

- `MANAGE_GOOSE`
- `GOOSE_IMAGE`
- `GOOSE_PORT`
- `INTERNAL_GOOSE_URL`
- `GOOSE_PROVIDER`
- `GOOSE_MODEL`
- `GOOSE_WORKING_DIR`
- `GOOSE_WORKSPACE_DIR`
- `GOOSE_CHATBOT_BACKEND`
- `GOOSE_CHATBOT_DEFAULT_TIER`
- `GOOSE_CHATBOT_MAX_MESSAGES`
- `GOOSE_CHATBOT_MAX_TOKENS`
- `GOOSE_CHATBOT_TEMPERATURE`
- `GOOSE_CHATBOT_SYSTEM_PROMPT`

The route audits `goose_chatbot.message` with endpoint and message counts only. Prompt bodies, responses, bearer tokens, and provider keys must stay out of logs.

When `POST /api/goose/chat` is called with `plannerMode: true` and a `projectId`, the API materializes planner-visible skills into the project Goose workspace before starting the Goose session. Generated files are written under `.agents/skills/<skillId>/SKILL.md` and `.aissistaint/skill-catalog.json` inside `/workspace/projects/<projectId>`. Goose sees these as read-only reasoning inputs and must return a JSON execution payload; it must not execute skills. Skill changes do not require a Goose server restart, but the API starts a fresh planner session so discovery runs against the updated project workspace.

## Skill Setup

The Preferences / Setup page includes a Skill Setup tab for building a reusable, per-user skill library and enabling skills per project. Skills are authored with structured headings such as purpose, when to use, inputs, procedure, expected output, safety constraints, and required tools. Those fields automatically render into a portable skill directory with a Cursor/Anthropic-style `SKILL.md` file containing YAML frontmatter (`name`, `description`, and `disable-model-invocation`) plus the skill instructions.

Executable support is declarative in this first pass. A skill can have no executor, use an approved container from the backend catalog, or define a validated custom container with image, command, args, working directory, timeout, network policy, and environment allowlist. The browser never runs executables directly, and skill definitions must not contain raw secrets.

The package can also provide read-only repository skills from `agent-repo/`. Set `AGENT_REPO_DIRECTORIES` to a comma-separated list of repository directories, or leave it blank to load `./agent-repo` when present. Each repository has a `repo.json` manifest, optional `skills/` entries, and `templates/` users can copy when authoring their own skills. Repository skills can be enabled per project or duplicated into the user's editable library.

The packaged `paper-reader-summary` skill has a buildable PaperQA2 runner image. Build it with `podman_services/build_paperqa2_runner.sh`. At execution time the host supplies the selected LiteLLM aliases as CLI args, for example `--llm-model LLM_A --summary-llm-model LLM_A`, and injects only `PAPERQA_LITELLM_URL` plus a LiteLLM API key into the container.

Agent skill records and project enablement are stored through the backend/OpenBao flow under the user's `app-tokens` namespace. Relevant actions emit non-secret audit events (`agent_skill.save`, `agent_skill.delete`, `agent_skill.enable`, `agent_repo.read`, and `agent_executor.catalog_read`).

## Planner Setup

The Preferences / Setup page also includes a Planner Setup tab. Planner definitions are read-only repository specs under `agent-repo/planners/`, while users save global defaults plus optional per-project overrides. The current packaged spec is `goose-task-planner`, which binds planner roles such as `planner`, `worker`, and `summarizer` to configured LiteLLM aliases like `LLM_A`, `LLM_B`, and `LLM_C`.

Leave `PLANNER_REPO_DIRECTORIES` blank to load planners from `./agent-repo`, or set it to a comma-separated list of repository directories. Goose provider keys are not written to planner specs or UI config; settings that require `GOOSE_PROVIDER`, `GOOSE_MODEL`, or similar env/config changes are reported as restart-required so the running managed Goose service is not silently mutated.

Planner mode applies Skill Setup visibility policy before exposing skills to Goose. The planner output is parsed as JSON and checked against the visible skill catalog before it can be handed to a future execution broker.

## Persistent Wiki

The Wiki page in the app maintains a per-project, Markdown-based memory layer inspired by Karpathy's persistent LLM wiki concept. Pages live as plain `.md` files inside the existing per-project MinIO bucket under the `wiki/` prefix, with rebuildable JSON sidecars (`backlinks.json`, `provenance.json`, `ingest_log.json`) under `metadata/`. The wiki augments rather than replaces the existing document store and Q&A flow.

Pages are organized into a small enumerated set of categories — `entities`, `concepts`, `projects`, `protocols`, `datasets`, `people` — and cross-link with `[[Wiki Link]]` syntax. Frontmatter (`title`, `slug`, `category`, `sources`, `related`, `confidence`, `updated`, `verified_at`) is human-readable; everything else is normal Markdown.

The ingest endpoint compiles a source document into an additive section under a managed marker (`<!-- aissistaint:section start=... -->`), so re-ingesting the same source replaces just that section and leaves any hand-edited prose between markers intact. When the configured LiteLLM tier (`WIKI_LLM_TIER`, default `a`) is unavailable, ingest falls back to a deterministic heuristic extractor so the wiki layer remains inspectable without an LLM. The query endpoint ranks pages by token overlap and asks the LLM to answer only from those pages, citing page titles.

Wiki routes are mounted under each project's authenticated namespace:

- `GET    /api/projects/:id/wiki/pages`
- `GET    /api/projects/:id/wiki/pages/:category/:slug`
- `PUT    /api/projects/:id/wiki/pages/:category/:slug`
- `DELETE /api/projects/:id/wiki/pages/:category/:slug`
- `POST   /api/projects/:id/wiki/ingest`
- `POST   /api/projects/:id/wiki/query`
- `GET    /api/projects/:id/wiki/backlinks`

All wiki routes reuse the existing Keycloak/OpenBao/MinIO/LiteLLM plumbing — no additional services or schemas are introduced. New audit events (`wiki.list`, `wiki.read`, `wiki.write`, `wiki.delete`, `wiki.ingest`, `wiki.query`) follow the same non-secret schema documented in `docs/ai-governance/AUDIT_EVENTS.md`.

File Management **Process** runs the packaged PaperQA2 container (`podman_services/build_paperqa2_runner.sh`), streams `process.log` into the project's parsing prefix (`PROJECT_PARSED_PREFIX`, default `parsed/<file-stem>/`), then writes `extracted.txt` and `summary.md` beside it in the same folder, and (by default) ingests the summary into the wiki. Configure `PAPERQA_LITELLM_URL`, `LITELLM_API_KEY`, and a working `LLM_A` alias before processing. Defaults: `PAPERQA_LITELLM_TIMEOUT_S=900` (per LLM call) and a runner timeout of at least 45 minutes. If the upstream proxy (e.g. CBorg behind Cloudflare) enforces a 120s read timeout, raise that limit or LLM steps will fail with HTTP 524 regardless of these settings; rebuild the PaperQA image after changing runner Python, then run `npm run test:paperqa:container` to smoke-test the image. For a full pipeline check without external LLMs, run `npm run mock-llm` in one terminal and `npm run test:paperqa:e2e` in another (uses `server/mockLlmServer.mjs`). Set `PAPERQA_PROCESS_INGEST_WIKI=false` to skip wiki ingest.

## User Flow

Users should:

1. Open the app URL printed by the bootstrapper.
2. Sign in with the temporary Keycloak password.
3. Change the password when prompted.
4. Use Preferences only if they are responsible for provider configuration.
5. Use project workflows for file loading, knowledge review, and Q&A after an admin has configured at least one working `LLM_A`, `LLM_B`, or `LLM_C` endpoint.

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
