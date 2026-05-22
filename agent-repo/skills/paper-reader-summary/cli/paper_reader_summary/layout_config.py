from __future__ import annotations

import os

# Default: Paddle PubLayNet (Dropbox EfficientDet weights are no longer downloadable).
DEFAULT_LAYOUT_MODEL_ID = "lp://PubLayNet/ppyolov2_r50vd_dcn_365e/config"
EFFICIENTDET_LAYOUT_MODEL_ID = "lp://efficientdet/PubLayNet"
PADDLE_PUBLAYNET_TAR_URL = (
    "https://paddle-model-ecology.bj.bcebos.com/model/layout-parser/"
    "ppyolov2_r50vd_dcn_365e_publaynet.tar"
)
EFFICIENTDET_BACKBONE_URL = (
    "https://github.com/rwightman/efficientdet-pytorch/releases/download/v0.1/"
    "tf_efficientdet_d0_34-f153e0cf.pth"
)


def layout_model_id() -> str:
    override = os.environ.get("PAPER_LAYOUT_MODEL", "").strip()
    if override:
        return override
    return DEFAULT_LAYOUT_MODEL_ID


# Back-compat alias used across modules.
LAYOUT_MODEL_ID = DEFAULT_LAYOUT_MODEL_ID


def layout_enabled() -> bool:
    raw = os.environ.get("PAPER_LAYOUT_ENABLED", "true").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def layout_detect_extra_config() -> dict[str, object]:
    """PaddleDetectionLayoutModel tuning (env overrides)."""
    extra: dict[str, object] = {}
    threshold_raw = os.environ.get("PAPER_LAYOUT_THRESHOLD", "0.35").strip()
    try:
        extra["threshold"] = float(threshold_raw)
    except ValueError:
        extra["threshold"] = 0.35

    size_raw = os.environ.get("PAPER_LAYOUT_TARGET_SIZE", "").strip()
    if size_raw:
        parts = [part.strip() for part in size_raw.split(",") if part.strip()]
        if len(parts) == 2:
            try:
                extra["target_size"] = [int(parts[0]), int(parts[1])]
            except ValueError:
                pass
    return extra
