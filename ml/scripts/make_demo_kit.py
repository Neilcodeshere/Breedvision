"""Pick illustrative demo photos from the test split (for the rehearsal kit).

This is for the live demo only. Nothing about the model is chosen or tuned from
it. The picks are deliberately NOT all successes: the kit includes confident-
right, uncertain, and wrong examples so the demo is honest.
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, r"C:/Users/Neil/OneDrive/Desktop/BreedVision-AI")
from ml.training import calibrate as cal, features as fm, train as tr  # noqa

cfg = tr.load_config()
run = "phase2-frozen-baseline__efficientnet_b0_ft"
logits, labels = cal.logits_for(run, cfg, "test")
class _FS: pass
fs = _FS()
fs.relpaths = list(np.load(Path(cfg["paths"]["features"]) / f"{run}_test_logits.npz", allow_pickle=True)["relpaths"])
ood = np.load(Path(cfg["paths"]["runs"]) / f"{run}__ood.npz")
tf_ = np.load(Path(cfg["paths"]["features"]) / f"{run}_test_feats.npz")["features"]
from ml.training import ood as O
ood_s = O.score(tf_, ood["class_means"], ood["precision"])
is_cattle = ood_s <= float(ood["threshold"])
p = F.softmax(logits / 0.8551, dim=1)
conf, pred = p.max(1)
conf, pred, labels = conf.numpy(), pred.numpy(), labels.numpy()
c2i = json.load(open(cfg["data"]["class_mapping"]))["class_to_idx"]
i2c = {v: k for k, v in c2i.items()}
ok = pred == labels
rng = np.random.default_rng(7)


def pick(mask, n):
    idx = np.where(mask)[0]
    return list(rng.choice(idx, size=min(n, len(idx)), replace=False))


groups = {
    "confident_right": pick((conf >= 0.85) & ok & is_cattle, 3),
    "uncertain": pick((conf >= 0.30) & (conf < 0.85) & is_cattle, 2),
    "confident_wrong": pick((conf >= 0.85) & ~ok & is_cattle, 1),
    "low": pick((conf < 0.30) & is_cattle, 1),
}
out = Path("C:/bv-data/demo")
import shutil as _sh
_sh.rmtree(out, ignore_errors=True)
out.mkdir(exist_ok=True)
manifest = []
for g, idxs in groups.items():
    for k, i in enumerate(idxs):
        src = Path(cfg["data"]["image_root"]) / fs.relpaths[i]
        dst = out / f"{g}_{k + 1}{src.suffix.lower()}"
        shutil.copy(src, dst)
        top3 = np.argsort(-p[i].numpy())[:3]
        manifest.append({
            "file": dst.name, "group": g, "true_breed": i2c[int(labels[i])],
            "predicted": i2c[int(pred[i])], "confidence": round(float(conf[i]), 3),
            "top3": [i2c[int(t)] for t in top3],
        })
(out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
for m in manifest:
    print(m)
