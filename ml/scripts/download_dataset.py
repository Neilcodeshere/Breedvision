"""Download the Kaggle source dataset into the configured raw directory.

Usage:
    python ml/scripts/download_dataset.py [--force]

Requires Kaggle API credentials: either ``~/.kaggle/kaggle.json`` or the
``KAGGLE_USERNAME`` / ``KAGGLE_KEY`` environment variables.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import _bootstrap  # noqa: F401

from ml.dataset.config import ensure_dirs, load_config

CRED_HELP = """
Kaggle credentials were not found.

  1. Sign in at https://www.kaggle.com  ->  Settings  ->  API
  2. Click "Create New Token" (downloads kaggle.json)
  3. Move it to:  %USERPROFILE%\\.kaggle\\kaggle.json

Alternatively set KAGGLE_USERNAME and KAGGLE_KEY in the environment.
You must also open the dataset page once and accept its terms.
"""


def have_credentials() -> bool:
    if os.environ.get("KAGGLE_USERNAME") and os.environ.get("KAGGLE_KEY"):
        return True
    return (Path.home() / ".kaggle" / "kaggle.json").is_file()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default=None, help="path to config.yaml")
    ap.add_argument("--force", action="store_true",
                    help="re-download even if raw/ already has content")
    args = ap.parse_args()

    cfg = load_config(args.config)
    ensure_dirs(cfg)
    raw = cfg.p("raw")
    slug = cfg.raw["kaggle"]["dataset"]

    existing = [p for p in raw.rglob("*") if p.is_file()]
    if existing and not args.force:
        print(f"raw/ already contains {len(existing)} files: {raw}")
        print("Nothing to do. Re-run with --force to download again.")
        return 0

    if not have_credentials():
        print(CRED_HELP, file=sys.stderr)
        return 2

    cmd = [sys.executable, "-m", "kaggle", "datasets", "download",
           "-d", slug, "-p", str(raw), "--unzip"]
    print("Running:", " ".join(cmd))
    proc = subprocess.run(cmd)
    if proc.returncode != 0:
        print(
            f"\nKaggle download failed (exit {proc.returncode}). "
            "Common causes: dataset terms not accepted, or an invalid token.",
            file=sys.stderr,
        )
        return proc.returncode

    files = [p for p in raw.rglob("*") if p.is_file()]
    print(f"\nDownloaded {len(files)} files into {raw}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
