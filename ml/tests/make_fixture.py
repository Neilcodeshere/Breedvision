"""Build a synthetic dataset with KNOWN planted defects, for pipeline testing.

The real Kaggle dataset requires credentials that may not be present, and in
any case a fixture with known ground truth is what lets us assert the pipeline
*detects the right things* rather than merely that it runs.

Planted defects (see ``FIXTURE_TRUTH``):
  * class imbalance, including one class below ``min_images_per_class``
  * corrupt files (zero-byte, truncated JPEG, garbage bytes)
  * undersized images
  * exact byte-identical duplicates
  * near-duplicate families -- several photos of the same synthetic "animal",
    which a naive split will scatter across train/val/test
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

# class -> (n_animals, variants_per_animal)
CLASS_PLAN = {
    "Gir": (10, 4),
    "Sahiwal": (9, 4),
    "Kankrej": (7, 3),
    "Tharparkar": (6, 3),
    "Murrah": (5, 3),
    "RareBreed": (2, 2),   # 4 images -> below min_images_per_class (10)
}

N_CORRUPT = 3
N_TOO_SMALL = 2
N_EXACT_DUP = 2


def _animal_image(rng: np.random.RandomState, size: int = 256) -> Image.Image:
    """Low-frequency blobby RGB image: photo-like enough for perceptual hashing."""
    small = rng.rand(8, 8, 3).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8), mode="RGB")
    im = im.resize((size, size), Image.BICUBIC)
    return im


def _variant(base: Image.Image, rng: np.random.RandomState) -> Image.Image:
    """A mild perturbation: the same animal photographed slightly differently."""
    w, h = base.size
    crop = rng.randint(0, 12)
    im = base.crop((crop, crop, w - crop, h - crop)).resize((w, h),
                                                            Image.BICUBIC)
    arr = np.asarray(im).astype(np.float32)
    arr = np.clip(arr * rng.uniform(0.92, 1.08) + rng.uniform(-10, 10), 0, 255)
    return Image.fromarray(arr.astype(np.uint8), mode="RGB")


def build(root: Path, seed: int = 7) -> dict:
    """Generate the fixture under ``root``; returns the ground-truth manifest."""
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)

    rng = np.random.RandomState(seed)
    truth = {
        "classes": {},
        "corrupt_files": [],
        "too_small_files": [],
        "exact_duplicate_files": [],
        "near_dup_families": 0,
        "expected_valid_images": 0,
    }

    first_real: Path | None = None

    for cls, (n_animals, n_variants) in CLASS_PLAN.items():
        cdir = root / cls
        cdir.mkdir()
        n_written = 0
        for a in range(n_animals):
            base = _animal_image(rng, size=int(rng.choice([224, 256, 320])))
            for v in range(n_variants):
                img = base if v == 0 else _variant(base, rng)
                p = cdir / f"{cls.lower()}_a{a:02d}_v{v}.jpg"
                img.save(p, quality=int(rng.randint(80, 96)))
                if first_real is None:
                    first_real = p
                n_written += 1
        truth["classes"][cls] = n_written
        truth["near_dup_families"] += n_animals

    truth["expected_valid_images"] = sum(truth["classes"].values())

    # --- planted exact duplicates ------------------------------------------
    dup_dir = root / "Gir"
    for k in range(N_EXACT_DUP):
        dst = dup_dir / f"gir_exactdup_{k}.jpg"
        shutil.copy2(first_real, dst)
        truth["exact_duplicate_files"].append(str(dst.relative_to(root)))
        truth["classes"]["Gir"] += 1
        truth["expected_valid_images"] += 1

    # --- planted corrupt files ---------------------------------------------
    bad_dir = root / "Sahiwal"
    (bad_dir / "corrupt_zero.jpg").write_bytes(b"")
    truth["corrupt_files"].append("Sahiwal/corrupt_zero.jpg")

    (bad_dir / "corrupt_garbage.jpg").write_bytes(b"not an image at all" * 40)
    truth["corrupt_files"].append("Sahiwal/corrupt_garbage.jpg")

    good = (bad_dir / "sahiwal_a00_v0.jpg").read_bytes()
    (bad_dir / "corrupt_truncated.jpg").write_bytes(good[: len(good) // 3])
    truth["corrupt_files"].append("Sahiwal/corrupt_truncated.jpg")

    # --- planted undersized images -----------------------------------------
    for k in range(N_TOO_SMALL):
        tiny = Image.fromarray(
            (rng.rand(32, 32, 3) * 255).astype(np.uint8), mode="RGB")
        rel = f"Kankrej/tiny_{k}.jpg"
        tiny.save(root / rel)
        truth["too_small_files"].append(rel)

    truth["expected_total_files"] = (
        truth["expected_valid_images"]
        + len(truth["corrupt_files"])
        + len(truth["too_small_files"])
    )
    (root / "_truth.json").write_text(json.dumps(truth, indent=2),
                                      encoding="utf-8")
    return truth


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    t = build(Path(a.root), a.seed)
    print(json.dumps(t, indent=2))
