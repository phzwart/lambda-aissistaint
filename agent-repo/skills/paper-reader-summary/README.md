# Paper Reader Summary

This repository skill reads one PDF paper through PaperQA2 and prepares a grounded structured summary. It is intentionally narrow: one input paper, one output directory, no storage operations, and no workflow orchestration.

## Invocation

From the `cli/` directory or with the package on `PYTHONPATH`:

```bash
python -m paper_reader_summary \
  --input /path/to/paper.pdf \
  --output /path/to/output \
  --litellm-url http://127.0.0.1:4000 \
  --litellm-runtime /path/to/litellm-runtime.json \
  --llm-model LLM_A \
  --summary-llm-model LLM_A \
  --embedding-model st-multi-qa-MiniLM-L6-cos-v1
```

`litellm-runtime.json` is written by the API from Preferences (deployment alias `LLM_A`, provider model metadata, proxy URL). The runner always calls LiteLLM using the alias, never the raw provider model name.

The model arguments are supplied by the host from AIssistAInt setup at runtime. They are not hardcoded into the skill or container image.

The host must inject:

- `PAPERQA_LITELLM_URL`
- `PAPERQA_LITELLM_API_KEY`

## Outputs

- `extracted.txt`: full text extracted from the PDF via PaperQA2's pymupdf parser (text only; no embedded PNG blobs).
- `figures/`: substantial figures from the PDF saved as PNG files (`pageNNN_figMM.png`). Small vector clusters (typical inline equations and symbols) are filtered out; see `skipped` in the manifest.
- `figures_manifest.json`: index of layout-cropped figures (`fig_pNNN_MM.png`) plus `legacy_embedded` entries from PDF vector media; `skipped` documents filtered embedded items.
- `pages/page_NNNN.png`: rendered page images (default 300 DPI; `PAPER_RENDER_DPI` / `--render-dpi`).
- `layout.json`: PubLayNet layout regions (`PAPER_LAYOUT_ENABLED=false` yields empty `regions`).
- `evidence.json`: provenance-linked figure/equation/table evidence objects.
- `chunks.json`: augmentation index linking page spans to evidence IDs (PaperQA2 internal chunks unchanged).
- `multimodal_context.json`: sidecar summary of linked figures/equations for future prompt wiring.
- `equations/eq_pNNN_MM.png`: equation region crops (LaTeX OCR optional via `PAPER_EQUATION_OCR`).
- `debug/`: layout overlays when `PAPER_MULTIMODAL_DEBUG=true`.
- `abstract.txt`: verbatim abstract section extracted heuristically from the paper text.
- `extraction_metadata.json`: title/authors/page-count hints from extraction, plus abstract extraction flags.
- `summary.md`: human-readable structured summary (citations use the upload stem, e.g. `{timestamp}-{uuid}-{name}.pdf`, not `paper.pdf`).
- `summary.json`: structured record containing the summary and safe metadata.
- `extended_abstract.md`: Expert-level reconstruction (900–1200 words) from the journal abstract plus PaperQA-retrieved evidence (not the raw prompt or full `extracted.txt`). When figures exist, the prompt lists them by page and a **Figures from PDF** section with Markdown image links is appended after generation.
- `follow_up_questions.json`: `{ "depth": [5 questions], "breadth": [5 questions] }` from `extended_abstract.md` and `summary.md` only (not the full paper).
- `knowledge_graph.json`: structured entities, claims, observations, methods, materials, parameters, limitations, questions, and relationships compiled from the paper package (abstract, summary, extended abstract, follow-ups) via a direct LLM call — not PaperQA RAG.
- `paper_metadata.json`: runtime model aliases, `paper_id`, `citation_label`, embedding model, warnings, and safe PaperQA2 response metadata.

Per-project processing instructions are stored on the project skill binding (`processingConfig`) and passed via `skill-runtime.json` at run time. Defaults live in `defaults.json`.

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

Rebuild the runner image after changing the Python CLI (including multimodal layout deps):

```bash
podman_services/build_paperqa2_runner.sh
```

The image installs `paper-reader-summary[layout]` (layoutparser, PaddlePaddle PubLayNet, headless OpenCV) plus system libraries for headless OpenCV/Paddle (`libxcb1`, `libx11-6`, `libgl1`, etc.). PubLayNet weights are prefetched at **build** time from the Paddle model zoo; the build fails if the layout stack cannot load.

Default layout model: `lp://PubLayNet/ppyolov2_r50vd_dcn_365e/config` (override with `PAPER_LAYOUT_MODEL`). Legacy EfficientDet Dropbox weights are no longer hosted; use Paddle unless you supply local weights.

Environment flags:

| Variable | Default in image | Purpose |
|----------|------------------|---------|
| `PAPER_LAYOUT_ENABLED` | `true` | PubLayNet layout detection |
| `PAPER_RENDER_DPI` | `300` | Rendered page PNG resolution |
| `PAPER_MULTIMODAL_DEBUG` | `false` | Layout overlay PNGs under `debug/` |

Set `PAPER_LAYOUT_ENABLED=false` for fast mock E2E and unit tests (no torch inference).

### Layout smoke test (after rebuild)

```bash
# 1) Build
podman_services/build_paperqa2_runner.sh

# 2) Confirm PubLayNet loads inside the image
podman run --rm -e PAPER_LAYOUT_ENABLED=true --entrypoint python \
  localhost/aissistaint/paperqa2-paper-reader:latest -c "
from paper_reader_summary.layout_runtime import log_layout_runtime_status, reset_layout_model_cache_for_tests
reset_layout_model_cache_for_tests()
s = log_layout_runtime_status()
assert s['layout_model_loaded'], s
print('layout model OK')
"

# 3) Process a PDF; expect non-empty layout.json and evidence when the paper has figures
npm run test:paperqa:container   # CLI unit tests in container
# Full pipeline: npm run test:paperqa:e2e (layout disabled) or process a real PDF via the app
```

Successful multimodal activation produces:

- `layout.json` with `"model": "lp://PubLayNet/ppyolov2_r50vd_dcn_365e/config"` and non-empty `regions` (for figure-heavy PDFs)
- `evidence.json` with `objects` (figures/equations)
- `figures/fig_pNNN_MM.png` crops
- `paperqa_evidence.json` contexts with `linked_evidence_ids` when page citations match

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
  --litellm-url http://127.0.0.1:4000 \
  --litellm-runtime /workspace/input/litellm-runtime.json \
  --llm-model LLM_A \
  --summary-llm-model LLM_A \
  --embedding-model st-multi-qa-MiniLM-L6-cos-v1
```

The container receives only a LiteLLM API key, never provider keys or MinIO credentials.
