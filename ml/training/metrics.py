"""Evaluation metrics.

Accuracy alone is not an adequate summary of a 49-class problem with 5.1x class
imbalance and known label noise, so every run reports macro and weighted F1,
per-class figures, and top-k accuracy alongside it.
"""

from __future__ import annotations

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    f1_score,
    precision_recall_fscore_support,
)


def topk_accuracy(logits: np.ndarray, labels: np.ndarray, k: int) -> float:
    """Share of samples whose true class is within the k highest scores."""
    if k >= logits.shape[1]:
        return 1.0
    topk = np.argpartition(-logits, kth=k - 1, axis=1)[:, :k]
    return float(np.mean([labels[i] in topk[i] for i in range(len(labels))]))


def summarise(
    logits: np.ndarray,
    labels: np.ndarray,
    topk: tuple[int, ...] = (1, 3, 5),
) -> dict:
    """Headline metrics for one split."""
    preds = logits.argmax(axis=1)

    precision, recall, f1, _ = precision_recall_fscore_support(
        labels, preds, average="macro", zero_division=0
    )
    out = {
        "accuracy": float(accuracy_score(labels, preds)),
        "macro_f1": float(f1_score(labels, preds, average="macro",
                                   zero_division=0)),
        "weighted_f1": float(f1_score(labels, preds, average="weighted",
                                      zero_division=0)),
        "macro_precision": float(precision),
        "macro_recall": float(recall),
        "n_samples": int(len(labels)),
    }
    for k in topk:
        out[f"top{k}_accuracy"] = topk_accuracy(logits, labels, k)
    return out


def per_class(
    logits: np.ndarray,
    labels: np.ndarray,
    idx_to_class: dict[int, str],
) -> list[dict]:
    """Per-class precision, recall, F1 and support, sorted worst-first."""
    preds = logits.argmax(axis=1)
    report = classification_report(
        labels,
        preds,
        labels=sorted(idx_to_class),
        target_names=[idx_to_class[i] for i in sorted(idx_to_class)],
        output_dict=True,
        zero_division=0,
    )
    rows = [
        {
            "class": name,
            "precision": float(vals["precision"]),
            "recall": float(vals["recall"]),
            "f1": float(vals["f1-score"]),
            "support": int(vals["support"]),
        }
        for name, vals in report.items()
        if name in set(idx_to_class.values())
    ]
    return sorted(rows, key=lambda r: r["f1"])
