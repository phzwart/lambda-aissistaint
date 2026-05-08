# PaperQA2 Paper Reader Container

This image packages the `paper-reader-summary` CLI with PaperQA2 dependencies. It expects the host to mount one PDF at `/workspace/input/paper.pdf`, mount an output directory at `/workspace/output`, and inject LiteLLM endpoint/key environment variables.

The image does not contain provider keys, MinIO credentials, project state, or a hardcoded model choice.
