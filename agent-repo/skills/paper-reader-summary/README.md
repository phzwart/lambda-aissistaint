# Paper Reader Summary

This repository skill reads one PDF paper through PaperQA2 and prepares a grounded structured summary. It is intentionally narrow: one input paper, one output directory, no storage operations, and no workflow orchestration.

## Invocation

From the `cli/` directory or with the package on `PYTHONPATH`:

```bash
python -m paper_reader_summary \
  --input /path/to/paper.pdf \
  --output /path/to/output \
  --llm-model LLM_A \
  --summary-llm-model LLM_A \
  --embedding-model st-multi-qa-MiniLM-L6-cos-v1
```

The model arguments are supplied by the host from AIssistAInt setup at runtime. They are not hardcoded into the skill or container image.

The host must inject:

- `PAPERQA_LITELLM_URL`
- `PAPERQA_LITELLM_API_KEY`

## Outputs

- `summary.md`: human-readable structured summary.
- `summary.json`: structured record containing the summary and safe metadata.
- `paper_metadata.json`: runtime model aliases, embedding model, source file metadata, warnings, and safe PaperQA2 response metadata.

## Failure Behavior

The CLI exits non-zero and prints a concise error to stderr when:

- the input path does not exist or is not a file
- the input type is not PDF
- PaperQA2 or `paper-qa-pymupdf` dependencies are unavailable
- required LiteLLM env vars are absent
- required runtime model args are absent
- the output directory cannot be written

## Boundary

The host platform is responsible for locating papers, mounting/copying files, choosing the runtime LiteLLM aliases from setup, invoking the container, and storing outputs. This skill only reads one provided file and writes summary outputs.

The runner uses PaperQA2's manual `Docs.aadd` / `Docs.aquery` workflow instead of the broad `pqa ask` folder workflow. It does not fall back to another parser.

## Container Build

```bash
podman_services/build_paperqa2_runner.sh
```

The resulting image defaults to `localhost/aissistaint/paperqa2-paper-reader:latest`.

## Manual Podman Run

```bash
podman run --rm \
  --network host \
  -v /path/to/paper.pdf:/workspace/input/paper.pdf:ro \
  -v /path/to/output:/workspace/output:rw \
  -e PAPERQA_LITELLM_URL=http://127.0.0.1:4000 \
  -e PAPERQA_LITELLM_API_KEY="$PAPERQA_LITELLM_API_KEY" \
  localhost/aissistaint/paperqa2-paper-reader:latest \
  --input /workspace/input/paper.pdf \
  --output /workspace/output \
  --llm-model LLM_A \
  --summary-llm-model LLM_A \
  --embedding-model st-multi-qa-MiniLM-L6-cos-v1
```

The container receives only a LiteLLM API key, never provider keys or MinIO credentials.
