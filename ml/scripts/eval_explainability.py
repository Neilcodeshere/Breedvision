"""Is the heat-map informative, or just a pretty picture?

Three questions, each answerable with a number:

1. Deletion test. Blank out the cells the map calls most important and measure
   how much the predicted class's probability falls. If the map is informative,
   removing its top cells must hurt MORE than removing random cells.

2. Centre-prior baseline. Cattle photos are usually centred, so a fixed blob in
   the middle might do as well as a per-image map. Removing the cells a FIXED
   average map ranks highest is the fair comparison. A per-image map that does
   not beat it adds nothing over "look in the middle".

3. Class sensitivity. If the map for the top class and for the runner-up are
   nearly identical, it shows where the animal is, not what evidence points to
   this breed. Reported as a rank correlation.

Run on real validation photos (the test split is not touched).

Usage:
    python ml/scripts/eval_explainability.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import _bootstrap  # noqa: F401
import numpy as np
import pandas as pd
import torch
from PIL import Image
from scipy.stats import spearmanr

from ml.dataset.config import load_config
from ml.training import explain as ex
from ml.training.inference import BreedPredictor

N_IMAGES = 300
KS = (5, 10, 15)            # cells removed, out of 49 (about 10%, 20%, 31%)
RANDOM_DRAWS = 3
SEED = 42
BUNDLE = Path(__file__).resolve().parents[2] / "backend" / "models" / "breedvision_classifier.pt"
CELL = 32                   # 224 / 7


def blank(x: torch.Tensor, cells: np.ndarray) -> torch.Tensor:
    """Set the chosen 7x7 cells to the dataset mean (0 after normalisation)."""
    y = x.clone()
    for c in cells:
        r, q = divmod(int(c), 7)
        y[:, :, r * CELL:(r + 1) * CELL, q * CELL:(q + 1) * CELL] = 0.0
    return y


@torch.inference_mode()
def prob_of(pred, batch: torch.Tensor, ci: int) -> np.ndarray:
    feats = pred.backbone(batch)
    logits = pred.head((feats - pred.feature_mean) / pred.feature_std)
    return torch.softmax(logits / pred.temperature, dim=1)[:, ci].numpy()


def main() -> int:
    cfg = load_config()
    root = cfg.p("raw")
    df = pd.read_parquet(cfg.p("metadata") / "splits.parquet")
    df = df[df["split"] == "val"].sample(n=N_IMAGES, random_state=SEED).reset_index(drop=True)

    pred = BreedPredictor(BUNDLE, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
    rng = np.random.default_rng(SEED)

    items = []
    for _, r in df.iterrows():
        img = Image.open(root / r["relpath"]).convert("RGB")
        x, _ = ex.model_view(pred, img)
        fmap = ex.feature_map(pred, x)
        with torch.inference_mode():
            logits = pred.head((fmap.mean(dim=(2, 3)) - pred.feature_mean) / pred.feature_std)[0]
        order = logits.argsort(descending=True)
        top1, top2 = int(order[0]), int(order[1])
        m1 = ex.closed_form_cam(pred, fmap, top1)
        m2 = ex.closed_form_cam(pred, fmap, top2)
        items.append({"x": x, "ci": top1, "m1": m1, "m2": m2,
                      "correct": pred.idx_to_class[top1] == r["class_label"]})

    # fixed prior: the average positive map over all images
    prior = np.mean([np.maximum(i["m1"], 0) for i in items], axis=0).reshape(-1)
    prior_rank = np.argsort(-prior)

    results = {k: {"cam": [], "prior": [], "random": [], "least": []} for k in KS}
    base_p = []
    for it in items:
        flat = np.maximum(it["m1"], 0).reshape(-1)
        rank = np.argsort(-flat)                       # most important first
        p0 = float(prob_of(pred, it["x"], it["ci"])[0])
        base_p.append(p0)
        for k in KS:
            variants = [blank(it["x"], rank[:k]), blank(it["x"], prior_rank[:k]), blank(it["x"], rank[-k:])]
            variants += [blank(it["x"], rng.choice(49, k, replace=False)) for _ in range(RANDOM_DRAWS)]
            p = prob_of(pred, torch.cat(variants), it["ci"])
            results[k]["cam"].append(p0 - p[0])
            results[k]["prior"].append(p0 - p[1])
            results[k]["least"].append(p0 - p[2])
            results[k]["random"].append(p0 - float(np.mean(p[3:])))

    out = {"n_images": len(items), "seed": SEED, "cells_total": 49, "split": "val (test untouched)",
           "mean_base_probability": float(np.mean(base_p)), "deletion": {}}

    print(f"{len(items)} validation photos; mean probability of the predicted class before any deletion: {np.mean(base_p):.3f}\n")
    print("DELETION TEST: mean fall in the predicted class's probability when cells are blanked")
    print(f"{'cells removed':<16}{'most-important (map)':>22}{'fixed centre prior':>20}{'random cells':>14}{'least-important':>17}")
    for k in KS:
        r = {n: np.array(v) for n, v in results[k].items()}
        win_vs_random = float((r["cam"] > r["random"]).mean())
        win_vs_prior = float((r["cam"] > r["prior"]).mean())
        out["deletion"][k] = {n: float(v.mean()) for n, v in r.items()} | {
            "map_beats_random_share": win_vs_random, "map_beats_prior_share": win_vs_prior}
        print(f"{f'{k} ({k/49:.0%})':<16}{r['cam'].mean():>22.4f}{r['prior'].mean():>20.4f}{r['random'].mean():>14.4f}{r['least'].mean():>17.4f}")
    print()
    for k in KS:
        d = out["deletion"][k]
        print(f"k={k:<3} per-image map hurts more than random cells in {d['map_beats_random_share']:.0%} of images, "
              f"and more than the fixed centre prior in {d['map_beats_prior_share']:.0%}")

    corr = [spearmanr(i["m1"].reshape(-1), i["m2"].reshape(-1)).statistic for i in items]
    corr = np.array([c for c in corr if np.isfinite(c)])
    out["class_sensitivity"] = {"mean_rank_correlation_top1_vs_top2": float(corr.mean()),
                                "share_above_0.9": float((corr > 0.9).mean())}
    print(f"\nCLASS SENSITIVITY: rank correlation between the top-1 and runner-up maps")
    print(f"  mean {corr.mean():.3f}; above 0.9 in {(corr > 0.9).mean():.0%} of images "
          f"(1.0 would mean the map ignores which class is asked about)")

    pr = prior.reshape(7, 7)
    centre = pr[2:5, 2:5].sum() / pr.sum()
    out["centre_bias"] = {"central_3x3_share_of_average_evidence": float(centre), "uniform_expectation": 9 / 49}
    print(f"\nCENTRE BIAS: the central 3x3 cells hold {centre:.0%} of the average positive evidence "
          f"(uniform would be {9/49:.0%})")

    acc = float(np.mean([i["correct"] for i in items]))
    out["top1_accuracy_on_sample"] = acc
    print(f"\n(sample top-1 accuracy {acc:.1%}; maps explain the model's PREDICTION, right or wrong)")

    p = Path(cfg.p("reports")) / "explainability_eval.json"
    p.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"wrote {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
