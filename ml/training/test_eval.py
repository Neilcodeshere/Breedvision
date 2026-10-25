"""One-time evaluation of the deployed model on the held-out test split.

Everything chosen so far (backbone, hyper-parameters, temperature, confidence
thresholds) was fitted on train/validation data only. This script scores the
single deployed model on the test split ONCE and writes the result next to the
run records. It refuses to run a second time, because a test set that is looked
at repeatedly stops being a test set; pass --allow-rerun only to reproduce the
same numbers, never to tune anything.

Usage:
    python ml/training/test_eval.py
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ml.training import calibrate as cal  # noqa: E402
from ml.training import data as data_mod  # noqa: E402
from ml.training import metrics as metrics_mod  # noqa: E402
from ml.training import train as train_mod  # noqa: E402

MANIFEST = REPO_ROOT / "backend" / "models" / "breedvision_classifier.json"
BOOTSTRAPS = 2000


def bootstrap_ci(correct: np.ndarray, seed: int = 0) -> tuple[float, float]:
    rng = np.random.default_rng(seed)
    n = len(correct)
    means = [correct[rng.integers(0, n, n)].mean() for _ in range(BOOTSTRAPS)]
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--allow-rerun", action="store_true")
    args = ap.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    run = manifest["run_id"]
    cfg = train_mod.load_config()
    out_path = Path(cfg["paths"]["runs"]) / f"{run}__test_eval.json"
    if out_path.exists() and not args.allow_rerun:
        print(f"Test split already evaluated: {out_path}\nRefusing to run again.")
        return 1

    logits, labels_t = cal.logits_for(run, cfg, "test")
    labels = labels_t.numpy()
    T = float(manifest["temperature"])
    conf_thr = manifest["thresholds"]["confident"]
    low_thr = manifest["thresholds"]["low_below"]

    class_to_idx = data_mod.load_class_mapping(cfg["data"]["class_mapping"])
    idx_to_class = {v: k for k, v in class_to_idx.items()}

    raw = logits.numpy()
    head = metrics_mod.summarise(raw, labels)
    probs = F.softmax(logits / T, dim=1)
    conf = probs.max(dim=1).values.numpy()
    pred = probs.argmax(dim=1).numpy()
    correct = (pred == labels).astype(float)

    lo, hi = bootstrap_ci(correct)
    ece_val, _ = cal.ece(conf, correct)

    bands = {}
    masks = {
        "confident": conf >= conf_thr,
        "uncertain": (conf >= low_thr) & (conf < conf_thr),
        "low": conf < low_thr,
    }
    top3 = np.argsort(-probs.numpy(), axis=1)[:, :3]
    for name, m in masks.items():
        n = int(m.sum())
        bands[name] = {
            "n": n,
            "share": n / len(labels),
            "top1_accuracy": float(correct[m].mean()) if n else None,
            "top3_accuracy": float(np.mean([labels[i] in top3[i]
                                            for i in np.where(m)[0]])) if n else None,
        }

    rows = metrics_mod.per_class(raw, labels, idx_to_class)
    result = {
        "run_id": run,
        "bundle_sha256": manifest["sha256"],
        "evaluated_utc": datetime.now(timezone.utc).isoformat(),
        "split": "test",
        "temperature": T,
        "thresholds": {"confident": conf_thr, "low_below": low_thr},
        "metrics": head,
        "accuracy_95ci_bootstrap": [lo, hi],
        "ece_after_temperature": float(ece_val),
        "bands": bands,
        "validation_metrics_for_comparison": manifest["val_metrics"],
        "worst_classes": rows[:8],
        "best_classes": rows[-5:],
    }
    out_path.write_text(json.dumps(result, indent=2), encoding="utf-8")

    m = head
    print(f"\n=== TEST SPLIT ({m['n_samples']} images, evaluated once) ===")
    print(f"top-1 {m['accuracy']:.4f}  (95% CI {lo:.3f}-{hi:.3f})   "
          f"top-3 {m['top3_accuracy']:.4f}  top-5 {m['top5_accuracy']:.4f}")
    print(f"macro-F1 {m['macro_f1']:.4f}   weighted-F1 {m['weighted_f1']:.4f}   "
          f"ECE {ece_val:.4f}")
    v = manifest["val_metrics"]
    print(f"validation: top-1 {v['accuracy']:.4f}  macro-F1 {v['macro_f1']:.4f}")
    for name, b in bands.items():
        a = "-" if b["top1_accuracy"] is None else f"{b['top1_accuracy']:.3f}"
        print(f"  {name:<10} n={b['n']:<5} share={b['share']:.1%}  top-1={a}")
    print("worst classes (F1):",
          ", ".join(f"{r['class']} {r['f1']:.2f}" for r in rows[:8]))
    print(f"\nwritten: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
