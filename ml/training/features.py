"""Backbone feature extraction with on-disk caching.

Extraction is the expensive step on CPU: one forward pass over ~7,800 images per
backbone. Caching it means the three-way architecture comparison, the head
hyperparameters and Phase 3's analysis all reuse the same work instead of
repeating it.

The cache key includes the backbone, image size and dataset version, so a
config change can never silently reuse stale features.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader


@dataclass
class FeatureSet:
    features: np.ndarray  # (N, D) float32
    labels: np.ndarray    # (N,)   int64
    relpaths: list[str]

    @property
    def dim(self) -> int:
        return int(self.features.shape[1])


def cache_path(features_dir: Path, backbone_key: str, split: str,
               image_size: int, dataset_version: str) -> Path:
    return (
        Path(features_dir)
        / f"{dataset_version}_{backbone_key}_{image_size}_{split}.npz"
    )


def build_backbone(timm_name: str) -> tuple[torch.nn.Module, int]:
    """Create a pretrained backbone with its classifier removed.

    ``num_classes=0`` makes timm return pooled features, which is exactly what
    a frozen-feature baseline needs.
    """
    import timm

    model = timm.create_model(timm_name, pretrained=True, num_classes=0)
    model.eval()
    dim = int(model.num_features)
    return model, dim


@torch.inference_mode()
def extract(
    model: torch.nn.Module,
    dataset,
    batch_size: int = 32,
    num_workers: int = 0,
    device: str = "cpu",
    log_every: int = 10,
) -> tuple[np.ndarray, np.ndarray, float]:
    """Run the backbone over a dataset, returning features, labels, seconds."""
    loader = DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=False,          # order must match `dataset.frame`
        num_workers=num_workers,
        pin_memory=False,
    )
    model.to(device)

    feats: list[np.ndarray] = []
    labels: list[np.ndarray] = []
    start = time.perf_counter()

    for i, (images, targets) in enumerate(loader):
        images = images.to(device, non_blocking=False)
        out = model(images)
        feats.append(out.detach().cpu().numpy().astype(np.float32))
        labels.append(targets.numpy().astype(np.int64))
        if log_every and (i + 1) % log_every == 0:
            done = min((i + 1) * batch_size, len(dataset))
            elapsed = time.perf_counter() - start
            rate = done / elapsed if elapsed else 0.0
            print(
                f"    {done:>6,}/{len(dataset):,} images  "
                f"{rate:5.1f} img/s  eta {(len(dataset)-done)/max(rate,1e-9):5.0f}s",
                flush=True,
            )

    seconds = time.perf_counter() - start
    return np.concatenate(feats), np.concatenate(labels), seconds


def save(path: Path, fs: FeatureSet, meta: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path,
        features=fs.features,
        labels=fs.labels,
        relpaths=np.array(fs.relpaths, dtype=object),
    )
    path.with_suffix(".json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )


def load(path: Path) -> FeatureSet:
    data = np.load(path, allow_pickle=True)
    return FeatureSet(
        features=data["features"],
        labels=data["labels"],
        relpaths=list(data["relpaths"]),
    )
