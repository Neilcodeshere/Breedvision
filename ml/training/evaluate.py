"""Compare Phase 2 runs and measure deployment characteristics.

Reads the run records written by train.py, adds measured model size and
single-image inference latency for each backbone, and writes a comparison
table. Latency is measured on this machine's CPU -- it is a real number for
this hardware, not a projection.

Test-split metrics are NOT computed here. The test set stays untouched until
Phase 3, so that architecture selection cannot be contaminated by it.

Usage:
    python ml/training/evaluate.py
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from pathlib import Path

import numpy as np
import torch

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ml.training import features as feat_mod  # noqa: E402
from ml.training import train as train_mod  # noqa: E402


def measure_backbone(timm_name: str, image_size: int,
                     samples: int) -> dict:
    """Parameter count, on-disk size and per-image CPU latency."""
    model, dim = feat_mod.build_backbone(timm_name)
    model.eval()

    params = int(sum(p.numel() for p in model.parameters()))
    # float32 on disk; the honest size for the current artefact, before any
    # Phase 8 quantisation or export.
    size_mb = params * 4 / (1024 * 1024)

    x = torch.randn(1, 3, image_size, image_size)
    with torch.inference_mode():
        for _ in range(5):          # warm-up: first passes include lazy init
            model(x)
        times = []
        for _ in range(samples):
            t0 = time.perf_counter()
            model(x)
            times.append((time.perf_counter() - t0) * 1000.0)

    arr = np.array(times)
    return {
        "feature_dim": dim,
        "backbone_params": params,
        "backbone_size_mb": round(size_mb, 2),
        "latency_ms_mean": round(float(arr.mean()), 2),
        "latency_ms_p50": round(float(np.percentile(arr, 50)), 2),
        "latency_ms_p95": round(float(np.percentile(arr, 95)), 2),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default=None)
    ap.add_argument("--skip-latency", action="store_true",
                    help="skip timing (useful for a fast re-render)")
    args = ap.parse_args()

    cfg = train_mod.load_config(
        Path(args.config) if args.config else None)
    runs_dir = Path(cfg["paths"]["runs"])
    exp = cfg["experiment"]["name"]

    records = []
    for backbone in cfg["backbones"]:
        path = runs_dir / f"{exp}__{backbone['key']}.json"
        if not path.is_file():
            print(f"  (missing run: {path.name} — skipping)")
            continue
        rec = json.loads(path.read_text(encoding="utf-8"))

        if not args.skip_latency:
            print(f"  timing {backbone['key']} ...", flush=True)
            rec["deployment"] = measure_backbone(
                backbone["timm_name"],
                cfg["preprocess"]["image_size"],
                cfg["eval"]["latency_samples"],
            )
        records.append(rec)

    if not records:
        print("ERROR: no run records found. Run train.py first.")
        return 2

    records.sort(key=lambda r: -r["val_metrics"]["macro_f1"])

    print("\n=== PHASE 2 COMPARISON (validation split) ===\n")
    head = (f"{'backbone':<18}{'acc':>7}{'macroF1':>9}{'wF1':>7}"
            f"{'top3':>7}{'top5':>7}{'params':>10}{'MB':>7}{'ms/img':>8}")
    print(head)
    print("-" * len(head))
    for r in records:
        m = r["val_metrics"]
        d = r.get("deployment", {})
        print(
            f"{r['backbone']['key']:<18}"
            f"{m['accuracy']:>7.4f}{m['macro_f1']:>9.4f}"
            f"{m['weighted_f1']:>7.4f}{m['top3_accuracy']:>7.4f}"
            f"{m['top5_accuracy']:>7.4f}"
            f"{d.get('backbone_params', 0):>10,}"
            f"{d.get('backbone_size_mb', 0):>7.1f}"
            f"{d.get('latency_ms_mean', 0):>8.1f}"
        )

    out = runs_dir / f"{exp}__comparison.json"
    out.write_text(
        json.dumps(
            {
                "experiment": exp,
                "dataset_version": cfg["experiment"]["dataset_version"],
                "note": (
                    "Validation metrics only. The test split is untouched and "
                    "reserved for Phase 3."
                ),
                "environment": {
                    "device": "cpu",
                    "cpu": platform.processor(),
                    "torch": torch.__version__,
                    "threads": torch.get_num_threads(),
                },
                "runs": records,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
