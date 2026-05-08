# AIssistAInt Agent Repository

This directory is the package-provided home for reusable agent skills, planner specs, and authoring templates. The backend can load one or more repositories like this through `AGENT_REPO_DIRECTORIES`; planner specs can also be loaded from `PLANNER_REPO_DIRECTORIES`.

## Layout

```text
agent-repo/
  repo.json
  skills/
    my-skill/
      skill.json
      SKILL.md
      README.md
  planners/
    my-planner/
      planner.json
      system.md
      README.md
  templates/
    skill-template/
      skill.json
      SKILL.md
      README.md
```

`repo.json` describes the repository. `skills/` contains read-only skills that appear in Skill Setup. `planners/` contains read-only planner definitions that appear in Planner Setup. `templates/` contains examples users can copy when building their own skills.

## Skill Manifest

Each skill directory must contain `skill.json` and the `SKILL.md` entrypoint declared by that manifest.

Required fields:

- `id`: stable id using letters, numbers, `_`, or `-`.
- `name`: human-readable skill name.
- `category`: grouping label shown in the UI.
- `description`: short summary shown in the UI.
- `version`: skill version.
- `entrypoint`: relative path to the agent-facing instruction file, usually `SKILL.md`.
- `executor`: declarative executor configuration. Use `{ "mode": "none" }` for instruction-only skills.

Optional fields:

- `status`: `enabled` or `draft`; repository skills normally use `enabled`.
- `capabilities`: labels for filtering and discovery.
- `files`: relative, non-secret support files that can be shown in previews.

Repository skills are read-only in the app. Users customize them by duplicating a skill into their personal library.

## Planner Manifest

Each planner directory must contain `planner.json`. Prompt and context files listed in `configFiles` are loaded as read-only support files.

Required fields:

- `id`: stable id using letters, numbers, `_`, or `-`.
- `name`: human-readable planner name.
- `version`: planner version.
- `description`: short summary shown in the UI.
- `engine`: adapter id such as `goose`.
- `modelRoles`: role names such as `planner`, `worker`, and `summarizer`.
- `defaultContext`, `skillPolicy`, `workspacePolicy`, and `runtime`: default planning, tool visibility, workspace, and adapter requirements.

Optional fields:

- `responseSchema`: the JSON payload contract a planner should return.

Planner specs are not browser-authored agents. Users select repo specs and save global defaults or project overrides that bind roles to configured LiteLLM aliases. For Goose planners, the backend materializes selected Skill Setup entries as generated, planner-only `.agents/skills/<skillId>/SKILL.md` stubs in the project Goose workspace before a planner session starts. These stubs are reasoning context only; the future broker remains responsible for validating and executing any returned JSON execution payload.
