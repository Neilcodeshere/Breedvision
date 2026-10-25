"""The frontend keeps its own copy of the confidence thresholds. If it drifts
from the thresholds embedded in the deployed model bundle, the UI and the API
would disagree about whether a breed may be named. This test makes drift fail."""

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MANIFEST = REPO / "backend" / "models" / "breedvision_classifier.json"
CONFIDENCE_TS = REPO / "web" / "src" / "lib" / "confidence.ts"


def _frontend_thresholds():
    src = CONFIDENCE_TS.read_text(encoding="utf-8")
    block = re.search(r"DEFAULT_THRESHOLDS[^=]*=\s*\{(.*?)\}", src, re.S).group(1)
    return {
        k: float(re.search(rf"{k}:\s*([0-9.]+)", block).group(1))
        for k in ("confident", "uncertain")
    }


def test_frontend_thresholds_match_model_bundle():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    t = manifest["thresholds"]
    assert t is not None, "bundle was exported without calibration"
    fe = _frontend_thresholds()
    assert fe["confident"] == t["confident"]
    assert fe["uncertain"] == t["low_below"]


def test_frontend_does_not_claim_provisional_when_model_is_calibrated():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    src = CONFIDENCE_TS.read_text(encoding="utf-8")
    flag = re.search(r"THRESHOLDS_ARE_PROVISIONAL\s*=\s*(true|false)", src).group(1)
    assert (flag == "true") == (manifest["thresholds"] is None)
