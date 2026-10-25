"""Dataset visualisations for the Phase 1 report.

All figures are written to disk; nothing is displayed interactively so the
scripts run headless and reproducibly.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from PIL import Image  # noqa: E402

DPI = 130


def _save(fig: plt.Figure, out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=DPI, bbox_inches="tight")
    plt.close(fig)
    return out


def plot_class_distribution(df: pd.DataFrame, out: Path,
                            max_classes: int = 0) -> Path:
    """Horizontal bar chart of images per class, sorted descending."""
    counts = df["class_label"].value_counts()
    if max_classes:
        counts = counts.head(max_classes)

    height = max(4.0, 0.26 * len(counts))
    fig, ax = plt.subplots(figsize=(9, height))
    ax.barh(counts.index[::-1], counts.values[::-1], color="#3b7dd8")
    ax.set_xlabel("Images")
    ax.set_title(f"Images per class (n={len(counts)} classes)")
    median = float(np.median(counts.values))
    ax.axvline(median, color="#d1495b", linestyle="--", linewidth=1,
               label=f"median = {median:.0f}")
    ax.legend(loc="lower right")
    ax.grid(axis="x", alpha=0.3)
    return _save(fig, out)


def plot_class_imbalance(df: pd.DataFrame, out: Path) -> Path:
    """Sorted class-size curve, which makes the imbalance shape obvious."""
    counts = df["class_label"].value_counts().sort_values(ascending=False)
    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.plot(range(1, len(counts) + 1), counts.values, marker="o", markersize=3,
            color="#3b7dd8")
    ax.set_xlabel("Class rank")
    ax.set_ylabel("Images")
    ax.set_title("Class size distribution (sorted)")
    ax.grid(alpha=0.3)
    return _save(fig, out)


def plot_resolution(df: pd.DataFrame, out: Path) -> Path:
    """Width/height scatter plus megapixel histogram."""
    sub = df.dropna(subset=["width", "height"])
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4.5))

    ax1.scatter(sub["width"], sub["height"], s=6, alpha=0.25, color="#3b7dd8")
    ax1.set_xlabel("Width (px)")
    ax1.set_ylabel("Height (px)")
    ax1.set_title("Image dimensions")
    ax1.grid(alpha=0.3)

    mp = (sub["width"] * sub["height"]) / 1e6
    ax2.hist(mp, bins=50, color="#3b7dd8")
    ax2.set_xlabel("Megapixels")
    ax2.set_ylabel("Images")
    ax2.set_title("Resolution distribution")
    ax2.grid(alpha=0.3)

    return _save(fig, out)


def plot_group_sizes(df: pd.DataFrame, out: Path) -> Path:
    """Histogram of near-duplicate group sizes."""
    sizes = df.groupby("group_id").size()
    fig, ax = plt.subplots(figsize=(8, 4.5))
    ax.hist(sizes, bins=range(1, int(sizes.max()) + 2), color="#7a5ba6",
            align="left")
    ax.set_yscale("log")
    ax.set_xlabel("Images per near-duplicate group")
    ax.set_ylabel("Groups (log scale)")
    ax.set_title(
        f"Near-duplicate group sizes "
        f"({int((sizes > 1).sum())} multi-image groups of {len(sizes)})"
    )
    ax.grid(alpha=0.3)
    return _save(fig, out)


def plot_phash_distance_histogram(counts: np.ndarray, threshold: int,
                                  out: Path) -> Path:
    """Sampled pairwise pHash distance distribution with the threshold marked.

    The near-zero mode is near-duplicates; the broad central mode is unrelated
    images. A threshold sitting in the valley between them is defensible.
    """
    fig, ax = plt.subplots(figsize=(9, 4.5))
    ax.bar(range(len(counts)), counts, color="#7a5ba6", width=1.0)
    ax.axvline(threshold, color="#d1495b", linestyle="--",
               label=f"threshold = {threshold}")
    ax.set_yscale("log")
    ax.set_xlabel("Hamming distance between perceptual hashes")
    ax.set_ylabel("Pairs (log scale)")
    ax.set_title("Sampled pairwise pHash distance distribution")
    ax.legend()
    ax.grid(alpha=0.3)
    return _save(fig, out)


def plot_split_distribution(df: pd.DataFrame, out: Path,
                            top_n: int = 30) -> Path:
    """Stacked per-class train/val/test composition for the largest classes."""
    order = df["class_label"].value_counts().head(top_n).index
    pivot = (
        df[df["class_label"].isin(order)]
        .pivot_table(index="class_label", columns="split", aggfunc="size",
                     fill_value=0)
        .reindex(order)
    )
    for col in ("train", "val", "test"):
        if col not in pivot:
            pivot[col] = 0
    pivot = pivot[["train", "val", "test"]]

    fig, ax = plt.subplots(figsize=(10, max(4.0, 0.3 * len(pivot))))
    left = np.zeros(len(pivot))
    colors = {"train": "#3b7dd8", "val": "#e9a13b", "test": "#4caf7d"}
    for col in ("train", "val", "test"):
        ax.barh(pivot.index[::-1], pivot[col].values[::-1], left=left,
                label=col, color=colors[col])
        left = left + pivot[col].values[::-1]
    ax.set_xlabel("Images")
    ax.set_title(f"Split composition (top {len(pivot)} classes)")
    ax.legend()
    ax.grid(axis="x", alpha=0.3)
    return _save(fig, out)


def contact_sheet(df: pd.DataFrame, root: Path, out: Path, classes: list[str],
                  per_class: int = 4, seed: int = 42,
                  thumb: int = 160) -> Path:
    """Grid of representative images, one row per class."""
    rs = np.random.RandomState(seed)
    rows = []
    for cls in classes:
        sub = df[df["class_label"] == cls]
        if sub.empty:
            continue
        take = sub.iloc[rs.choice(len(sub), size=min(per_class, len(sub)),
                                  replace=False)]
        rows.append((cls, take["relpath"].tolist()))

    if not rows:
        raise ValueError("no classes available for contact sheet")

    n_rows, n_cols = len(rows), per_class
    fig, axes = plt.subplots(n_rows, n_cols,
                             figsize=(n_cols * 2.1, n_rows * 2.25))
    axes = np.atleast_2d(axes)

    for r, (cls, paths) in enumerate(rows):
        for c in range(n_cols):
            ax = axes[r, c]
            ax.axis("off")
            if c < len(paths):
                try:
                    with Image.open(root / paths[c]) as im:
                        im = im.convert("RGB")
                        im.thumbnail((thumb, thumb))
                        ax.imshow(im)
                except Exception:
                    ax.text(0.5, 0.5, "unreadable", ha="center", va="center",
                            fontsize=7)
            if c == 0:
                ax.set_title(cls, fontsize=8, loc="left")

    fig.suptitle("Representative images per class", fontsize=11)
    fig.tight_layout()
    return _save(fig, out)
