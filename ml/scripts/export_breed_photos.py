"""Export a few representative photos per breed for the web breed library.

Reads the raw dataset (one folder per class), takes the class list and slugs
from the generated frontend file so the two can never drift, and writes
resized JPEGs to web/public/breeds/<slug>/{1,2,3}.jpg. Image 1 is the card and
hero photo; 2 and 3 are the gallery.

Candidates (the 150 largest files per class) are scored with the stock YOLOv8n
detector. A photo qualifies only if it has exactly one cow-class box, no person
at all, and the animal fills 20-75% of the frame; qualifying photos are ranked
by detector confidence. This keeps people, crowds and tiny far-off animals out
of a library whose job is to show what the breed looks like. Photos must also be
landscape and free of black bars (the dataset contains phone screenshots). A
class with fewer than 3 qualifying photos is topped up from the remaining
candidates and printed as LOW so it can be reviewed by hand. Only the resized outputs are
shipped, never the raw dataset.

Usage:
    python ml/scripts/export_breed_photos.py --raw C:/bv-data/raw
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from ultralytics import YOLO

REPO = Path(__file__).resolve().parents[2]
GENERATED = REPO / "web/src/services/mock/breeds.generated.ts"
OUT = REPO / "web/public/breeds"
EXTS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_SIDE = 900
CANDIDATES = 150
COW, PERSON = 19, 0
FRAME_FRACTION = (0.22, 0.65)
ASPECT = (1.25, 1.9)  # landscape only: drops phone screenshots and portraits
MIN_WIDTH = 200


def breeds() -> list[tuple[str, str]]:
    text = GENERATED.read_text(encoding="utf-8")
    return re.findall(r'id: "([^"]+)", modelLabel: "([^"]+)"', text)


def clean_frame(path: Path) -> bool:
    """Landscape, big enough, and no black letterbox bars or screenshot chrome."""
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("L")
        w, h = im.size
        if w < MIN_WIDTH or not (ASPECT[0] <= w / h <= ASPECT[1]):
            return False
        a = np.asarray(im.resize((160, int(160 * h / w))), dtype=np.float32)
    k = max(2, int(a.shape[0] * 0.06))
    strips = (a[:k], a[-k:], a[:, :k], a[:, -k:])
    # A letterbox bar is a near-black, near-flat strip along an edge.
    return not any(s.mean() < 28 and s.std() < 14 for s in strips)


def score(model: YOLO, path: Path) -> tuple[bool, float]:
    """(qualifies, confidence of the single animal box)."""
    if not clean_frame(path):
        return False, 0.0
    r = model.predict(str(path), conf=0.25, verbose=False)[0]
    cls = r.boxes.cls.tolist()
    if PERSON in cls or cls.count(COW) != 1:
        return False, 0.0
    i = cls.index(COW)
    frac = float(r.boxes.xyxyn[i][2] - r.boxes.xyxyn[i][0]) * float(
        r.boxes.xyxyn[i][3] - r.boxes.xyxyn[i][1]
    )
    conf = float(r.boxes.conf[i])
    return FRAME_FRACTION[0] <= frac <= FRAME_FRACTION[1], conf


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True, type=Path)
    args = ap.parse_args()

    model = YOLO(str(REPO / "backend/models/yolov8n.pt"))
    for slug, label in breeds():
        folder = args.raw / label
        if not folder.is_dir():
            print(f"MISSING folder for {slug}: {folder}")
            continue
        files = sorted(
            (p for p in folder.rglob("*") if p.suffix.lower() in EXTS),
            key=lambda p: (-p.stat().st_size, p.name),
        )[:CANDIDATES]
        scored = [(p, *score(model, p)) for p in files]
        good = sorted((x for x in scored if x[1]), key=lambda x: -x[2])
        rest = sorted((x for x in scored if not x[1]), key=lambda x: -x[2])
        picks = [x[0] for x in (good + rest)[:3]]
        low = len(good) < 3
        dest = OUT / slug
        dest.mkdir(parents=True, exist_ok=True)
        for i, p in enumerate(picks, 1):
            with Image.open(p) as im:
                im = ImageOps.exif_transpose(im).convert("RGB")
                im.thumbnail((MAX_SIDE, MAX_SIDE))
                im.save(dest / f"{i}.jpg", "JPEG", quality=82, optimize=True)
        print(f"{slug}: {len(good)} qualifying of {len(files)}" + ("  LOW" if low else ""))


if __name__ == "__main__":
    main()
