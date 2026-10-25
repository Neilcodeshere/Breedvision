"""Image discovery, validation and inventory building.

Produces one record per candidate image file, capturing everything the dataset
report needs: class label, dimensions, format, byte size, content hash and a
validation status. Nothing here mutates the raw dataset.
"""

from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Sequence

import pandas as pd
from PIL import Image, ImageFile
from tqdm import tqdm

# Surface truncated files as errors instead of silently padding them, so that
# corruption is measured rather than hidden.
ImageFile.LOAD_TRUNCATED_IMAGES = False

# Validation status values.
STATUS_OK = "ok"
STATUS_CORRUPT = "corrupt"
STATUS_TOO_SMALL = "too_small"
STATUS_UNREADABLE = "unreadable"


@dataclass
class ImageRecord:
    """A single inspected image file."""

    relpath: str
    class_label: str
    filename: str
    ext: str
    status: str
    width: int | None = None
    height: int | None = None
    mode: str | None = None
    img_format: str | None = None
    bytes: int | None = None
    sha256: str | None = None
    error: str | None = None

    @property
    def megapixels(self) -> float | None:
        if self.width and self.height:
            return (self.width * self.height) / 1e6
        return None


def find_image_files(root: Path, extensions: Sequence[str]) -> list[Path]:
    """Recursively find candidate image files under ``root``.

    Matching is case-insensitive on the extension. Results are sorted so that
    downstream ordering is deterministic across runs and platforms.
    """
    exts = {e.lower() for e in extensions}
    files = [
        p
        for p in root.rglob("*")
        if p.is_file() and p.suffix.lower() in exts
    ]
    return sorted(files, key=lambda p: p.as_posix())


def infer_class_label(path: Path, root: Path) -> str:
    """Infer the class label from the directory holding the image.

    Layout assumed: ``<root>/<breed>/<image>``. Deeper nesting collapses to the
    top-level directory under ``root``, which is the usual Kaggle arrangement.
    Files sitting directly in ``root`` get the sentinel ``_unlabelled``.
    """
    rel = path.relative_to(root)
    parts = rel.parts
    if len(parts) < 2:
        return "_unlabelled"
    return parts[0]


def _sha256(path: Path, chunk_size: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()


def inspect_image(path: Path, root: Path, min_dimension: int,
                  full_decode: bool) -> ImageRecord:
    """Validate and describe one image file.

    Two-stage check: ``verify()`` catches structural damage cheaply, then a full
    ``load()`` catches truncated pixel data that ``verify()`` misses. Both are
    needed -- ``verify()`` alone passes many truncated JPEGs.
    """
    rel = path.relative_to(root).as_posix()
    rec = ImageRecord(
        relpath=rel,
        class_label=infer_class_label(path, root),
        filename=path.name,
        ext=path.suffix.lower(),
        status=STATUS_OK,
    )

    try:
        rec.bytes = path.stat().st_size
        rec.sha256 = _sha256(path)
    except OSError as exc:
        rec.status = STATUS_UNREADABLE
        rec.error = f"stat/hash failed: {exc}"
        return rec

    if rec.bytes == 0:
        rec.status = STATUS_CORRUPT
        rec.error = "zero-byte file"
        return rec

    try:
        with Image.open(path) as im:
            rec.width, rec.height = im.size
            rec.mode = im.mode
            rec.img_format = im.format
            im.verify()
    except Exception as exc:  # PIL raises a wide range of types here
        rec.status = STATUS_CORRUPT
        rec.error = f"verify failed: {type(exc).__name__}: {exc}"
        return rec

    if full_decode:
        try:
            with Image.open(path) as im:
                im.load()
        except Exception as exc:
            rec.status = STATUS_CORRUPT
            rec.error = f"decode failed: {type(exc).__name__}: {exc}"
            return rec

    if rec.width is not None and rec.height is not None:
        if min(rec.width, rec.height) < min_dimension:
            rec.status = STATUS_TOO_SMALL
            rec.error = f"min side {min(rec.width, rec.height)} < {min_dimension}"

    return rec


def build_inventory(root: Path, extensions: Sequence[str], min_dimension: int,
                    full_decode: bool = True, workers: int = 8,
                    show_progress: bool = True) -> pd.DataFrame:
    """Inspect every candidate image under ``root`` into a DataFrame."""
    files = find_image_files(root, extensions)
    if not files:
        return pd.DataFrame(columns=[f.name for f in _record_fields()])

    def work(p: Path) -> ImageRecord:
        return inspect_image(p, root, min_dimension, full_decode)

    records: list[ImageRecord] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        it: Iterable[ImageRecord] = pool.map(work, files)
        if show_progress:
            it = tqdm(it, total=len(files), desc="inspecting", unit="img")
        records.extend(it)

    df = pd.DataFrame([asdict(r) for r in records])
    # Deterministic row order regardless of thread completion order.
    return df.sort_values("relpath", ignore_index=True)


def _record_fields():
    import dataclasses

    return dataclasses.fields(ImageRecord)


def summarize(df: pd.DataFrame) -> dict:
    """Headline counts used by the report and by the console summary."""
    ok = df[df["status"] == STATUS_OK]
    return {
        "total_files": int(len(df)),
        "valid_images": int(len(ok)),
        "corrupt": int((df["status"] == STATUS_CORRUPT).sum()),
        "too_small": int((df["status"] == STATUS_TOO_SMALL).sum()),
        "unreadable": int((df["status"] == STATUS_UNREADABLE).sum()),
        "num_classes": int(ok["class_label"].nunique()) if len(ok) else 0,
        "total_bytes": int(df["bytes"].fillna(0).sum()),
    }
