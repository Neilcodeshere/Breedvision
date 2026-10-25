"""Stage 1 -- inspect and validate every image in the raw dataset.

Writes ``metadata/inventory.parquet`` (one row per file) plus a CSV of any
invalid files. Nothing in the raw dataset is modified.

Usage:
    python ml/scripts/inspect_dataset.py [--root PATH] [--workers N]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import _bootstrap  # noqa: F401

import pandas as pd

from ml.dataset import inventory
from ml.dataset.config import ensure_dirs, load_config


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default=None)
    ap.add_argument("--root", default=None,
                    help="override the raw data root (for testing)")
    ap.add_argument("--out-dir", default=None,
                    help="override the metadata output directory")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--no-progress", action="store_true")
    args = ap.parse_args()

    cfg = load_config(args.config)
    ensure_dirs(cfg)

    root = Path(args.root) if args.root else cfg.p("raw")
    out_dir = Path(args.out_dir) if args.out_dir else cfg.p("metadata")
    out_dir.mkdir(parents=True, exist_ok=True)

    if not root.is_dir():
        print(f"ERROR: raw data root does not exist: {root}")
        return 2

    inv_cfg = cfg.section("inventory")
    print(f"Scanning: {root}")
    df = inventory.build_inventory(
        root=root,
        extensions=inv_cfg["extensions"],
        min_dimension=inv_cfg["min_dimension"],
        full_decode=inv_cfg["full_decode_check"],
        workers=args.workers,
        show_progress=not args.no_progress,
    )

    if df.empty:
        print(f"ERROR: no candidate image files found under {root}")
        print(f"Extensions searched: {inv_cfg['extensions']}")
        return 2

    summary = inventory.summarize(df)

    inv_path = out_dir / "inventory.parquet"
    df.to_parquet(inv_path, index=False)

    invalid = df[df["status"] != inventory.STATUS_OK]
    invalid_path = out_dir / "invalid_images.csv"
    invalid.to_csv(invalid_path, index=False)

    summary_path = out_dir / "inventory_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print("\n=== INVENTORY SUMMARY ===")
    for k, v in summary.items():
        print(f"  {k:>16}: {v:,}" if isinstance(v, int) else f"  {k:>16}: {v}")

    ok = df[df["status"] == inventory.STATUS_OK]
    counts = ok["class_label"].value_counts()
    if len(counts):
        print("\n=== CLASS SIZES ===")
        print(f"  classes      : {len(counts)}")
        print(f"  min          : {counts.min()}  ({counts.idxmin()})")
        print(f"  median       : {counts.median():.0f}")
        print(f"  max          : {counts.max()}  ({counts.idxmax()})")
        print(f"  imbalance    : {counts.max() / max(counts.min(), 1):.1f}x")

    if len(invalid):
        print(f"\n{len(invalid)} invalid file(s) -> {invalid_path}")
        print(invalid["status"].value_counts().to_string())

    print(f"\nWrote {inv_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
