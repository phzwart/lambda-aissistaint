from __future__ import annotations

import os
import sys
from typing import Any

# EfficientDet PubLayNet checkpoints may require full torch.load when enabled via PAPER_LAYOUT_MODEL.
os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")


def _allow_full_torch_checkpoints() -> None:
    try:
        import torch
    except ImportError:
        return
    if getattr(torch.load, "_paper_reader_patched", False):
        return
    original_load = torch.load

    def patched_load(*args, **kwargs):
        kwargs["weights_only"] = False
        return original_load(*args, **kwargs)

    patched_load._paper_reader_patched = True  # type: ignore[attr-defined]
    torch.load = patched_load  # type: ignore[assignment]

    if hasattr(torch, "hub") and hasattr(torch.hub, "load_state_dict_from_url"):
        original_hub = torch.hub.load_state_dict_from_url

        def patched_hub(*args, **kwargs):
            kwargs["weights_only"] = False
            return original_hub(*args, **kwargs)

        torch.hub.load_state_dict_from_url = patched_hub  # type: ignore[assignment]


_allow_full_torch_checkpoints()

from .layout_config import (
    DEFAULT_LAYOUT_MODEL_ID,
    layout_detect_extra_config,
    layout_enabled,
    layout_model_id,
)

_LAYOUT_MODEL_CACHE: dict[str, object] = {}
_LAYOUT_MODEL_LOAD_FAILED: dict[str, str] = {}


def _env_flag(name: str, default: str) -> str:
    return os.environ.get(name, default).strip()


def probe_torch_cuda() -> bool | None:
    try:
        import torch
    except ImportError:
        return None
    return bool(torch.cuda.is_available())


def log_layout_runtime_status(*, stream: object | None = None) -> dict[str, Any]:
    """Log multimodal layout runtime (informational). Returns status dict for metadata."""
    out = sys.stderr if stream is None else stream
    enabled = layout_enabled()
    model_id = layout_model_id()
    status: dict[str, Any] = {
        "paper_layout_enabled": enabled,
        "layout_model_id": model_id,
        "layout_model_loaded": False,
        "layout_model_error": None,
        "cuda_available": probe_torch_cuda(),
        "opencv_available": None,
    }

    try:
        import cv2  # noqa: F401

        status["opencv_available"] = True
    except Exception as error:
        status["opencv_available"] = False
        status["opencv_error"] = str(error)

    print(
        f"[multimodal] PAPER_LAYOUT_ENABLED={_env_flag('PAPER_LAYOUT_ENABLED', 'true')} "
        f"(active={enabled})",
        file=out,
        flush=True,
    )
    print(f"[multimodal] layout model={model_id}", file=out, flush=True)
    cuda = status["cuda_available"]
    if cuda is None:
        print("[multimodal] torch not installed (Paddle layout path may not need it)", file=out, flush=True)
    else:
        print(f"[multimodal] CUDA available={cuda}", file=out, flush=True)

    if not enabled:
        print("[multimodal] Layout inference skipped (disabled by env)", file=out, flush=True)
        return status

    model, error = get_layout_model(model_id=model_id)
    if model is not None:
        status["layout_model_loaded"] = True
        print(f"[multimodal] Layout model loaded: {model_id}", file=out, flush=True)
    else:
        status["layout_model_error"] = error
        print(f"[multimodal] Layout model unavailable: {error}", file=out, flush=True)

    return status


def get_layout_model(*, model_id: str | None = None) -> tuple[object | None, str | None]:
    """Return cached layout model or an error message."""
    if not layout_enabled():
        return None, "Layout detection disabled (PAPER_LAYOUT_ENABLED=false)."

    resolved_id = model_id or layout_model_id()
    if resolved_id in _LAYOUT_MODEL_CACHE:
        return _LAYOUT_MODEL_CACHE[resolved_id], None
    if resolved_id in _LAYOUT_MODEL_LOAD_FAILED:
        return None, _LAYOUT_MODEL_LOAD_FAILED[resolved_id]

    try:
        import layoutparser as lp
        from layoutparser.file_utils import is_paddle_available
    except ImportError as error:
        message = f"layoutparser not installed: {error}"
        _LAYOUT_MODEL_LOAD_FAILED[resolved_id] = message
        return None, message

    try:
        model = _create_layout_model(lp, resolved_id, is_paddle_available=is_paddle_available)
        if model is None:
            message = f"AutoLayoutModel returned no model for {resolved_id}"
            _LAYOUT_MODEL_LOAD_FAILED[resolved_id] = message
            return None, message
        _LAYOUT_MODEL_CACHE[resolved_id] = model
        return model, None
    except Exception as error:
        message = str(error)
        _LAYOUT_MODEL_LOAD_FAILED[resolved_id] = message
        return None, message


def _create_layout_model(lp: object, resolved_id: str, *, is_paddle_available: object) -> object | None:
    """Instantiate the correct layoutparser backend (Paddle PubLayNet is not AutoLayoutModel-compatible)."""
    if "efficientdet" in resolved_id:
        return lp.AutoLayoutModel(resolved_id)
    if is_paddle_available() and (
        "ppyolov2" in resolved_id or resolved_id.startswith("lp://PubLayNet")
    ):
        from layoutparser.models.paddledetection import PaddleDetectionLayoutModel

        return PaddleDetectionLayoutModel(resolved_id, extra_config=layout_detect_extra_config())
    return lp.AutoLayoutModel(resolved_id)


def reset_layout_model_cache_for_tests() -> None:
    """Allow unit tests to reset module-level cache."""
    _LAYOUT_MODEL_CACHE.clear()
    _LAYOUT_MODEL_LOAD_FAILED.clear()
