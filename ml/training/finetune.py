"""Stage 2 -- controlled fine-tuning of the last backbone blocks.

Starts from the Stage 1 result: the frozen-backbone linear head is folded into
a plain classifier so training begins at the baseline's accuracy rather than
from scratch, then the last N blocks of the backbone are unfrozen and trained
with augmentation. Earlier blocks stay frozen and run without gradients, which
is what keeps this tractable on CPU.

Model selection uses the VALIDATION split only. The test split is not read
here; it is scored separately, once, by test_eval.py.

Usage:
    python ml/training/finetune.py --backbone efficientnet_b0
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ml.training import data as data_mod  # noqa: E402
from ml.training import features as feat_mod  # noqa: E402
from ml.training import metrics as metrics_mod  # noqa: E402
from ml.training import train as train_mod  # noqa: E402


def train_transform(size: int, mean, std):
    from torchvision import transforms as T

    return T.Compose([
        T.RandomResizedCrop(size, scale=(0.5, 1.0), ratio=(0.75, 1.33),
                            interpolation=T.InterpolationMode.BICUBIC),
        T.RandomHorizontalFlip(),
        T.RandomRotation(10),
        T.ColorJitter(brightness=0.25, contrast=0.25, saturation=0.2),
        T.ToTensor(),
        T.Normalize(mean=list(mean), std=list(std)),
    ])


class Net(nn.Module):
    """EfficientNet split into a frozen prefix and a trainable tail."""

    def __init__(self, backbone: nn.Module, head: nn.Linear, n_tail: int):
        super().__init__()
        self.backbone = backbone
        self.head = head
        k = len(backbone.blocks) - n_tail
        self.k = k
        for p in backbone.parameters():
            p.requires_grad = False
        self.tail = nn.ModuleList(list(backbone.blocks[k:])
                                  + [backbone.conv_head, backbone.bn2])
        for p in self.tail.parameters():
            p.requires_grad = True

    def train(self, mode: bool = True):
        super().train(False)          # frozen prefix always in eval mode
        self.tail.train(mode)
        self.head.train(mode)
        # BatchNorm keeps its ImageNet running statistics. Batch statistics from
        # 32 mixed-breed images shift the features the folded head was fitted
        # on (measured: initial loss 0.36 -> 3.1, accuracy 92% -> 30%), so only
        # the BN affine weights train, not the statistics.
        for m in self.tail.modules():
            if isinstance(m, nn.modules.batchnorm._BatchNorm):
                m.eval()
        return self

    def forward(self, x):
        b = self.backbone
        with torch.no_grad():
            x = b.bn1(b.conv_stem(x))
            for blk in b.blocks[:self.k]:
                x = blk(x)
        for blk in b.blocks[self.k:]:
            x = blk(x)
        x = b.bn2(b.conv_head(x))
        x = b.global_pool(x)
        return self.head(x)


def folded_head(ckpt: dict, dim: int, n_classes: int) -> nn.Linear:
    """Fold feature standardisation into the linear head (exactly equivalent)."""
    w = ckpt["head_state_dict"]["weight"]
    b = ckpt["head_state_dict"]["bias"]
    mean, std = ckpt["feature_mean"].reshape(-1), ckpt["feature_std"].reshape(-1)
    head = nn.Linear(dim, n_classes)
    with torch.no_grad():
        head.weight.copy_(w / std)
        head.bias.copy_(b - (w * (mean / std)).sum(dim=1))
    return head


@torch.no_grad()
def evaluate(net: Net, loader: DataLoader):
    net.eval()
    outs, labs = [], []
    for x, y in loader:
        outs.append(net(x))
        labs.append(y)
    return torch.cat(outs).numpy(), torch.cat(labs).numpy()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backbone", default="efficientnet_b0")
    ap.add_argument("--epochs", type=int, default=None)
    ap.add_argument("--unfreeze", type=int, default=None)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--tag", default="ft")
    args = ap.parse_args()

    cfg = train_mod.load_config()
    ft = cfg["finetune"]
    epochs = args.epochs or ft["epochs"]
    n_tail = args.unfreeze or ft["unfreeze_last_n_blocks"]
    torch.set_num_threads(args.threads)
    train_mod.set_seed(cfg["experiment"]["seed"])

    bb = next(b for b in cfg["backbones"] if b["key"] == args.backbone)
    exp = cfg["experiment"]["name"]
    runs = Path(cfg["paths"]["runs"])
    base = torch.load(runs / f"{exp}__{args.backbone}.pt",
                      map_location="cpu", weights_only=False)
    class_to_idx = base["class_to_idx"]
    size = cfg["preprocess"]["image_size"]
    mean, std = cfg["preprocess"]["mean"], cfg["preprocess"]["std"]

    backbone, dim = feat_mod.build_backbone(bb["timm_name"])
    head = folded_head(base, dim, len(class_to_idx))
    net = Net(backbone, head, n_tail)

    root = cfg["data"]["image_root"]
    tr = data_mod.BreedImageDataset(
        data_mod.load_split(cfg["data"]["splits_parquet"], "train"),
        root, class_to_idx, train_transform(size, mean, std))
    va = data_mod.BreedImageDataset(
        data_mod.load_split(cfg["data"]["splits_parquet"], "val"),
        root, class_to_idx, data_mod.build_transform(size, mean, std))
    bs = ft["batch_size"]
    tr_loader = DataLoader(tr, batch_size=bs, shuffle=True, drop_last=True,
                           num_workers=args.workers, persistent_workers=True)
    va_loader = DataLoader(va, batch_size=64, num_workers=args.workers)

    weights = data_mod.balanced_class_weights(
        cfg["data"]["splits_parquet"], class_to_idx)
    criterion = nn.CrossEntropyLoss(weight=weights, label_smoothing=0.1)
    opt = torch.optim.AdamW([
        {"params": net.tail.parameters(), "lr": ft["learning_rate"]},
        {"params": net.head.parameters(), "lr": ft["learning_rate"] * 3},
    ], weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=[ft["learning_rate"], ft["learning_rate"] * 3],
        total_steps=epochs * len(tr_loader), pct_start=0.15)

    # Sanity: the folded head must reproduce the Stage 1 validation score.
    v_logits, v_labels = evaluate(net, va_loader)
    start = metrics_mod.summarise(v_logits, v_labels)
    print(f"start (folded Stage 1 head): acc {start['accuracy']:.4f} "
          f"macroF1 {start['macro_f1']:.4f}", flush=True)

    trainable = sum(p.numel() for p in net.parameters() if p.requires_grad)
    print(f"unfrozen last {n_tail} blocks; trainable params {trainable:,}; "
          f"{epochs} epochs x {len(tr_loader)} steps", flush=True)

    best = {"f1": start["macro_f1"], "epoch": -1}
    ckpt_path = runs / f"{exp}__{args.backbone}_{args.tag}.pt"
    history, patience, bad = [], 3, 0
    t_start = time.time()
    for ep in range(epochs):
        net.train()
        t0, tot = time.time(), 0.0
        for i, (x, y) in enumerate(tr_loader):
            opt.zero_grad()
            loss = criterion(net(x), y)
            loss.backward()
            opt.step()
            sched.step()
            tot += float(loss.detach())
            if i % 25 == 0:
                print(f"  ep{ep} step {i}/{len(tr_loader)} loss {float(loss):.3f}"
                      f" {time.time() - t0:.0f}s", flush=True)
        v_logits, v_labels = evaluate(net, va_loader)
        m = metrics_mod.summarise(v_logits, v_labels)
        history.append({"epoch": ep, "train_loss": tot / len(tr_loader),
                        "val_accuracy": m["accuracy"],
                        "val_macro_f1": m["macro_f1"],
                        "val_top3": m["top3_accuracy"],
                        "seconds": time.time() - t0})
        print(f"epoch {ep}: loss {tot / len(tr_loader):.3f} "
              f"val acc {m['accuracy']:.4f} macroF1 {m['macro_f1']:.4f} "
              f"top3 {m['top3_accuracy']:.4f} ({time.time() - t0:.0f}s)",
              flush=True)

        if m["macro_f1"] > best["f1"]:
            best = {"f1": m["macro_f1"], "epoch": ep}
            bad = 0
            torch.save({
                "head_state_dict": {k: v.clone() for k, v in
                                    net.head.state_dict().items()},
                "backbone_state_dict": {k: v.clone() for k, v in
                                        net.backbone.state_dict().items()},
                # Standardisation is folded into the head, so identity here.
                "feature_mean": torch.zeros(1, dim),
                "feature_std": torch.ones(1, dim),
                "class_to_idx": class_to_idx,
                "image_size": size,
                "backbone_timm_name": bb["timm_name"],
                "run_id": f"{exp}__{args.backbone}_{args.tag}",
                "val_metrics": m,
            }, ckpt_path)
        else:
            bad += 1
            if bad >= patience:
                print(f"early stop at epoch {ep}", flush=True)
                break

    record = {
        "run_id": f"{exp}__{args.backbone}_{args.tag}",
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "unfrozen_blocks": n_tail,
        "epochs_planned": epochs,
        "start_val": start,
        "best_epoch": best["epoch"],
        "best_val_macro_f1": best["f1"],
        "history": history,
        "train_seconds": time.time() - t_start,
        "note": "Selected on validation only; test split not read.",
    }
    (runs / f"{exp}__{args.backbone}_{args.tag}.json").write_text(
        json.dumps(record, indent=2), encoding="utf-8")
    print(f"\nbest epoch {best['epoch']} macroF1 {best['f1']:.4f} "
          f"(start {start['macro_f1']:.4f})", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
