#!/usr/bin/env python3
"""Download PubLayNet weights at image build time (run as root during docker build)."""
from __future__ import annotations

import sys


def main() -> int:
    from paper_reader_summary.layout_runtime import get_layout_model, log_layout_runtime_status, reset_layout_model_cache_for_tests

    reset_layout_model_cache_for_tests()
    model, error = get_layout_model()
    if model is None:
        print(f"prefetch_layout_model: failed: {error or 'unknown error'}", file=sys.stderr)
        return 1

    print("prefetch_layout_model: PubLayNet weights ready", flush=True)
    log_layout_runtime_status()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
