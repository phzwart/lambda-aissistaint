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
