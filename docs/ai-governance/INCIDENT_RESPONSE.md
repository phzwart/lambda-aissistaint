# AI Incident Response Playbook

Use this playbook for suspected provider-key leakage, unsafe model behavior, unauthorized project deletion, LiteLLM broker misuse, or compromise of the local AI stack.

## Detect

- Review API logs for audit events related to `llm_config`, `litellm_secret`, `project`, `auth`, and `secret_store`.
- Review LiteLLM admin broker logs for denied authorization, alias validation failures, and unusual model-admin activity.
- Check Keycloak for unexpected users, roles, client changes, and token activity.
- Check OpenBao for unexpected reads/writes under the configured `OPENBAO_KV_MOUNT` and `OPENBAO_RW_PREFIX`.
- Check MinIO for unexpected project bucket access, deletion, or policy changes.

## Contain

- Disable or remove suspicious users with `podman_services/keycloak_user_admin.sh`.
- Temporarily stop the API and LiteLLM admin broker if provider-key exposure or model-admin misuse is suspected.
- Rotate `LITELLM_ADMIN_BROKER_TOKEN`, `LITELLM_SECRET_BROKER_TOKEN`, `LITELLM_ADMIN_KEY`, and affected provider API keys.
- Restrict or remove risky provider endpoints by tightening `LLM_ALLOWED_HOSTS` and clearing affected LLM config secrets.
- For project-data incidents, restrict affected MinIO buckets and preserve metadata before cleanup.

## Eradicate

- Re-run `podman_services/podman_infra_bootstrap.sh` only after preserving needed forensic state and confirming desired env values.
- Rotate OpenBao app tokens and encryption key material if secret-store compromise is suspected.
- Remove malicious or unexpected LiteLLM model aliases.
- Patch the code or env policy that allowed the incident before restoring normal service.

## Recover

- Restart services with known-good runtime and secret env files.
- Reconfigure provider models through the Preferences UI after key rotation.
- Validate Keycloak login, LLM config save/test, project listing, and MinIO project access.
- Confirm audit events show normal operation and no continued denied attempts.

## Post-Incident

- Write a timeline with detection time, containment time, root cause, affected users/projects, and data classes.
- Update `docs/ai-governance/RISK_REGISTER.md` with the incident and any accepted residual risk.
- Add or update tests for the failed control.
- Review whether `.env.example`, bootstrap defaults, or operational docs need changes.
