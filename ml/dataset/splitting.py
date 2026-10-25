"""Train / validation / test splitting, with leakage measurement.

Two strategies are implemented deliberately:

* ``assign_groupwise_splits`` -- the production strategy. Whole near-duplicate
  groups are kept inside a single split, so no image in validation has a
  near-twin in training.
* ``assign_naive_splits`` -- an image-level stratified split, kept ONLY so the
  report can quantify how much a naive split would have leaked. It must never
  be used to produce modelling data.

Comparing the two is what turns "we avoided leakage" from an assertion into a
measured number.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold

TRAIN, VAL, TEST = "train", "val", "test"


def _folds_for_fraction(fraction: float) -> int:
    """Number of folds whose single held-out fold best matches ``fraction``."""
    if not 0.0 < fraction < 1.0:
        raise ValueError(f"fraction must be in (0, 1), got {fraction}")
    return max(2, int(round(1.0 / fraction)))


def assign_groupwise_splits(df: pd.DataFrame, train: float, val: float,
                            test: float, seed: int,
                            label_col: str = "class_label",
                            group_col: str = "group_id") -> pd.Series:
    """Assign splits keeping every group wholly within one split.

    Carves out the test set first, then the validation set from the remainder.
    Achieved fractions will not exactly equal the requested ones because groups
    are indivisible -- callers should report the achieved fractions.
    """
    labels = df[label_col].to_numpy()
    groups = df[group_col].to_numpy()
    idx = np.arange(len(df))
    out = np.array([TRAIN] * len(df), dtype=object)

    # Stage 1: hold out the test split.
    sgkf = StratifiedGroupKFold(
        n_splits=_folds_for_fraction(test), shuffle=True, random_state=seed
    )
    rest_pos, test_pos = next(sgkf.split(idx, labels, groups))
    out[idx[test_pos]] = TEST

    # Stage 2: hold out validation from what remains.
    rest_idx = idx[rest_pos]
    val_fraction_of_rest = val / (train + val)
    sgkf2 = StratifiedGroupKFold(
        n_splits=_folds_for_fraction(val_fraction_of_rest),
        shuffle=True,
        random_state=seed + 1,
    )
    _, val_pos = next(
        sgkf2.split(rest_idx, labels[rest_pos], groups[rest_pos])
    )
    out[rest_idx[val_pos]] = VAL

    return pd.Series(out, index=df.index, name="split")


def assign_naive_splits(df: pd.DataFrame, train: float, val: float, test: float,
                        seed: int, label_col: str = "class_label") -> pd.Series:
    """Image-level stratified split that ignores groups (leakage baseline)."""
    labels = df[label_col].to_numpy()
    idx = np.arange(len(df))
    out = np.array([TRAIN] * len(df), dtype=object)

    skf = StratifiedKFold(
        n_splits=_folds_for_fraction(test), shuffle=True, random_state=seed
    )
    rest_pos, test_pos = next(skf.split(idx, labels))
    out[idx[test_pos]] = TEST

    rest_idx = idx[rest_pos]
    val_fraction_of_rest = val / (train + val)
    skf2 = StratifiedKFold(
        n_splits=_folds_for_fraction(val_fraction_of_rest),
        shuffle=True,
        random_state=seed + 1,
    )
    _, val_pos = next(skf2.split(rest_idx, labels[rest_pos]))
    out[rest_idx[val_pos]] = VAL

    return pd.Series(out, index=df.index, name="split")


def count_cross_split_pairs(pairs: list[tuple[int, int, int]],
                            split_by_pos: np.ndarray) -> dict:
    """Count near-duplicate pairs that straddle two different splits.

    ``pairs`` are positional indices into the same ordering as
    ``split_by_pos``. A non-zero count means near-identical images appear on
    both sides of a split boundary -- i.e. leakage.
    """
    cross = 0
    within = 0
    by_boundary: dict[str, int] = {}
    for i, j, _ in pairs:
        si, sj = split_by_pos[i], split_by_pos[j]
        if si == sj:
            within += 1
        else:
            cross += 1
            key = "|".join(sorted((str(si), str(sj))))
            by_boundary[key] = by_boundary.get(key, 0) + 1
    return {
        "total_pairs": len(pairs),
        "within_split_pairs": within,
        "cross_split_pairs": cross,
        "by_boundary": dict(sorted(by_boundary.items())),
    }


def verify_no_group_overlap(df: pd.DataFrame, split_col: str = "split",
                            group_col: str = "group_id") -> list[int]:
    """Return group ids that appear in more than one split (should be empty)."""
    per_group = df.groupby(group_col)[split_col].nunique()
    return sorted(per_group[per_group > 1].index.tolist())


def split_summary(df: pd.DataFrame, split_col: str = "split") -> pd.DataFrame:
    """Per-split image counts, class coverage and share of the dataset."""
    total = len(df)
    rows = []
    for name in (TRAIN, VAL, TEST):
        sub = df[df[split_col] == name]
        rows.append(
            {
                "split": name,
                "images": len(sub),
                "fraction": len(sub) / total if total else 0.0,
                "classes": sub["class_label"].nunique(),
                "groups": sub["group_id"].nunique() if "group_id" in sub else None,
            }
        )
    return pd.DataFrame(rows)


def classes_missing_from_split(df: pd.DataFrame,
                               split_col: str = "split") -> dict[str, list[str]]:
    """Classes absent from each split -- these break per-class evaluation."""
    all_classes = set(df["class_label"].unique())
    missing = {}
    for name in (TRAIN, VAL, TEST):
        present = set(df[df[split_col] == name]["class_label"].unique())
        gap = sorted(all_classes - present)
        if gap:
            missing[name] = gap
    return missing
