"""Stage 2 -- exact duplicates, near-duplicates and same-source grouping.

Reads ``metadata/inventory.parquet`` and writes ``metadata/groups.parquet``
(inventory of valid images plus a ``group_id`` column), along with duplicate
listings and a pHash distance histogram used to justify the threshold.

Usage:
    python ml/scripts/detect_duplicates.py [--sweep]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import _bootstrap  # noqa: F401

import numpy as np
import pandas as pd

from ml.dataset import hashing, inventory
from ml.dataset.config import ensure_dirs, load_config


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default=None)
    ap.add_argument("--root", default=None)
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--no-progress", action="store_true")
    ap.add_argument("--sweep", action="store_true",
                    help="report group counts across a range of thresholds "
                         "instead of committing to the configured one")
    args = ap.parse_args()

    cfg = load_config(args.config)
    ensure_dirs(cfg)
    root = Path(args.root) if args.root else cfg.p("raw")
    out_dir = Path(args.out_dir) if args.out_dir else cfg.p("metadata")

    inv_path = out_dir / "inventory.parquet"
    if not inv_path.is_file():
        print(f"ERROR: {inv_path} not found. Run inspect_dataset.py first.")
        return 2

    df = pd.read_parquet(inv_path)
    valid = df[df["status"] == inventory.STATUS_OK].reset_index(drop=True)
    print(f"Valid images: {len(valid):,} of {len(df):,}")
    if valid.empty:
        print("ERROR: no valid images to process.")
        return 2

    # --- exact duplicates ---------------------------------------------------
    exact = hashing.exact_duplicate_groups(valid)
    exact_extra = int((exact["count"] - 1).sum()) if len(exact) else 0
    cross_class = exact[exact["classes"].apply(len) > 1] if len(exact) else exact
    print(f"Exact-duplicate sets: {len(exact)} "
          f"({exact_extra} redundant files)")
    if len(cross_class):
        print(f"  WARNING: {len(cross_class)} identical file(s) appear under "
              f"MORE THAN ONE class label -- likely mislabelling.")

    # --- perceptual hashing -------------------------------------------------
    dup_cfg = cfg.section("duplicates")
    paths = [root / r for r in valid["relpath"]]
    hashes = hashing.compute_phashes(
        paths, hash_size=dup_cfg["phash_size"], workers=args.workers,
        show_progress=not args.no_progress,
    )

    hist = hashing.distance_histogram(hashes, seed=cfg.seed)
    np.save(out_dir / "phash_distance_histogram.npy", hist)

    if args.sweep:
        # Scale the sweep range with the hash length: a distance of 12 means
        # something very different for a 64-bit hash than for a 256-bit one.
        n_bits = dup_cfg["phash_size"] ** 2
        steps = sorted({int(round(f * n_bits)) for f in
                        (0.0, 0.03, 0.06, 0.09, 0.12, 0.16, 0.20,
                         0.25, 0.30, 0.375)})
        print(f"\n=== THRESHOLD SWEEP ({n_bits}-bit hash) ===")
        print(f"{'thresh':>7} {'pairs':>10} {'groups':>9} {'multi':>7} "
              f"{'largest':>8}")
        for t in steps:
            pairs = hashing.near_duplicate_pairs(
                hashes, threshold=t, show_progress=False)
            gids = hashing.build_groups(len(valid), pairs)
            sizes = pd.Series(gids).value_counts()
            print(f"{t:>7} {len(pairs):>10,} {len(sizes):>9,} "
                  f"{int((sizes > 1).sum()):>7,} {int(sizes.max()):>8,}")
        print("\nSweep only -- no files written. "
              "Set duplicates.phash_threshold in ml/config.yaml, then re-run.")
        return 0

    # Flag files whose exact content also appears under a different class
    # label. These are recorded (not deleted) so build_splits.py can exclude
    # them reversibly, and so the report can quantify them.
    cross_hashes = set(cross_class["sha256"]) if len(cross_class) else set()
    valid["cross_class_dup"] = valid["sha256"].isin(cross_hashes)

    threshold = dup_cfg["phash_threshold"]
    pairs = hashing.near_duplicate_pairs(
        hashes, threshold=threshold, show_progress=not args.no_progress)
    group_ids = hashing.build_groups(len(valid), pairs)
    valid["group_id"] = group_ids

    sizes = valid.groupby("group_id").size()
    multi = sizes[sizes > 1]
    largest = int(sizes.max())

    # --- persist ------------------------------------------------------------
    valid.to_parquet(out_dir / "groups.parquet", index=False)
    np.save(out_dir / "phashes.npy", hashes)
    pd.DataFrame(pairs, columns=["i", "j", "distance"]).to_parquet(
        out_dir / "near_duplicate_pairs.parquet", index=False)
    if len(exact):
        exact.assign(files=exact["files"].apply(json.dumps),
                     classes=exact["classes"].apply(json.dumps)).to_csv(
            out_dir / "exact_duplicates.csv", index=False)

    stats = {
        "phash_size": dup_cfg["phash_size"],
        "phash_threshold": threshold,
        "valid_images": int(len(valid)),
        "exact_duplicate_sets": int(len(exact)),
        "exact_redundant_files": exact_extra,
        "exact_cross_class_sets": int(len(cross_class)),
        "near_duplicate_pairs": int(len(pairs)),
        "groups": int(len(sizes)),
        "multi_image_groups": int(len(multi)),
        "images_in_multi_image_groups": int(multi.sum()),
        "largest_group": largest,
        "mean_group_size": float(sizes.mean()),
    }
    (out_dir / "duplicate_stats.json").write_text(
        json.dumps(stats, indent=2), encoding="utf-8")

    print("\n=== GROUPING SUMMARY ===")
    for k, v in stats.items():
        print(f"  {k:>32}: {v}")

    if largest >= dup_cfg["max_group_size_warn"]:
        print(f"\n  WARNING: largest group has {largest} images "
              f"(>= {dup_cfg['max_group_size_warn']}). This can indicate the "
              f"threshold is too loose and is over-merging distinct animals. "
              f"Re-run with --sweep to inspect.")

    reduction = 100.0 * (1 - len(sizes) / len(valid))
    print(f"\n  {len(valid):,} images collapse into {len(sizes):,} groups "
          f"({reduction:.1f}% reduction).")
    print(f"\nWrote {out_dir / 'groups.parquet'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
