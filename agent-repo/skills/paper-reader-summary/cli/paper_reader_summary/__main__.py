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
    parser.add_argument("--pqa-home", default="/workspace/.pqa", help="PaperQA2 cache/index home inside the container workspace.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        from .paperqa_settings import RuntimeSettings

        runtime = RuntimeSettings.from_args(args)
        outputs = asyncio.run(run_paperqa_summary(Path(args.input), Path(args.output), runtime))
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
