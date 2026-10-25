"""Exact and near-duplicate detection, and same-source group construction.

Why this module matters: if the dataset was assembled by scraping, it will
contain many near-identical frames of the *same animal*. Splitting such a
dataset at the image level leaks those frames across train/val/test and inflates
validation accuracy. We therefore cluster near-duplicates into groups and split
by group (see ``splitting.py``).

Near-duplicate search is an all-pairs Hamming comparison over perceptual
hashes, vectorised with a popcount lookup table and evaluated in row chunks to
bound memory.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image
from tqdm import tqdm

import imagehash

# popcount for every possible byte value; indexed by the XOR result.
_POPCOUNT = np.unpackbits(np.arange(256, dtype=np.uint8)[:, None], axis=1).sum(
    axis=1
).astype(np.uint16)


class UnionFind:
    """Minimal union-find used to turn pairwise links into groups."""

    def __init__(self, n: int) -> None:
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]  # path halving
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1


def compute_phashes(paths: list[Path], hash_size: int = 16, workers: int = 8,
                    show_progress: bool = True) -> np.ndarray:
    """Compute perceptual hashes as a packed ``(N, hash_size**2 / 8)`` uint8 array.

    Returns rows of all-zero bytes for images that fail to open; callers should
    already have filtered to valid images.
    """
    n_bits = hash_size * hash_size
    n_bytes = n_bits // 8

    def work(p: Path) -> np.ndarray:
        try:
            with Image.open(p) as im:
                h = imagehash.phash(im.convert("RGB"), hash_size=hash_size)
            return np.packbits(h.hash.flatten())
        except Exception:
            return np.zeros(n_bytes, dtype=np.uint8)

    out = np.zeros((len(paths), n_bytes), dtype=np.uint8)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        it = pool.map(work, paths)
        if show_progress:
            it = tqdm(it, total=len(paths), desc="phashing", unit="img")
        for i, packed in enumerate(it):
            out[i] = packed
    return out


def _pair_distances(chunk: np.ndarray, all_hashes: np.ndarray) -> np.ndarray:
    """Hamming distances between a chunk of hashes and the full set."""
    xor = np.bitwise_xor(chunk[:, None, :], all_hashes[None, :, :])
    return _POPCOUNT[xor].sum(axis=2)


def near_duplicate_pairs(hashes: np.ndarray, threshold: int,
                         chunk_size: int = 256,
                         show_progress: bool = True) -> list[tuple[int, int, int]]:
    """Find all pairs within ``threshold`` Hamming distance.

    Returns ``(i, j, distance)`` with ``i < j``.
    """
    n = len(hashes)
    pairs: list[tuple[int, int, int]] = []
    rng = range(0, n, chunk_size)
    it = tqdm(rng, desc="pairing", unit="chunk") if show_progress else rng

    for start in it:
        stop = min(start + chunk_size, n)
        dist = _pair_distances(hashes[start:stop], hashes)
        # Keep only the upper triangle to avoid duplicate/self pairs.
        rows, cols = np.where(dist <= threshold)
        for r, c in zip(rows, cols):
            i = start + int(r)
            j = int(c)
            if i < j:
                pairs.append((i, j, int(dist[r, c])))
    return pairs


def build_groups(n: int, pairs: list[tuple[int, int, int]]) -> np.ndarray:
    """Turn pairwise near-duplicate links into contiguous group ids."""
    uf = UnionFind(n)
    for i, j, _ in pairs:
        uf.union(i, j)

    roots = np.array([uf.find(i) for i in range(n)])
    # Remap arbitrary root ids to a dense 0..k-1 range, deterministically.
    _, group_ids = np.unique(roots, return_inverse=True)
    return group_ids.astype(np.int64)


def exact_duplicate_groups(df: pd.DataFrame) -> pd.DataFrame:
    """Summarise files sharing an identical sha256 content hash."""
    dupes = (
        df[df["sha256"].notna()]
        .groupby("sha256")
        .agg(
            count=("relpath", "size"),
            files=("relpath", lambda s: sorted(s)),
            classes=("class_label", lambda s: sorted(set(s))),
        )
        .reset_index()
    )
    dupes = dupes[dupes["count"] > 1]
    return dupes.sort_values("count", ascending=False, ignore_index=True)


def distance_histogram(hashes: np.ndarray, sample: int = 2000, seed: int = 42,
                       chunk_size: int = 256) -> np.ndarray:
    """Sampled pairwise-distance histogram, used to justify the threshold.

    Comparing the near-zero mode (near-duplicates) against the bulk distribution
    (unrelated images) is what makes the chosen threshold defensible rather than
    arbitrary.
    """
    n = len(hashes)
    rs = np.random.RandomState(seed)
    idx = rs.choice(n, size=min(sample, n), replace=False)
    sub = hashes[np.sort(idx)]

    counts = np.zeros(hashes.shape[1] * 8 + 1, dtype=np.int64)
    for start in range(0, len(sub), chunk_size):
        stop = min(start + chunk_size, len(sub))
        dist = _pair_distances(sub[start:stop], sub)
        for r in range(stop - start):
            row = dist[r]
            global_r = start + r
            counts += np.bincount(row[global_r + 1:], minlength=len(counts))
    return counts
