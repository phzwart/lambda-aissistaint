# Paper Reader Summary CLI

Container-ready PaperQA2 CLI for reading one provided PDF paper and writing structured summary artifacts.

```bash
python -m paper_reader_summary \
  --input /path/to/paper.pdf \
  --output /path/to/output \
  --llm-model LLM_A \
  --summary-llm-model LLM_A \
  --embedding-model st-multi-qa-MiniLM-L6-cos-v1
```

Required environment:

- `PAPERQA_LITELLM_URL`
- `PAPERQA_LITELLM_API_KEY`

The model flags are runtime values injected by the host from AIssistAInt setup. Do not bake them into the image.

PDF handling and summarization run through PaperQA2's manual `Docs.aadd` / `Docs.aquery` workflow. There is no fallback parser and no plaintext/Markdown mode.
