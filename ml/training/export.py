"""Export a self-contained deployment bundle.

The training checkpoints are deliberately small (~265 KB): they store only the
trained head, because the frozen backbone is identical to the public ImageNet
weights and `timm` can fetch it. That is right for experimentation and wrong for
deployment -- it makes the first server start depend on network access and on
Hugging Face being reachable.

This produces one file containing everything needed to serve:

    backbone weights + head weights + feature statistics
    + class mapping + preprocessing config

Loading it constructs the architecture from `timm` code with
``pretrained=False``, so **no download occurs**. Verified with
``HF_HUB_OFFLINE=1``.

Usage:
    python ml/training/export.py --run phase2-frozen-baseline__efficientnet_b0
    python ml/training/export.py --run <id> --out backend/models/breedvision_classifier.pt
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import torch

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ml.training import features as feat_mod  # noqa: E402
from ml.training import train as train_mod  # noqa: E402

BUNDLE_FORMAT = 1


def export(run_id: str, cfg: dict, out: Path) -> dict:
    runs_dir = Path(cfg["paths"]["runs"])
    ckpt_path = runs_dir / f"{run_id}.pt"
    record_path = runs_dir / f"{run_id}.json"

    if not ckpt_path.is_file():
        raise FileNotFoundError(f"checkpoint not found: {ckpt_path}")

    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    timm_name = ckpt["backbone_timm_name"]

    # Building with pretrained=True here is intentional: this is the one moment
    # the weights are fetched, so that serving never has to.
    if "backbone_state_dict" in ckpt:
        # Fine-tuned run: the trained backbone weights travel with the
        # checkpoint, so nothing is fetched and nothing is re-initialised.
        import timm

        print(f"using fine-tuned backbone {timm_name} from the checkpoint",
              flush=True)
        backbone = timm.create_model(timm_name, pretrained=False, num_classes=0)
        backbone.load_state_dict(ckpt["backbone_state_dict"])
        dim = int(backbone.num_features)
    else:
        print(f"materialising backbone {timm_name} ...", flush=True)
        backbone, dim = feat_mod.build_backbone(timm_name)

    metrics = {}
    if record_path.is_file():
        rec = json.loads(record_path.read_text(encoding="utf-8"))
        metrics = rec.get("val_metrics", {})
    if not metrics:
        metrics = ckpt.get("val_metrics", {})

    # Calibration is optional: a bundle exported before calibrate.py was run
    # simply carries T = 1.0 and no thresholds, and the service says so.
    calib_path = runs_dir / f"{run_id}__calibration.json"
    temperature, thresholds = 1.0, None
    if calib_path.is_file():
        cal = json.loads(calib_path.read_text(encoding="utf-8"))
        temperature = float(cal["temperature_full_validation"])
        d = cal["derived"]
        if d.get("confident") is not None and d.get("low_below") is not None:
            thresholds = {
                "confident": float(d["confident"]),
                "low_below": float(d["low_below"]),
                "target_confident_accuracy": cal["targets"]["confident_accuracy"],
                "basis": "validation, 5-fold cross-fitted; not tuned on the test split",
            }

    # Optional "does this look like cattle?" detector (ml/training/ood.py).
    ood = None
    ood_path = runs_dir / f"{run_id}__ood.npz"
    if ood_path.is_file():
        import numpy as np

        z = np.load(ood_path)
        ood = {
            "class_means": torch.from_numpy(z["class_means"]),
            "precision": torch.from_numpy(z["precision"]),
            "threshold": float(z["threshold"]),
        }

    pre = cfg["preprocess"]
    bundle = {
        "ood": ood,
        "temperature": temperature,
        "thresholds": thresholds,
        "bundle_format": BUNDLE_FORMAT,
        "run_id": run_id,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "backbone_timm_name": timm_name,
        "feature_dim": dim,
        # The whole point: weights travel with the bundle.
        "backbone_state_dict": backbone.state_dict(),
        "head_state_dict": ckpt["head_state_dict"],
        "feature_mean": ckpt["feature_mean"],
        "feature_std": ckpt["feature_std"],
        "class_to_idx": ckpt["class_to_idx"],
        "image_size": ckpt["image_size"],
        "preprocess": {
            "image_size": pre["image_size"],
            "mean": pre["mean"],
            "std": pre["std"],
        },
        # Carried so a deployed service can report what it is serving, and so
        # nobody has to guess which experiment a file came from.
        "dataset_version": cfg["experiment"]["dataset_version"],
        "val_metrics": metrics,
        "notes": (
            "Self-contained: constructs the architecture with pretrained=False "
            "and loads these weights. No network access required."
        ),
    }

    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save(bundle, out)

    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    size_mb = out.stat().st_size / (1024 * 1024)

    manifest = {
        "file": out.name,
        "run_id": run_id,
        "bundle_format": BUNDLE_FORMAT,
        "backbone": timm_name,
        "num_classes": len(ckpt["class_to_idx"]),
        "image_size": ckpt["image_size"],
        "dataset_version": bundle["dataset_version"],
        "size_mb": round(size_mb, 2),
        "sha256": digest,
        "temperature": temperature,
        "thresholds": thresholds,
        "val_metrics": metrics,
        "created_utc": bundle["created_utc"],
    }
    out.with_suffix(".json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")

    return manifest


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run", required=True, help="run id to export")
    ap.add_argument("--config", default=None)
    ap.add_argument("--out", default=None,
                    help="output path (default: backend/models/"
                         "breedvision_classifier.pt)")
    args = ap.parse_args()

    cfg = train_mod.load_config(Path(args.config) if args.config else None)
    out = Path(args.out) if args.out else (
        REPO_ROOT / "backend" / "models" / "breedvision_classifier.pt"
    )

    manifest = export(args.run, cfg, out)

    print(f"\nWrote {out}")
    for k in ("backbone", "num_classes", "image_size", "size_mb", "sha256"):
        print(f"  {k:<14}: {manifest[k]}")
    if manifest["val_metrics"]:
        m = manifest["val_metrics"]
        print(f"  {'val accuracy':<14}: {m.get('accuracy'):.4f}")
        print(f"  {'val top-3':<14}: {m.get('top3_accuracy'):.4f}")
    print("\nThis bundle needs no network at load time.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
