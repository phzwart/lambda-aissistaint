---
name: paper-reader-summary
description: "Use when asked to read or summarize a single paper, PDF, or article and extract its question, methods, data, findings, contributions, limitations, and evidence anchors."
disable-model-invocation: true
---

# Paper Reader Summary

## Purpose

Read one provided paper and produce a grounded, structured summary for a human reader.

## When To Use

Use this skill when the user asks to summarize, read, explain, or extract the main idea, methods, results, or limitations from a single paper, PDF, or article.

Do not use this skill for literature review, broad research, search, indexing, project management, chat orchestration, or cross-paper synthesis unless the caller explicitly provides a small fixed set of papers.

## Inputs

- One PDF paper file path or PaperQA2-extracted paper text from the host environment.
- Optional caller-provided metadata such as title, DOI, authors, venue, or year.
- Optional page, section, or extraction markers supplied by the host environment.

## Procedure

1. Read only the provided paper content.
2. Prefer evidence from the paper itself over caller-provided or inferred metadata.
3. Identify the paper's main argument, research question, methods, data or experimental setup, results, limitations, and claimed contributions.
4. Distinguish author claims from your own interpretation.
5. Preserve technical detail where it affects the meaning of the work.
6. Use page or section references for important claims whenever the provided content makes them available.
7. State uncertainty directly when information is missing, unclear, incomplete, or inferred.
8. Do not invent title, authors, venue, year, page numbers, datasets, baselines, methods, metrics, results, or limitations.
9. Do not summarize cited references unless their contents are included in the provided paper text.
10. Write concise, information-dense prose without hype or generic filler.

## Expected Output

Produce a structured summary with these sections:

### Citation Header

- Title:
- Authors:
- Venue / Year:

Use `Not available in provided paper` for missing fields.

### Executive Summary

Write 5 to 8 plain-language sentences. Cover the problem, approach, main result, contribution, and key caveat.

### Research Question

State the central question or problem the paper addresses.

### Approach / Methods

Summarize the methods, model, theory, analysis, or procedure used by the authors.

### Data / Experimental Setup

Describe datasets, materials, participants, simulations, instruments, baselines, evaluation metrics, or experimental conditions when available.

### Main Findings

List the main findings. Keep author claims separate from interpretation.

### Claimed Contributions

State what the authors claim is new, useful, or important. Do not overclaim novelty.

### Limitations / Caveats

Identify explicit limitations, methodological caveats, missing information, threats to validity, or unclear parts of the paper.

### Evidence Anchors

Provide page or section references for the most important claims when available. If references are unavailable, use section names or short identifying phrases from the paper.

### Confidence / Ambiguity Notes

State what is well-supported, what is unclear, and what was inferred.

## Safety Constraints

- Do not perform external web search.
- Do not use outside APIs for metadata enrichment.
- Do not access storage systems or move files outside the provided input/output paths.
- Do not create vector indexes or persistent knowledge bases.
- Do not compile chatbot memory.
- Do not orchestrate workflows or agents.
- Do not fabricate unsupported claims.
- Do not expose secrets, credentials, private paths beyond what is necessary, or raw system metadata.

## Required Tools

- Use only the paper content or local file content provided by the host environment.
- Use the PaperQA2-based extraction CLI for local PDF extraction. Do not use another parser as a fallback.
- If the host has already run the PaperQA2-based extraction CLI, treat its output as the provided paper content and verify claims against that content.

## Scope Guard

This skill reads one provided paper and produces a grounded structured summary. It does not search the web, manage storage, ingest project files, build indexes, orchestrate workflows, create chat memory, perform literature review, or synthesize across papers unless the caller explicitly provides a small fixed set of papers.
