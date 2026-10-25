"""Measure how well a perceptual hash catches re-submitted photos.

Question answered: given a photo that was already recorded, how often does a
re-submitted copy (re-saved, resized, cropped, brightened...) fall within a
Hamming-distance threshold, and how often is an UNRELATED photo wrongly flagged?

What this does NOT measure: whether two different photographs of the same
animal match. They will not, and no claim of identity should be made from this.

Method
------
* Sample real dataset images from distinct near-duplicate groups, so every
  pair of samples is a genuinely different photo.
* Re-submission recall: apply each transform and measure the distance between
  original and transformed copy.
* False positives: all pairs of distinct sampled photos, split by whether they
  share a breed (same-breed pairs are the hard case).

Usage:
    python ml/scripts/eval_duplicate_detection.py
"""

from __future__ import annotations

import io
import json
from itertools import combinations
from pathlib import Path

import _bootstrap  # noqa: F401
import imagehash
import numpy as np
import pandas as pd
from PIL import Image, ImageEnhance

from ml.dataset.config import load_config

N = 400
SEED = 42
THRESHOLDS = (0, 2, 4, 6, 8, 10, 12)


def jpeg(im: Image.Image, q: int) -> Image.Image:
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=q)
    return Image.open(io.BytesIO(buf.getvalue())).convert("RGB")


def crop_centre(im: Image.Image, frac: float) -> Image.Image:
    w, h = im.size
    cw, ch = int(w * frac), int(h * frac)
    x, y = (w - cw) // 2, (h - ch) // 2
    return im.crop((x, y, x + cw, y + ch))


TRANSFORMS = {
    "identical file": lambda im: im,
    "resized to 50%": lambda im: im.resize((max(8, im.width // 2), max(8, im.height // 2)), Image.LANCZOS),
    "resized to 1280 max edge (what the app does)": lambda im: im if max(im.size) <= 1280 else im.resize((1280, int(im.height * 1280 / im.width)) if im.width >= im.height else (int(im.width * 1280 / im.height), 1280), Image.LANCZOS),
    "JPEG quality 60": lambda im: jpeg(im, 60),
    "JPEG quality 85": lambda im: jpeg(im, 85),
    "centre crop 90%": lambda im: crop_centre(im, 0.9),
    "centre crop 80%": lambda im: crop_centre(im, 0.8),
    "brightness +20%": lambda im: ImageEnhance.Brightness(im).enhance(1.2),
    "brightness -20%": lambda im: ImageEnhance.Brightness(im).enhance(0.8),
    "rotated 5 degrees": lambda im: im.rotate(5, expand=False, resample=Image.BICUBIC),
    "horizontal flip": lambda im: im.transpose(Image.FLIP_LEFT_RIGHT),
}


def main() -> int:
    cfg = load_config()
    root = cfg.p("raw")
    df = pd.read_parquet(cfg.p("metadata") / "splits.parquet")
    df = df[df["split"] != "excluded"]
    # one image per group => every sampled pair is a different photo
    df = df.drop_duplicates("group_id")
    df = df.sample(n=min(N, len(df)), random_state=SEED).reset_index(drop=True)

    imgs, hashes, labels = [], [], []
    for _, r in df.iterrows():
        im = Image.open(root / r["relpath"]).convert("RGB")
        imgs.append(im)
        hashes.append(imagehash.phash(im, hash_size=8))
        labels.append(r["class_label"])

    out = {"samples": len(imgs), "seed": SEED, "hash": "pHash 64-bit (imagehash)", "resubmission": {}, "false_positives": {}}

    print(f"{len(imgs)} distinct photos sampled\n")
    print("RE-SUBMISSION: share of altered copies caught at each Hamming threshold")
    header = f"{'transform':<46}{'median':>7}{'p95':>6}" + "".join(f"{('<=' + str(t)):>7}" for t in THRESHOLDS)
    print(header)
    for name, fn in TRANSFORMS.items():
        d = np.array([hashes[i] - imagehash.phash(fn(imgs[i]), hash_size=8) for i in range(len(imgs))])
        rec = {t: float((d <= t).mean()) for t in THRESHOLDS}
        out["resubmission"][name] = {"median": float(np.median(d)), "p95": float(np.percentile(d, 95)), "recall": rec}
        print(f"{name:<46}{np.median(d):>7.0f}{np.percentile(d, 95):>6.0f}" + "".join(f"{rec[t]:>7.1%}" for t in THRESHOLDS))

    same, diff = [], []
    for i, j in combinations(range(len(imgs)), 2):
        (same if labels[i] == labels[j] else diff).append(hashes[i] - hashes[j])
    same, diff = np.array(same), np.array(diff)
    print(f"\nFALSE POSITIVES: share of DIFFERENT photos wrongly flagged")
    print(f"{'pair type':<34}{'pairs':>10}{'min':>5}{'p1':>5}" + "".join(f"{('<=' + str(t)):>9}" for t in THRESHOLDS))
    for name, arr in (("same breed, different photo", same), ("different breed", diff)):
        fp = {t: float((arr <= t).mean()) for t in THRESHOLDS}
        out["false_positives"][name] = {"pairs": int(len(arr)), "min": int(arr.min()), "p1": float(np.percentile(arr, 1)), "rate": fp, "count": {t: int((arr <= t).sum()) for t in THRESHOLDS}}
        print(f"{name:<34}{len(arr):>10,}{arr.min():>5}{np.percentile(arr, 1):>5.0f}" + "".join(f"{fp[t]:>9.4%}" for t in THRESHOLDS))

    # Mirror-aware matching: also compare against the mirrored copy's hash.
    # Closes the horizontal-flip evasion, at the cost of one extra comparison.
    mirrored = [imagehash.phash(im.transpose(Image.FLIP_LEFT_RIGHT), hash_size=8) for im in imgs]
    mir = np.array([min(hashes[i] - hashes[j], hashes[i] - mirrored[j]) for i, j in combinations(range(len(imgs)), 2)])
    print()
    print("MIRROR-AWARE matching (compare against both orientations).")
    print("A flipped copy is caught by construction, so only false positives need measuring.")
    print(f"{'false positives, all pairs':<34}{len(mir):>10,}{mir.min():>5}{np.percentile(mir, 1):>5.0f}" + "".join(f"{(mir <= t).mean():>9.4%}" for t in THRESHOLDS))
    out["mirror_aware"] = {"pairs": int(len(mir)), "min": int(mir.min()), "rate": {t: float((mir <= t).mean()) for t in THRESHOLDS}, "count": {t: int((mir <= t).sum()) for t in THRESHOLDS}}

    p = Path(cfg.p("reports")) / "duplicate_detection_eval.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"\nwrote {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
