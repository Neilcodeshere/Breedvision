"""Logits for a fine-tuned checkpoint.

The frozen-baseline tools (calibrate.py, test_eval.py) read cached backbone
features. A fine-tuned backbone changes those features, so its logits must come
from running the images through the fine-tuned network. This module does that
once per split and caches the result next to the feature caches.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from ml.training import data as data_mod


def is_finetuned(ckpt: dict) -> bool:
    return "backbone_state_dict" in ckpt


def logits_for_checkpoint(run: str, ckpt: dict, cfg: dict, split: str,
                          workers: int = 4):
    """Return (logits, labels) tensors for `split`, cached on disk."""
    import timm

    cache = Path(cfg["paths"]["features"]) / f"{run}_{split}_logits.npz"
    if cache.is_file():
        d = np.load(cache, allow_pickle=True)
        return torch.from_numpy(d["logits"]), torch.from_numpy(d["labels"])

    class_to_idx = ckpt["class_to_idx"]
    pre = cfg["preprocess"]
    backbone = timm.create_model(ckpt["backbone_timm_name"], pretrained=False,
                                 num_classes=0)
    backbone.load_state_dict(ckpt["backbone_state_dict"])
    head = nn.Linear(backbone.num_features, len(class_to_idx))
    head.load_state_dict(ckpt["head_state_dict"])
    backbone.eval()
    head.eval()

    ds = data_mod.BreedImageDataset(
        data_mod.load_split(cfg["data"]["splits_parquet"], split),
        cfg["data"]["image_root"], class_to_idx,
        data_mod.build_transform(pre["image_size"], pre["mean"], pre["std"]),
    )
    loader = DataLoader(ds, batch_size=64, num_workers=workers)
    mean = ckpt["feature_mean"]
    std = ckpt["feature_std"]

    outs, labs = [], []
    with torch.inference_mode():
        for x, y in loader:
            f = (backbone(x) - mean) / std
            outs.append(head(f))
            labs.append(y)
    logits = torch.cat(outs).clone()
    labels = torch.cat(labs).clone()

    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        cache,
        logits=logits.numpy(),
        labels=labels.numpy(),
        relpaths=np.array(list(ds.frame["relpath"]), dtype=object),
    )
    return logits, labels


def features_for_checkpoint(run: str, ckpt: dict, cfg: dict, split: str,
                            workers: int = 4):
    """Penultimate (pooled backbone) features for `split`, cached on disk.

    Used by the out-of-distribution check, which needs the feature space the
    classifier head reads, not its output.
    """
    import timm

    cache = Path(cfg["paths"]["features"]) / f"{run}_{split}_feats.npz"
    if cache.is_file():
        d = np.load(cache, allow_pickle=True)
        return d["features"], d["labels"]

    class_to_idx = ckpt["class_to_idx"]
    pre = cfg["preprocess"]
    backbone = timm.create_model(ckpt["backbone_timm_name"], pretrained=False,
                                 num_classes=0)
    backbone.load_state_dict(ckpt["backbone_state_dict"])
    backbone.eval()
    ds = data_mod.BreedImageDataset(
        data_mod.load_split(cfg["data"]["splits_parquet"], split),
        cfg["data"]["image_root"], class_to_idx,
        data_mod.build_transform(pre["image_size"], pre["mean"], pre["std"]),
    )
    loader = DataLoader(ds, batch_size=64, num_workers=workers)
    feats, labs = [], []
    with torch.inference_mode():
        for x, y in loader:
            feats.append(backbone(x))
            labs.append(y)
    features = torch.cat(feats).numpy()
    labels = torch.cat(labs).numpy()
    np.savez_compressed(cache, features=features, labels=labels)
    return features, labels
