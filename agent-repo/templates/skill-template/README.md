# Template Skill

Copy this directory into `agent-repo/skills/<your-skill-id>/` to create a repository skill, then update `skill.json` and `SKILL.md`.

Use `executor.mode: "none"` for instruction-only skills. Use `executor.mode: "catalog"` only when the skill references an approved executor id returned by the backend executor catalog.

Do not store secrets in skill manifests, instructions, support files, command arguments, or environment defaults.
