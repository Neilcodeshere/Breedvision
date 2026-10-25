"""Breed classification service for the FastAPI app.

Kept separate from ``main.py`` on purpose. The existing ``/api/detect`` route is
a working YOLO detection path; loading a second, heavier model should not be
able to destabilise it. Everything here fails soft: if torch is missing or no
checkpoint is configured, the app still starts and only ``/api/classify``
reports unavailable.

Why this imports from ``ml/`` rather than reimplementing preprocessing:
``ml/training/inference.py`` is the reference prediction path. Duplicating the
resize/crop/normalise steps here would let the serving transform drift away
from the training transform — a bug that produces quietly degraded accuracy
rather than an error. One code path, one source of truth.

Configuration (environment variables, all optional):

    BREEDVISION_CHECKPOINT   full path to a .pt checkpoint
    BREEDVISION_RUNS_DIR     directory to search (default: C:/bv-data/runs)
    BREEDVISION_RUN          run id to prefer within that directory

Note on first start: the checkpoint stores only the trained head (~265 KB). The
frozen backbone weights are fetched by ``timm`` and cached under
``~/.cache/huggingface``. The first load therefore needs network access unless
that cache is already warm.
"""

from __future__ import annotations

import os
import sys
import threading
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Preferred order when several checkpoints are present and none is pinned.
# Mirrors the Phase 2 finding: ResNet50 lost on every axis, and the two
# lightweight backbones are within about a point of each other.
PREFERRED_RUNS = (
    "phase2-frozen-baseline__efficientnet_b0",
    "phase2-frozen-baseline__mobilenetv3_100",
)

DEFAULT_RUNS_DIR = Path(
    os.environ.get("BREEDVISION_RUNS_DIR", "C:/bv-data/runs")
)

# ImageNet statistics the backbones were pretrained with. Kept here as a
# fallback so the service does not depend on ml/training/config.yaml being
# readable in a deployed container; the real values are read from config when
# available.
FALLBACK_MEAN = [0.485, 0.456, 0.406]
FALLBACK_STD = [0.229, 0.224, 0.225]

# PROVISIONAL. Phase 5 derives the real operating threshold from validation
# data. Until then this is a placeholder and the API says so in its response,
# so no caller can mistake it for a validated figure.
PROVISIONAL_CONFIDENT_THRESHOLD = 0.70
PROVISIONAL_UNCERTAIN_THRESHOLD = 0.40


@dataclass
class ClassifierStatus:
    available: bool
    source: str
    detail: str = ""
    num_classes: int = 0
    model_version: str = ""


_predictor = None
_status = ClassifierStatus(False, "not loaded", "load() has not run yet")
_lock = threading.Lock()


def _find_checkpoint() -> Path | None:
    explicit = os.environ.get("BREEDVISION_CHECKPOINT")
    if explicit:
        p = Path(explicit)
        return p if p.is_file() else None

    # A checkpoint dropped next to the YOLO weights wins, so a deployment can
    # be self-contained without setting any environment variable.
    local = BACKEND_DIR / "models" / "breedvision_classifier.pt"
    if local.is_file():
        return local

    runs = DEFAULT_RUNS_DIR
    if not runs.is_dir():
        return None

    pinned = os.environ.get("BREEDVISION_RUN")
    if pinned:
        p = runs / f"{pinned}.pt"
        return p if p.is_file() else None

    for name in PREFERRED_RUNS:
        p = runs / f"{name}.pt"
        if p.is_file():
            return p

    candidates = sorted(runs.glob("*.pt"))
    return candidates[0] if candidates else None


def _preprocess_stats():
    """Read normalisation stats from the training config when available."""
    try:
        import yaml

        cfg_path = REPO_ROOT / "ml" / "training" / "config.yaml"
        cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
        pre = cfg["preprocess"]
        return pre["mean"], pre["std"]
    except Exception:
        return FALLBACK_MEAN, FALLBACK_STD


def load() -> ClassifierStatus:
    """Load the classifier once, at application startup.

    Never raises: a failure here must not stop the rest of the API serving.
    """
    global _predictor, _status

    with _lock:
        if _predictor is not None:
            return _status

        ckpt = _find_checkpoint()
        if ckpt is None:
            _status = ClassifierStatus(
                False,
                "no checkpoint",
                f"No classifier checkpoint found. Set BREEDVISION_CHECKPOINT, "
                f"or place one at {BACKEND_DIR / 'models' / 'breedvision_classifier.pt'}, "
                f"or train one with `python ml/training/train.py`.",
            )
            return _status

        try:
            from ml.training.inference import BreedPredictor
        except Exception as exc:
            _status = ClassifierStatus(
                False,
                "dependency missing",
                f"Could not import the prediction path ({type(exc).__name__}: "
                f"{exc}). Install the ML dependencies: "
                f"pip install -r backend/requirements.txt",
            )
            return _status

        try:
            mean, std = _preprocess_stats()
            _predictor = BreedPredictor(ckpt, mean, std, device="cpu")
            _status = ClassifierStatus(
                True,
                ckpt.name,
                f"loaded from {ckpt}",
                num_classes=len(_predictor.class_to_idx),
                model_version=_predictor.model_version,
            )
        except Exception as exc:
            _predictor = None
            _status = ClassifierStatus(
                False,
                "load error",
                f"{type(exc).__name__}: {exc}",
            )
        return _status


def status() -> ClassifierStatus:
    return _status


def active_thresholds() -> dict:
    """Thresholds shipped inside the loaded model, else the provisional ones.

    Taking them from the model keeps a model and its operating point together:
    swapping the bundle can never leave stale cut-offs behind in this file.
    """
    t = getattr(_predictor, "thresholds", None) if _predictor is not None else None
    if t:
        return {
            "confident": float(t["confident"]),
            "uncertain": float(t["low_below"]),
            "provisional": False,
            "basis": t.get("basis", ""),
            "target_confident_accuracy": t.get("target_confident_accuracy"),
        }
    return {
        "confident": PROVISIONAL_CONFIDENT_THRESHOLD,
        "uncertain": PROVISIONAL_UNCERTAIN_THRESHOLD,
        "provisional": True,
        "basis": "placeholder; this model was exported without calibration",
    }


def band_for(confidence: float) -> str:
    """Map a probability onto what the interface is allowed to assert.

    The band, not the raw number, decides whether a single breed may be named.
    """
    t = active_thresholds()
    if confidence >= t["confident"]:
        return "confident"
    if confidence >= t["uncertain"]:
        return "uncertain"
    return "low"


def slug(label: str) -> str:
    """Dataset label -> URL slug, matching the frontend's generated breed ids."""
    import re

    s = label.replace("_", "-").replace(" ", "-").lower()
    s = re.sub(r"[^a-z0-9-]", "", s)
    return re.sub(r"-+", "-", s).strip("-")


def display_name(label: str) -> str:
    """`Red_Sindhi` -> `Red Sindhi`; `ponwar` -> `Ponwar`."""
    words = label.replace("_", " ").split()
    return " ".join(
        w if w[:1].isupper() else w[:1].upper() + w[1:] for w in words
    )


def classify(image, top_k: int = 5) -> dict:
    """Classify a PIL image. Caller must check ``status().available`` first."""
    if _predictor is None:
        raise RuntimeError("classifier not loaded")

    out = _predictor.predict(image, top_k=top_k)
    top = out.candidates[0]
    band = band_for(top.probability)

    return {
        "breed_id": slug(top.breed),
        "breed_label": top.breed,
        "breed_name": display_name(top.breed),
        "confidence": round(top.probability, 4),
        "band": band,
        # False means the UI must not present a single breed as the answer.
        "is_confident": band == "confident",
        "alternatives": [
            {
                "breed_id": slug(c.breed),
                "breed_name": display_name(c.breed),
                "probability": round(c.probability, 4),
            }
            for c in out.candidates[1:]
        ],
        # None when the loaded bundle has no detector. False means the photo is
        # unlike the cattle photos the model was fitted on (see ml/training/ood.py).
        "looks_like_cattle": out.looks_like_cattle,
        "model_version": out.model_version,
        "inference_ms": round(out.inference_ms, 1),
        "num_classes": len(_predictor.class_to_idx),
        "temperature": getattr(_predictor, "temperature", 1.0),
        # Stated in every response so no consumer mistakes placeholders for
        # derived values, or the reverse.
        "thresholds": active_thresholds(),
    }


def explain(image) -> dict:
    """Where the model looked, for the breed it predicted.

    Returns the exact 224x224 view the model received, a transparent heat-map
    overlay for it, and a plain-language summary. See ml/training/explain.py for
    what the map is and, just as important, what it is not.
    """
    if _predictor is None:
        raise RuntimeError("classifier not loaded")

    import base64

    from ml.training import explain as ex

    e = ex.explain(_predictor, image)

    def data_url(im) -> str:
        return "data:image/png;base64," + base64.b64encode(ex.to_png_bytes(im)).decode("ascii")

    return {
        "breed_id": slug(e.breed_label),
        "breed_name": display_name(e.breed_label),
        "probability": round(e.probability, 4),
        "model_version": _predictor.model_version,
        # The model sees a centre crop, so this is NOT the whole uploaded photo.
        "view_png": data_url(e.crop),
        "heatmap_png": data_url(ex.heatmap_rgba(e.heat)),
        # 7x7 grid, 0-100, row-major. Also the data behind the picture, so the
        # result is not locked inside an image.
        "grid": [[int(round(v * 100)) for v in row] for row in e.heat.tolist()],
        "summary": e.summary,
        "method": "Grad-CAM (exact for this architecture: average pooling then a linear layer)",
        "limits": [
            "Shows image regions, not body parts or features.",
            "Brightness is scaled per image and cannot be compared between images.",
            "Only the centre crop the model received is shown.",
            "Low resolution: 7 x 7 cells.",
        ],
    }
