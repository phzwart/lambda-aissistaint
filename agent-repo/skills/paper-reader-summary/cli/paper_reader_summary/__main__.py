from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from .paperqa_settings import SettingsError
from .paperqa_runner import PaperQAExecutionError, run_paperqa_summary


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="paper-reader-summary",
        description="Run a one-paper PaperQA2 structured-summary workflow.",
    )
    parser.add_argument("--input", required=True, help="Path to one PDF paper file.")
    parser.add_argument("--output", required=True, help="Directory where summary outputs will be written.")
    parser.add_argument("--llm-model", required=True, help="LiteLLM alias selected by the host setup for final answers.")
    parser.add_argument("--summary-llm-model", required=True, help="LiteLLM alias selected by the host setup for PaperQA2 evidence summaries.")
    parser.add_argument("--embedding-model", required=True, help="Embedding model selected by the host setup/runtime policy.")
    parser.add_argument(
        "--litellm-url",
        default="",
        help="LiteLLM proxy base URL from AIssistAInt Preferences/runtime (same as INTERNAL_LITELLM_URL).",
    )
    parser.add_argument(
        "--litellm-runtime",
        default="",
        help="Path to litellm-runtime.json written by the API with modelAlias and provider metadata.",
    )
    parser.add_argument("--pqa-home", default="/workspace/.pqa", help="PaperQA2 cache/index home inside the container workspace.")
    parser.add_argument(
        "--runtime-config",
        default="",
        help="Path to skill-runtime.json with fileId, citationLabel, and processing instructions.",
    )
    parser.add_argument("--paper-id", default="", help="Stable file id from the host (also read from runtime-config).")
    parser.add_argument("--citation-label", default="", help="Upload stem used in PaperQA citations (also read from runtime-config).")
    parser.add_argument(
        "--source-hash",
        default="",
        help="SHA-256 hex digest of PDF bytes from host (content-addressable source id).",
    )
    parser.add_argument(
        "--render-dpi",
        type=int,
        default=None,
        help="DPI for rendered page PNGs (default 300, or PAPER_RENDER_DPI).",
    )
    parser.add_argument(
        "--chunk-chars",
        type=int,
        default=None,
        help="PaperQA2 chunk size in characters (default 5000, or PAPERQA_CHUNK_CHARS / runtime chunkChars).",
    )
    parser.add_argument(
        "--chunk-overlap",
        type=int,
        default=None,
        help="PaperQA2 chunk overlap in characters (default 250, or PAPERQA_CHUNK_OVERLAP / runtime chunkOverlap).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        from .paperqa_settings import RuntimeSettings

        runtime = RuntimeSettings.from_args(args)
        outputs = asyncio.run(
            run_paperqa_summary(
                Path(args.input),
                Path(args.output),
                runtime,
                skill_runtime_path=getattr(args, "runtime_config", None) or None,
                paper_id=str(getattr(args, "paper_id", "") or ""),
                citation_label=str(getattr(args, "citation_label", "") or ""),
                source_hash=str(getattr(args, "source_hash", "") or ""),
            )
        )
    except (PaperQAExecutionError, SettingsError) as error:
        print(f"paper-reader-summary: {error}", file=sys.stderr)
        return 1
    except OSError as error:
        print(f"paper-reader-summary: file operation failed: {error}", file=sys.stderr)
        return 1

    print(json.dumps({"ok": True, "outputs": outputs}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
