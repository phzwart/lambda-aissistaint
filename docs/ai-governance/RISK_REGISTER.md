# AI Risk Register

This register seeds the practical AI security risks for AIssistAInt. Update it when controls change, incidents occur, or new model/provider workflows are introduced.

| ID | Risk | Likelihood | Impact | Current mitigation | Next review |
| --- | --- | --- | --- | --- | --- |
| AI-R1 | LLM endpoint SSRF or private-network access through user-supplied provider URLs | Medium | High | `LLM_ALLOWED_HOSTS`, HTTPS enforcement, and private-address blocking in server policy | Add endpoint-policy tests and review allowlist before deploy |
| AI-R2 | Provider API key exposure in browser, logs, or runtime env files | Medium | High | Provider keys are encrypted with AES-GCM and stored through OpenBao; `.env.example` warns against repo env storage | Verify audit events never include raw tokens or request bodies |
| AI-R3 | OIDC token accepted for the wrong client or issuer | Low | High | `requireAuth` verifies issuer and client `azp`/`aud` | Include auth denial events in audit monitoring |
| AI-R4 | LiteLLM admin key compromise | Low | High | Admin key is isolated in the admin broker secret env file; API uses a separate broker token | Rotate broker/admin tokens after suspicious model-admin activity |
| AI-R5 | LiteLLM secret alias misuse | Medium | High | Alias namespace is constrained to fixed `LLM_A`, `LLM_B`, and `LLM_C` endpoints and secret refs must match aliases | Add broker-policy tests and audit denied alias requests |
| AI-R6 | Prompt injection or unsafe model output in research workflows | Medium | Medium | No automated guardrail/eval suite yet | Add prompt-injection and data-exfiltration evaluation cases |
| AI-R7 | Project deletion or bucket lockdown performed by an unauthorized actor | Low | High | Delete endpoint requires admin or removal-agent role; removal credentials are split into separate env file | Audit project deletion with actor and project id |
| AI-R8 | Sensitive research data retained longer than intended in MinIO, Postgres, or logs | Medium | High | Project buckets are scoped by generated names and prefixes | Define retention policy and backup/restore expectations |
| AI-R9 | Dependency or container supply-chain drift | Medium | Medium | `package-lock.json` pins npm transitive versions | Add SBOM/vulnerability scan and pin container image digests where practical |
| AI-R10 | Operational drift between `.env.example`, generated env files, and running services | Medium | Medium | Bootstrap writes split runtime/secret env files from a single script | Review env contract during each release and after bootstrap changes |
| AI-R11 | Goose container bypasses app authorization or exposes agent capabilities directly | Low | High | Goose binds to loopback by default, sits behind the API, and uses a generated `GOOSE_SECRET_KEY` | Validate no public gateway route exposes Goose directly |

## Review Cadence

- Review this file before production deployment and after any incident.
- Record newly accepted risks here rather than relying on chat history or local notes.
- Link mitigation work to concrete code, env, or script paths where possible.
