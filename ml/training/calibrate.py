"""Temperature-scale a trained head and derive confidence thresholds from data.

Why: a softmax score is not a probability of being right. The frontend's
70% / 40% cut-offs were placeholders; this replaces guesses with measurements.

Method
------
* Logits come from the cached validation features and the trained linear head.
* A single temperature T is fitted by minimising negative log-likelihood.
* The TEST split is never touched. Calibration quality is estimated by
  K-fold cross-fitting inside validation: fit T on K-1 folds, apply to the
  held-out fold, pool the held-out results. That avoids reporting calibration
  on the same samples T was fitted to.
* Thresholds are then read from the pooled cross-fitted probabilities.

Caveat that stays attached to the output: validation is the only data used both
to fit T and to choose thresholds, so threshold figures are mildly optimistic.
The test split remains available for one honest final check.

Usage:
    python ml/training/calibrate.py --run phase2-frozen-baseline__efficientnet_b0
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ml.training import features as feat_mod  # noqa: E402
from ml.training import ft_logits  # noqa: E402
from ml.training import train as train_mod  # noqa: E402

N_BINS = 15
FOLDS = 5
# Accuracy the interface must be able to stand behind when it names a breed.
TARGET_CONFIDENT_ACCURACY = 0.90
# Below this, even the top-3 list is unreliable enough to say so.
TARGET_LOW_TOP3 = 0.60


def logits_for(run: str, cfg: dict, split: str):
    runs = Path(cfg["paths"]["runs"])
    ckpt = torch.load(runs / f"{run}.pt", map_location="cpu", weights_only=False)
    if ft_logits.is_finetuned(ckpt):
        # Fine-tuned backbone: cached frozen features do not apply.
        return ft_logits.logits_for_checkpoint(run, ckpt, cfg, split)
    fs = feat_mod.load(
        feat_mod.cache_path(
            Path(cfg["paths"]["features"]),
            run.split("__")[-1],
            split,
            cfg["preprocess"]["image_size"],
            cfg["experiment"]["dataset_version"],
        )
    )
    x = (torch.from_numpy(fs.features) - ckpt["feature_mean"]) / ckpt["feature_std"]
    w = ckpt["head_state_dict"]
    logits = x @ w["weight"].T + w["bias"]
    return logits, torch.from_numpy(fs.labels)


def fit_temperature(logits: torch.Tensor, labels: torch.Tensor) -> float:
    """Minimise NLL over log T (keeps T positive)."""
    log_t = torch.zeros(1, requires_grad=True)
    opt = torch.optim.LBFGS([log_t], lr=0.1, max_iter=200)

    def closure():
        opt.zero_grad()
        loss = F.cross_entropy(logits / log_t.exp(), labels)
        loss.backward()
        return loss

    opt.step(closure)
    return float(log_t.exp())


def ece(conf: np.ndarray, correct: np.ndarray, bins: int = N_BINS):
    edges = np.linspace(0, 1, bins + 1)
    total, rows = 0.0, []
    for i in range(bins):
        m = (conf > edges[i]) & (conf <= edges[i + 1])
        if not m.any():
            continue
        gap = abs(correct[m].mean() - conf[m].mean())
        total += m.mean() * gap
        rows.append(
            {
                "lo": round(float(edges[i]), 3),
                "hi": round(float(edges[i + 1]), 3),
                "n": int(m.sum()),
                "confidence": round(float(conf[m].mean()), 4),
                "accuracy": round(float(correct[m].mean()), 4),
            }
        )
    return float(total), rows


def summarise(probs: torch.Tensor, labels: torch.Tensor) -> dict:
    conf, pred = probs.max(dim=1)
    correct = (pred == labels).numpy().astype(float)
    e, rows = ece(conf.numpy(), correct)
    onehot = F.one_hot(labels, probs.shape[1]).float()
    return {
        "accuracy": float(correct.mean()),
        "mean_confidence": float(conf.mean()),
        "ece": e,
        "nll": float(-torch.log(probs[torch.arange(len(labels)), labels].clamp_min(1e-12)).mean()),
        "brier": float(((probs - onehot) ** 2).sum(dim=1).mean()),
        "bins": rows,
    }


def cross_fit(logits, labels, folds: int, seed: int):
    n = len(labels)
    rng = np.random.default_rng(seed)
    idx = rng.permutation(n)
    parts = np.array_split(idx, folds)
    out = torch.zeros_like(logits)
    temps = []
    for k in range(folds):
        hold = parts[k]
        fit = np.concatenate([parts[j] for j in range(folds) if j != k])
        t = fit_temperature(logits[fit], labels[fit])
        temps.append(t)
        out[hold] = logits[hold] / t
    return out, temps


def threshold_table(probs, labels, grid):
    conf, pred = probs.max(dim=1)
    top3 = probs.topk(3, dim=1).indices
    correct = (pred == labels).numpy()
    in3 = (top3 == labels[:, None]).any(dim=1).numpy()
    c = conf.numpy()
    rows = []
    for t in grid:
        m = c >= t
        rows.append(
            {
                "threshold": round(float(t), 3),
                "coverage": round(float(m.mean()), 4),
                "accuracy_when_named": round(float(correct[m].mean()), 4) if m.any() else None,
                "n": int(m.sum()),
            }
        )
    return rows, c, correct, in3


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run", required=True)
    ap.add_argument("--config", default=None)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    cfg = train_mod.load_config(Path(args.config) if args.config else None)
    logits, labels = logits_for(args.run, cfg, "val")
    n = len(labels)

    raw = summarise(F.softmax(logits, dim=1), labels)
    t_full = fit_temperature(logits, labels)
    cf_logits, temps = cross_fit(logits, labels, FOLDS, args.seed)
    cal = summarise(F.softmax(cf_logits, dim=1), labels)

    probs_cf = F.softmax(cf_logits, dim=1)
    grid = np.round(np.arange(0.20, 0.96, 0.05), 2)
    table, conf, correct, in3 = threshold_table(probs_cf, labels, grid)

    # Confident: lowest threshold whose named-breed accuracy meets the target.
    confident = next(
        (r["threshold"] for r in table
         if r["accuracy_when_named"] is not None
         and r["accuracy_when_named"] >= TARGET_CONFIDENT_ACCURACY
         and r["n"] >= 30),
        None,
    )
    # Low: highest threshold below which the true breed is in the top 3 less
    # often than the target, i.e. even the candidate list is unreliable.
    low = None
    for t in grid:
        m = conf < t
        if m.sum() >= 30 and in3[m].mean() < TARGET_LOW_TOP3:
            low = float(t)

    result = {
        "run": args.run,
        "validation_samples": int(n),
        "num_classes": int(logits.shape[1]),
        "method": f"temperature scaling, {FOLDS}-fold cross-fit within validation; test split untouched",
        "temperature_full_validation": round(t_full, 4),
        "temperature_per_fold": [round(t, 4) for t in temps],
        "before": raw,
        "after_cross_fitted": cal,
        "threshold_table": table,
        "targets": {
            "confident_accuracy": TARGET_CONFIDENT_ACCURACY,
            "low_top3": TARGET_LOW_TOP3,
        },
        "derived": {"confident": confident, "low_below": low},
        "caveat": "Thresholds are chosen on the same validation data used to fit T, so they are mildly optimistic. Confirm once on the untouched test split.",
    }
    out = Path(cfg["paths"]["runs"]) / f"{args.run}__calibration.json"
    out.write_text(json.dumps(result, indent=2), encoding="utf-8")

    print(f"validation samples : {n}   classes: {logits.shape[1]}")
    print(f"temperature (full) : {t_full:.4f}   per fold: {[round(t,3) for t in temps]}")
    print(f"{'':22}{'before':>10}{'after (CF)':>12}")
    for k in ("accuracy", "mean_confidence", "ece", "nll", "brier"):
        print(f"{k:22}{raw[k]:>10.4f}{cal[k]:>12.4f}")
    print("\ncalibrated threshold table (cross-fitted):")
    print(f"{'thresh':>8}{'coverage':>10}{'acc when named':>16}{'n':>7}")
    for r in table:
        a = "-" if r["accuracy_when_named"] is None else f"{r['accuracy_when_named']:.3f}"
        print(f"{r['threshold']:>8.2f}{r['coverage']:>10.3f}{a:>16}{r['n']:>7}")
    print(f"\nderived: confident >= {confident}   low < {low}")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
