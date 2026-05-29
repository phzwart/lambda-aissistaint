from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from paper_gritsqueezer.grit_squeezer import DEFAULT_VIEWPOINT_ID, run_grit_squeezer
from paper_gritsqueezer.settings import RuntimeSettings, SettingsError


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="paper-gritsqueezer",
        description="Extract a pygrits-schema-valid grit bundle from one PDF, verified with PaperQA2.",
    )
    parser.add_argument("--input", required=True, help="Path to one PDF paper file.")
    parser.add_argument("--output", required=True, help="Directory where bundle outputs will be written.")
    parser.add_argument("--llm-model", required=True, help="LiteLLM alias for extraction/repair calls.")
    parser.add_argument(
        "--summary-llm-model",
        default="",
        help="LiteLLM alias for the summary/verification model (defaults to --llm-model).",
    )
    parser.add_argument("--embedding-model", required=True, help="Embedding model for the verification index.")
    parser.add_argument("--litellm-url", default="", help="LiteLLM proxy base URL (same as INTERNAL_LITELLM_URL).")
    parser.add_argument(
        "--litellm-runtime",
        default="",
        help="Path to litellm-runtime.json with modelAlias and provider metadata.",
    )
    parser.add_argument("--pqa-home", default="/workspace/.pqa", help="PaperQA2 cache/index home.")
    parser.add_argument("--source-hash", default="", help="Precomputed SHA-256 hex of the PDF bytes.")
    parser.add_argument("--viewpoint-id", default=DEFAULT_VIEWPOINT_ID, help="ViewpointDirective GritId to apply.")
    parser.add_argument(
        "--passes",
        default="metadata,results,negative",
        help="Comma-separated extraction passes to run.",
    )
    parser.add_argument("--max-segment-chars", type=int, default=None, help="Max chars per extraction segment (default 6000).")
    parser.add_argument("--negative-text-cap", type=int, default=None, help="Max chars sent to the negative pass (default 12000).")
    parser.add_argument("--chunk-chars", type=int, default=None, help="PaperQA2 chunk size for verification retrieval.")
    parser.add_argument("--chunk-overlap", type=int, default=None, help="PaperQA2 chunk overlap for verification retrieval.")
    parser.add_argument("--no-verify", action="store_true", help="Skip the PaperQA2 verification pass.")
    parser.add_argument("--verify-evidence-k", type=int, default=None, help="Retrieval depth (evidence_k) during verification.")
    parser.add_argument("--verify-max-grits", type=int, default=None, help="Cap the number of grits verified.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    passes = [item.strip() for item in str(args.passes or "").split(",") if item.strip()] or None
    kwargs: dict[str, object] = {}
    if args.max_segment_chars is not None:
        kwargs["max_segment_chars"] = args.max_segment_chars
    if args.negative_text_cap is not None:
        kwargs["negative_text_cap"] = args.negative_text_cap

    try:
        runtime = RuntimeSettings.from_args(args)
        result = asyncio.run(
            run_grit_squeezer(
                Path(args.input),
                Path(args.output),
                runtime,
                viewpoint_id=str(args.viewpoint_id or DEFAULT_VIEWPOINT_ID),
                passes=passes,
                source_hash=str(args.source_hash or ""),
                verify=not args.no_verify,
                verify_evidence_k=args.verify_evidence_k,
                verify_max_grits=args.verify_max_grits,
                **kwargs,
            )
        )
    except SettingsError as error:
        print(f"paper-gritsqueezer: {error}", file=sys.stderr)
        return 1
    except OSError as error:
        print(f"paper-gritsqueezer: file operation failed: {error}", file=sys.stderr)
        return 1

    if result.bundle_path is None:
        print(
            json.dumps(
                {
                    "ok": False,
                    "errors": result.validation_report.errors,
                    "warnings": result.warnings,
                },
                indent=2,
                sort_keys=True,
            )
        )
        return 1

    print(
        json.dumps(
            {
                "ok": True,
                "outputs": result.outputs,
                "passed": result.validation_report.passed,
                "repaired": result.validation_report.repaired,
                "rejected": result.validation_report.rejected,
                "verified": len(result.verification_report),
                "warnings": result.warnings,
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
