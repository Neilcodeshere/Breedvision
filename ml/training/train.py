"""Phase 2 -- frozen-backbone baseline across multiple architectures.

For each configured backbone: extract (and cache) pooled features for every
split, train a linear head on the cached train features, and evaluate on
validation. Test is deliberately not touched here -- it is held for Phase 3.

Every run writes a self-describing record: resolved config, dataset version,
hyperparameters, metrics, timings, model size and checkpoint path.

Usage:
    python ml/training/train.py                  # all configured backbones
    python ml/training/train.py --backbone resnet50
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ml.training import data as data_mod  # noqa: E402
from ml.training import features as feat_mod  # noqa: E402
from ml.training import metrics as metrics_mod  # noqa: E402

CONFIG_PATH = Path(__file__).resolve().parent / "config.yaml"
SPLITS = ("train", "val", "test")


def load_config(path: Path | None = None) -> dict:
    p = path or CONFIG_PATH
    return yaml.safe_load(p.read_text(encoding="utf-8"))


def set_seed(seed: int) -> None:
    import random

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def ensure_features(cfg: dict, backbone: dict, class_to_idx: dict[str, int],
                    workers: int) -> dict[str, feat_mod.FeatureSet]:
    """Return cached features per split, extracting any that are missing."""
    pre = cfg["preprocess"]
    exp = cfg["experiment"]
    features_dir = Path(cfg["paths"]["features"])
    out: dict[str, feat_mod.FeatureSet] = {}

    model = None
    extraction_meta: dict[str, float] = {}

    for split in SPLITS:
        path = feat_mod.cache_path(
            features_dir, backbone["key"], split,
            pre["image_size"], exp["dataset_version"],
        )
        if path.is_file():
            out[split] = feat_mod.load(path)
            print(f"  {split:<5} cached  ({len(out[split].labels):,} images)")
            continue

        if model is None:
            print(f"  loading backbone {backbone['timm_name']} ...", flush=True)
            model, dim = feat_mod.build_backbone(backbone["timm_name"])
            print(f"  feature dim = {dim}")

        frame = data_mod.load_split(cfg["data"]["splits_parquet"], split)
        ds = data_mod.BreedImageDataset(
            frame=frame,
            image_root=cfg["data"]["image_root"],
            class_to_idx=class_to_idx,
            transform=data_mod.build_transform(
                pre["image_size"], pre["mean"], pre["std"]),
            force_rgb=pre["force_rgb"],
        )
        print(f"  {split:<5} extracting {len(ds):,} images ...", flush=True)
        feats, labels, seconds = feat_mod.extract(
            model, ds, batch_size=32, num_workers=workers,
        )
        fs = feat_mod.FeatureSet(feats, labels, frame["relpath"].tolist())
        feat_mod.save(
            path, fs,
            {
                "backbone": backbone["timm_name"],
                "split": split,
                "image_size": pre["image_size"],
                "dataset_version": exp["dataset_version"],
                "n_images": int(len(labels)),
                "feature_dim": int(feats.shape[1]),
                "extraction_seconds": round(seconds, 2),
                "images_per_second": round(len(labels) / seconds, 2),
            },
        )
        extraction_meta[split] = seconds
        out[split] = fs
        print(f"  {split:<5} done in {seconds:,.0f}s "
              f"({len(labels)/seconds:.1f} img/s)")

    return out


def train_head(
    train_fs: feat_mod.FeatureSet,
    val_fs: feat_mod.FeatureSet,
    num_classes: int,
    head_cfg: dict,
    class_weights: torch.Tensor | None,
    seed: int,
) -> tuple[nn.Module, dict]:
    """Train a linear head on cached features. Returns model and history."""
    set_seed(seed)

    xtr = torch.from_numpy(train_fs.features)
    ytr = torch.from_numpy(train_fs.labels)
    xva = torch.from_numpy(val_fs.features)
    yva = torch.from_numpy(val_fs.labels)

    # Standardise features: the head is linear, so unscaled activations make
    # the learning rate behave very differently per backbone.
    mean = xtr.mean(dim=0, keepdim=True)
    std = xtr.std(dim=0, keepdim=True).clamp_min(1e-6)
    xtr = (xtr - mean) / std
    xva = (xva - mean) / std

    model = nn.Linear(xtr.shape[1], num_classes)
    optimiser = torch.optim.AdamW(
        model.parameters(),
        lr=head_cfg["learning_rate"],
        weight_decay=head_cfg["weight_decay"],
    )
    criterion = nn.CrossEntropyLoss(weight=class_weights)

    best = {"val_macro_f1": -1.0, "epoch": -1, "state": None}
    history = []
    patience = head_cfg["early_stopping_patience"]
    bs = head_cfg["batch_size"]
    since_improved = 0

    for epoch in range(head_cfg["epochs"]):
        model.train()
        perm = torch.randperm(len(xtr))
        total_loss = 0.0
        for i in range(0, len(xtr), bs):
            idx = perm[i:i + bs]
            optimiser.zero_grad()
            loss = criterion(model(xtr[idx]), ytr[idx])
            loss.backward()
            optimiser.step()
            total_loss += float(loss) * len(idx)

        model.eval()
        with torch.no_grad():
            val_logits = model(xva).numpy()
        m = metrics_mod.summarise(val_logits, yva.numpy())
        history.append(
            {
                "epoch": epoch,
                "train_loss": total_loss / len(xtr),
                "val_accuracy": m["accuracy"],
                "val_macro_f1": m["macro_f1"],
            }
        )

        if m["macro_f1"] > best["val_macro_f1"]:
            best = {
                "val_macro_f1": m["macro_f1"],
                "epoch": epoch,
                "state": {k: v.clone() for k, v in model.state_dict().items()},
            }
            since_improved = 0
        else:
            since_improved += 1
            if since_improved >= patience:
                print(f"    early stop at epoch {epoch} "
                      f"(no gain for {patience} epochs)")
                break

    if best["state"] is not None:
        model.load_state_dict(best["state"])

    return model, {
        "history": history,
        "best_epoch": best["epoch"],
        "feature_mean": mean,
        "feature_std": std,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default=None)
    ap.add_argument("--backbone", default=None,
                    help="run a single backbone by key")
    ap.add_argument("--workers", type=int, default=0)
    args = ap.parse_args()

    cfg = load_config(Path(args.config) if args.config else None)
    exp = cfg["experiment"]
    set_seed(exp["seed"])
    torch.set_num_threads(max(1, (torch.get_num_threads() or 4)))

    class_to_idx = data_mod.load_class_mapping(cfg["data"]["class_mapping"])
    idx_to_class = {v: k for k, v in class_to_idx.items()}
    num_classes = len(class_to_idx)

    weights = None
    if cfg["head"]["class_weighting"] == "balanced":
        weights = data_mod.balanced_class_weights(
            cfg["data"]["splits_parquet"], class_to_idx)

    backbones = cfg["backbones"]
    if args.backbone:
        backbones = [b for b in backbones if b["key"] == args.backbone]
        if not backbones:
            print(f"ERROR: no backbone with key '{args.backbone}'")
            return 2

    runs_dir = Path(cfg["paths"]["runs"])
    runs_dir.mkdir(parents=True, exist_ok=True)
    results = []

    print(f"Classes: {num_classes}   torch threads: {torch.get_num_threads()}")
    print(f"Device : cpu (no CUDA device available)\n")

    for backbone in backbones:
        print(f"=== {backbone['key']} ({backbone['timm_name']}) ===")
        t0 = time.perf_counter()
        fs = ensure_features(cfg, backbone, class_to_idx, args.workers)

        print("  training linear head ...", flush=True)
        head_t0 = time.perf_counter()
        model, info = train_head(
            fs["train"], fs["val"], num_classes, cfg["head"], weights,
            exp["seed"],
        )
        head_seconds = time.perf_counter() - head_t0

        mean, std = info["feature_mean"], info["feature_std"]
        model.eval()
        with torch.no_grad():
            val_logits = model(
                (torch.from_numpy(fs["val"].features) - mean) / std
            ).numpy()

        val_metrics = metrics_mod.summarise(
            val_logits, fs["val"].labels, tuple(cfg["eval"]["topk"]))

        run_id = f"{exp['name']}__{backbone['key']}"
        ckpt = runs_dir / f"{run_id}.pt"
        torch.save(
            {
                "head_state_dict": model.state_dict(),
                "feature_mean": mean,
                "feature_std": std,
                "class_to_idx": class_to_idx,
                "backbone_timm_name": backbone["timm_name"],
                "image_size": cfg["preprocess"]["image_size"],
            },
            ckpt,
        )

        record = {
            "run_id": run_id,
            "created_utc": datetime.now(timezone.utc).isoformat(),
            "experiment": exp["name"],
            "dataset_version": exp["dataset_version"],
            "seed": exp["seed"],
            "backbone": backbone,
            "feature_dim": fs["train"].dim,
            "num_classes": num_classes,
            "preprocess": cfg["preprocess"],
            "head": cfg["head"],
            "augmentation": "none (frozen-feature baseline)",
            "optimizer": "AdamW",
            "best_epoch": info["best_epoch"],
            "epochs_run": len(info["history"]),
            "head_train_seconds": round(head_seconds, 2),
            "total_seconds": round(time.perf_counter() - t0, 2),
            "val_metrics": val_metrics,
            "history": info["history"],
            "checkpoint": str(ckpt),
            "head_params": int(sum(p.numel() for p in model.parameters())),
            "environment": {
                "python": platform.python_version(),
                "torch": torch.__version__,
                "device": "cpu",
                "threads": torch.get_num_threads(),
            },
        }
        (runs_dir / f"{run_id}.json").write_text(
            json.dumps(record, indent=2), encoding="utf-8")
        results.append(record)

        print(f"  val acc {val_metrics['accuracy']:.4f}  "
              f"macro-F1 {val_metrics['macro_f1']:.4f}  "
              f"top-3 {val_metrics['top3_accuracy']:.4f}  "
              f"({head_seconds:.1f}s head)\n")

    print("=== SUMMARY (validation) ===")
    header = (f"{'backbone':<18}{'acc':>8}{'macroF1':>9}{'weightF1':>10}"
              f"{'top3':>8}{'top5':>8}{'dim':>6}")
    print(header)
    for r in sorted(results, key=lambda r: -r["val_metrics"]["macro_f1"]):
        m = r["val_metrics"]
        print(f"{r['backbone']['key']:<18}{m['accuracy']:>8.4f}"
              f"{m['macro_f1']:>9.4f}{m['weighted_f1']:>10.4f}"
              f"{m['top3_accuracy']:>8.4f}{m['top5_accuracy']:>8.4f}"
              f"{r['feature_dim']:>6}")

    print(f"\nRuns written to {runs_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
