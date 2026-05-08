---
name: template-skill
description: "A starting point for creating an AIssistAInt agent skill."
disable-model-invocation: true
---

# Template Skill

## Purpose

Describe what this skill helps the agent accomplish.

## When To Use

Describe the user request, project state, or file types that should trigger this skill.

## Inputs

- List the required inputs.
- Note any optional inputs and defaults.

## Procedure

1. Inspect the relevant project context.
2. Validate that required inputs are present.
3. Follow the project-specific process for this skill.
4. Produce the expected output without exposing secrets.

## Expected Output

Describe the files, response shape, or summary the agent should produce.

## Safety Constraints

Do not include raw secrets, bearer tokens, provider keys, or private credentials in generated files or logs.

## Required Tools

- Add tool or executor requirements here.
