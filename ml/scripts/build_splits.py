"""Stage 3 -- build train/val/test splits and measure leakage.

Produces a group-aware split (production) and, for comparison only, a naive
image-level split. The number of near-duplicate pairs straddling a split
boundary under each strategy is the evidence that group-aware splitting was
necessary.

Split manifests are the canonical artefact. Image files are NOT copied by
default -- copying would triple the dataset on disk for no benefit. Use
``--materialize`` if a physical train/val/test tree is genuinely needed.

Usage:
    python ml/scripts/build_splits.py [--materialize]
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import _bootstrap  # noqa: F401

import numpy as np
import pandas as pd

from ml.dataset import splitting
from ml.dataset.config import ensure_dirs, load_config

EXCLUDED = "excluded"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default=None)
    ap.add_argument("--root", default=None)
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--materialize", action="store_true",
                    help="copy images into train/val/test directories")
    args = ap.parse_args()

    cfg = load_config(args.config)
    ensure_dirs(cfg)
    root = Path(args.root) if args.root else cfg.p("raw")
    out_dir = Path(args.out_dir) if args.out_dir else cfg.p("metadata")

    groups_path = out_dir / "groups.parquet"
    if not groups_path.is_file():
        print(f"ERROR: {groups_path} not found. "
              f"Run detect_duplicates.py first.")
        return 2

    df = pd.read_parquet(groups_path)          # positional order == pair index
    pairs_path = out_dir / "near_duplicate_pairs.parquet"
    pairs_df = pd.read_parquet(pairs_path) if pairs_path.is_file() \
        else pd.DataFrame(columns=["i", "j", "distance"])
    pairs = list(map(tuple, pairs_df.to_numpy().tolist()))

    split_cfg = cfg.section("split")
    min_per_class = split_cfg["min_images_per_class"]
    excl_cfg = cfg.raw.get("exclusions", {}) or {}

    # --- configured exclusions ----------------------------------------------
    excluded_classes = dict(excl_cfg.get("classes") or {})
    drop_cross = bool(excl_cfg.get("drop_cross_class_duplicates"))

    class_mask = df["class_label"].isin(excluded_classes)
    cross_mask = (
        df["cross_class_dup"].fillna(False)
        if drop_cross and "cross_class_dup" in df.columns
        else pd.Series(False, index=df.index)
    )

    if len(excluded_classes):
        print(f"Excluded classes    : {len(excluded_classes)} "
              f"({int(class_mask.sum())} images)")
        for name, reason in excluded_classes.items():
            print(f"    - {name}: {' '.join(str(reason).split())}")
    if drop_cross:
        print(f"Cross-class dupes   : {int(cross_mask.sum())} images dropped "
              f"(contradictory labels)")

    # --- exclude classes too small to split three ways ----------------------
    remaining = df[~(class_mask | cross_mask)]
    counts = remaining["class_label"].value_counts()
    small = sorted(counts[counts < min_per_class].index.tolist())
    keep_mask = ~(
        df["class_label"].isin(small) | class_mask | cross_mask
    )
    model_pos = np.where(keep_mask.to_numpy())[0]

    print(f"Total valid images : {len(df):,}")
    print(f"Classes            : {df['class_label'].nunique()}")
    if small:
        excluded_imgs = int((~keep_mask).sum())
        print(f"Excluded classes   : {len(small)} "
              f"(< {min_per_class} images, {excluded_imgs} images)")
        for c in small:
            print(f"    - {c} ({counts[c]})")
    print(f"Modelling images   : {len(model_pos):,}")

    if len(model_pos) == 0:
        print("ERROR: every class was excluded; nothing to split.")
        return 2

    sub = df.iloc[model_pos].reset_index(drop=True)

    # --- group-aware split (production) -------------------------------------
    group_split = splitting.assign_groupwise_splits(
        sub, train=split_cfg["train"], val=split_cfg["val"],
        test=split_cfg["test"], seed=cfg.seed,
    )
    # --- naive image-level split (comparison only) --------------------------
    naive_split = splitting.assign_naive_splits(
        sub, train=split_cfg["train"], val=split_cfg["val"],
        test=split_cfg["test"], seed=cfg.seed,
    )

    df["split"] = EXCLUDED
    df["naive_split"] = EXCLUDED
    df.loc[df.index[model_pos], "split"] = group_split.to_numpy()
    df.loc[df.index[model_pos], "naive_split"] = naive_split.to_numpy()

    # --- leakage measurement ------------------------------------------------
    # Only pairs whose BOTH endpoints are in the modelling set are meaningful.
    in_model = np.zeros(len(df), dtype=bool)
    in_model[model_pos] = True
    model_pairs = [(i, j, d) for i, j, d in pairs if in_model[i] and in_model[j]]

    group_leak = splitting.count_cross_split_pairs(
        model_pairs, df["split"].to_numpy())
    naive_leak = splitting.count_cross_split_pairs(
        model_pairs, df["naive_split"].to_numpy())

    overlap = splitting.verify_no_group_overlap(sub.assign(split=group_split))
    summary = splitting.split_summary(sub.assign(split=group_split))
    missing = splitting.classes_missing_from_split(
        sub.assign(split=group_split))

    print("\n=== GROUP-AWARE SPLIT ===")
    print(summary.to_string(index=False,
                            formatters={"fraction": "{:.3f}".format}))

    print("\n=== LEAKAGE CHECK ===")
    print(f"  near-duplicate pairs in modelling set : "
          f"{group_leak['total_pairs']:,}")
    print(f"  cross-split pairs, GROUP-AWARE        : "
          f"{group_leak['cross_split_pairs']:,}")
    print(f"  cross-split pairs, NAIVE              : "
          f"{naive_leak['cross_split_pairs']:,}")
    if naive_leak["by_boundary"]:
        print(f"  naive leakage by boundary             : "
              f"{naive_leak['by_boundary']}")
    print(f"  group overlap across splits           : {len(overlap)} "
          f"(must be 0)")

    ok = (len(overlap) == 0 and group_leak["cross_split_pairs"] == 0)
    print(f"\n  ACCEPTANCE: {'PASS' if ok else 'FAIL'}")
    if missing:
        print(f"  NOTE: classes missing from some split: "
              f"{ {k: len(v) for k, v in missing.items()} }")

    # --- persist ------------------------------------------------------------
    df.to_parquet(out_dir / "splits.parquet", index=False)
    for name in ("train", "val", "test"):
        part = df[df["split"] == name][["relpath", "class_label", "group_id"]]
        part.to_csv(out_dir / f"{name}.csv", index=False)

    classes = sorted(df[df["split"] != EXCLUDED]["class_label"].unique())
    class_map = {c: i for i, c in enumerate(classes)}
    (out_dir / "class_mapping.json").write_text(
        json.dumps(
            {
                "dataset_version": cfg.dataset_version,
                "seed": cfg.seed,
                "num_classes": len(classes),
                "class_to_idx": class_map,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    report = {
        "seed": cfg.seed,
        "dataset_version": cfg.dataset_version,
        "requested_fractions": {k: split_cfg[k]
                                for k in ("train", "val", "test")},
        "achieved": summary.to_dict(orient="records"),
        "excluded_classes_too_small": small,
        "excluded_classes_configured": excluded_classes,
        "cross_class_duplicates_dropped": int(cross_mask.sum()),
        "excluded_classes": small + sorted(excluded_classes),
        "min_images_per_class": min_per_class,
        "num_classes_modelled": len(classes),
        "group_aware_leakage": group_leak,
        "naive_leakage": naive_leak,
        "group_overlap_count": len(overlap),
        "classes_missing_from_split": missing,
        "acceptance_pass": bool(ok),
    }
    (out_dir / "split_report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8")

    if args.materialize:
        print("\nMaterializing split directories...")
        for name in ("train", "val", "test"):
            dest_root = cfg.p(name)
            for _, row in df[df["split"] == name].iterrows():
                dest = dest_root / row["class_label"] / Path(row["relpath"]).name
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(root / row["relpath"], dest)
            print(f"  {name}: {(df['split'] == name).sum():,} images -> "
                  f"{dest_root}")

    print(f"\nWrote {out_dir / 'splits.parquet'} and per-split CSVs")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
