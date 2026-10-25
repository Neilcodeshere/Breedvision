"""Dataset and loading for Phase 2.

Splits are read from the Phase 1 manifest. Nothing here re-splits or reshuffles
the data — the group-aware assignment is the single source of truth, so a
modelling bug can never silently reintroduce leakage.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Sequence

import pandas as pd
import torch
from PIL import Image
from torch.utils.data import Dataset


class BreedImageDataset(Dataset):
    """Images for one split, labelled by the shared class mapping."""

    def __init__(
        self,
        frame: pd.DataFrame,
        image_root: Path,
        class_to_idx: dict[str, int],
        transform=None,
        force_rgb: bool = True,
    ) -> None:
        self.frame = frame.reset_index(drop=True)
        self.image_root = Path(image_root)
        self.class_to_idx = class_to_idx
        self.transform = transform
        self.force_rgb = force_rgb

    def __len__(self) -> int:
        return len(self.frame)

    def __getitem__(self, i: int):
        row = self.frame.iloc[i]
        path = self.image_root / row["relpath"]

        with Image.open(path) as im:
            # RGBA / palette / greyscale all appear in this dataset; converting
            # unconditionally avoids channel-count surprises mid-epoch.
            img = im.convert("RGB") if self.force_rgb else im
            img.load()

        if self.transform is not None:
            img = self.transform(img)

        label = self.class_to_idx[row["class_label"]]
        return img, label


def load_class_mapping(path: str | Path) -> dict[str, int]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return data["class_to_idx"]


def load_split(
    splits_parquet: str | Path,
    split: str,
) -> pd.DataFrame:
    """Return the rows for one split, in a deterministic order."""
    df = pd.read_parquet(splits_parquet)
    part = df[df["split"] == split]
    if part.empty:
        raise ValueError(f"split '{split}' is empty in {splits_parquet}")
    return part.sort_values("relpath", ignore_index=True)


def class_counts(splits_parquet: str | Path, split: str = "train") -> pd.Series:
    return load_split(splits_parquet, split)["class_label"].value_counts()


def balanced_class_weights(
    splits_parquet: str | Path,
    class_to_idx: dict[str, int],
    split: str = "train",
) -> torch.Tensor:
    """Inverse-frequency weights, normalised to mean 1.

    Class sizes span 5.1x in this dataset. Without weighting, a head can score
    respectably while barely learning the smaller breeds — which is exactly the
    failure the per-class metrics in Phase 3 are meant to expose.
    """
    counts = class_counts(splits_parquet, split)
    weights = torch.ones(len(class_to_idx), dtype=torch.float32)
    for name, idx in class_to_idx.items():
        n = int(counts.get(name, 0))
        weights[idx] = 0.0 if n == 0 else 1.0 / n
    positive = weights[weights > 0]
    if len(positive):
        weights = weights / positive.mean()
    return weights


def build_transform(image_size: int, mean: Sequence[float], std: Sequence[float]):
    """Deterministic eval-style transform.

    Phase 2 is a frozen-feature baseline, so no augmentation is applied here —
    features must be cacheable, and augmentation is the subject of Phase 4's
    controlled ablation rather than an unmeasured default.
    """
    from torchvision import transforms

    return transforms.Compose(
        [
            transforms.Resize(
                image_size, interpolation=transforms.InterpolationMode.BICUBIC
            ),
            transforms.CenterCrop(image_size),
            transforms.ToTensor(),
            transforms.Normalize(mean=list(mean), std=list(std)),
        ]
    )
