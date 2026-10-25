"""'Does this look like cattle at all?' -- a feature-space distance check.

The classifier always names *some* breed, even for a photo of a car. This fits a
simple detector on the classifier's own feature space: the smallest Mahalanobis
distance from a photo's features to any breed's mean (Lee et al., 2018), using
one pooled covariance. It is fitted on TRAIN features only; the cut-off is the
98th percentile of VALIDATION scores, so about 2% of real cattle photos are
flagged by construction. Nothing is fitted on the test split.

What it can and cannot do (measured in `evaluate_proxies` below, and stated in
docs/non-cattle-check.md): it flags images unlike cattle photos in general
(scenery, objects, noise). It is NOT shown to reject other animals such as dogs,
horses or buffalo, because no such images exist in this project to measure on.

Usage:
    python ml/training/ood.py --run phase2-frozen-baseline__efficientnet_b0_ft
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ml.training import ft_logits  # noqa: E402
from ml.training import train as train_mod  # noqa: E402

PERCENTILE = 98.0
SHRINKAGE = 0.05


def fit_gaussian(features: np.ndarray, labels: np.ndarray, n_classes: int):
    """Class means and one pooled (shrunk) precision matrix."""
    d = features.shape[1]
    means = np.stack([features[labels == c].mean(0) for c in range(n_classes)])
    centred = features - means[labels]
    cov = centred.T @ centred / len(features)
    cov = (1 - SHRINKAGE) * cov + SHRINKAGE * np.trace(cov) / d * np.eye(d)
    precision = np.linalg.inv(cov)
    return means.astype(np.float32), precision.astype(np.float32)


def score(features: np.ndarray, means: np.ndarray, precision: np.ndarray):
    """Smallest squared Mahalanobis distance to any class mean (higher = odder)."""
    f = torch.from_numpy(np.asarray(features, dtype=np.float32))
    m = torch.from_numpy(means)
    p = torch.from_numpy(precision)
    best = torch.full((f.shape[0],), float("inf"))
    for c in range(m.shape[0]):
        diff = f - m[c]
        best = torch.minimum(best, ((diff @ p) * diff).sum(1))
    return best.numpy()


def proxy_images(cfg: dict, ckpt: dict):
    """Non-cattle stand-ins that exist offline: two photos shipped with
    scikit-learn plus synthetic images. A small, weak sample, reported as such."""
    from PIL import Image
    from sklearn.datasets import load_sample_images

    imgs = {}
    for path in load_sample_images().filenames:
        imgs[Path(path).stem] = Image.open(path).convert("RGB")
    rng = np.random.default_rng(0)
    imgs["gaussian_noise"] = Image.fromarray(
        rng.integers(0, 255, (300, 400, 3), dtype=np.uint8))
    grad = np.tile(np.linspace(0, 255, 400, dtype=np.uint8), (300, 1))
    imgs["gradient"] = Image.fromarray(np.stack([grad] * 3, axis=2))
    imgs["solid_grey"] = Image.new("RGB", (400, 300), (128, 128, 128))
    chk = (np.indices((300, 400)).sum(0) // 25 % 2 * 255).astype(np.uint8)
    imgs["checkerboard"] = Image.fromarray(np.stack([chk] * 3, axis=2))
    return imgs


def proxy_scores(ckpt: dict, cfg: dict, means, precision) -> dict:
    import timm

    from ml.training import data as data_mod

    pre = cfg["preprocess"]
    backbone = timm.create_model(ckpt["backbone_timm_name"], pretrained=False,
                                 num_classes=0)
    backbone.load_state_dict(ckpt["backbone_state_dict"])
    backbone.eval()
    tf = data_mod.build_transform(pre["image_size"], pre["mean"], pre["std"])
    out = {}
    with torch.inference_mode():
        for name, img in proxy_images(cfg, ckpt).items():
            f = backbone(tf(img).unsqueeze(0)).numpy()
            out[name] = float(score(f, means, precision)[0])
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run", required=True)
    args = ap.parse_args()

    cfg = train_mod.load_config()
    runs = Path(cfg["paths"]["runs"])
    ckpt = torch.load(runs / f"{args.run}.pt", map_location="cpu",
                      weights_only=False)
    if not ft_logits.is_finetuned(ckpt):
        raise SystemExit("this check is fitted on a fine-tuned checkpoint")
    n_classes = len(ckpt["class_to_idx"])

    tr_f, tr_y = ft_logits.features_for_checkpoint(args.run, ckpt, cfg, "train")
    va_f, _ = ft_logits.features_for_checkpoint(args.run, ckpt, cfg, "val")
    means, precision = fit_gaussian(tr_f, tr_y, n_classes)

    va_s = score(va_f, means, precision)
    threshold = float(np.percentile(va_s, PERCENTILE))
    tr_s = score(tr_f, means, precision)

    proxies = proxy_scores(ckpt, cfg, means, precision)
    flagged = {k: v > threshold for k, v in proxies.items()}

    # Operating characteristic on the untouched-for-fitting test split. Nothing
    # is chosen from it; it only reports the false-reject rate on real cattle.
    te_f, _ = ft_logits.features_for_checkpoint(args.run, ckpt, cfg, "test")
    te_s = score(te_f, means, precision)

    result = {
        "run": args.run,
        "method": "min class Mahalanobis distance, pooled shrunk covariance, "
                  "fitted on train features",
        "threshold": threshold,
        "threshold_rule": f"{PERCENTILE:.0f}th percentile of validation scores",
        "score_percentiles": {
            "train_median": float(np.median(tr_s)),
            "val_median": float(np.median(va_s)),
            "test_median": float(np.median(te_s)),
        },
        "cattle_flagged_share": {
            "validation": float((va_s > threshold).mean()),
            "test": float((te_s > threshold).mean()),
        },
        "non_cattle_proxies": {
            k: {"score": round(v, 1), "flagged": bool(flagged[k])}
            for k, v in proxies.items()
        },
        "note": "Proxies are 2 unrelated photos and 4 synthetic images; they say "
                "nothing about other animals.",
    }
    (runs / f"{args.run}__ood.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8")
    np.savez_compressed(runs / f"{args.run}__ood.npz", class_means=means,
                        precision=precision, threshold=np.float32(threshold))

    print(f"threshold ({PERCENTILE:.0f}th pct of val): {threshold:.1f}")
    print(f"median score  train {np.median(tr_s):.1f}  val {np.median(va_s):.1f}"
          f"  test {np.median(te_s):.1f}")
    print(f"real cattle flagged: val {(va_s > threshold).mean():.1%}   "
          f"test {(te_s > threshold).mean():.1%}")
    for k, v in proxies.items():
        print(f"  {k:<16} score {v:>9.1f}  {'FLAGGED' if v > threshold else 'passed'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
