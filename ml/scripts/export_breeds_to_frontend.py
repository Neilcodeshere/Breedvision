"""Generate the frontend breed list from the dataset's class mapping.

The model's classes are the single source of truth for which breeds the product
can identify. Hand-maintaining a parallel list in TypeScript guarantees drift —
and worse, invites listing breeds the model was never trained on.

This script regenerates ``web/src/services/mock/breeds.generated.ts`` from
``class_mapping.json``. Breed *names* come from the dataset. Descriptions,
characteristics and regions are deliberately left null: they must come from
ICAR-NBAGR with citations in Phase 16, not from memory.

Usage:
    python ml/scripts/export_breeds_to_frontend.py
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import _bootstrap  # noqa: F401

from ml.dataset.config import load_config

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = (
    REPO_ROOT / "web" / "src" / "services" / "mock" / "breeds.generated.ts"
)


def display_name(raw: str) -> str:
    """`Red_Sindhi` -> `Red Sindhi`; `ponwar` -> `Ponwar`."""
    words = raw.replace("_", " ").split()
    return " ".join(
        w if w[:1].isupper() else w[:1].upper() + w[1:] for w in words
    )


def slug(raw: str) -> str:
    s = raw.replace("_", "-").replace(" ", "-").lower()
    s = re.sub(r"[^a-z0-9-]", "", s)
    return re.sub(r"-+", "-", s).strip("-")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default=None)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    cfg = load_config(args.config)
    mapping_path = cfg.p("metadata") / "class_mapping.json"
    if not mapping_path.is_file():
        print(f"ERROR: {mapping_path} not found. Run build_splits.py first.")
        return 2

    mapping = json.loads(mapping_path.read_text(encoding="utf-8"))
    labels = sorted(mapping["class_to_idx"])

    slugs = [slug(name) for name in labels]
    if len(set(slugs)) != len(slugs):
        dupes = {s for s in slugs if slugs.count(s) > 1}
        print(f"ERROR: slug collision: {sorted(dupes)}")
        return 2

    entries = ",\n".join(
        f'  {{ id: "{slug(name)}", modelLabel: "{name}", '
        f'name: "{display_name(name)}" }}'
        for name in labels
    )

    out = Path(args.out) if args.out else DEFAULT_OUT
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        f"""// GENERATED FILE — do not edit by hand.
// Source: ml/scripts/export_breeds_to_frontend.py
// Regenerate after any change to the dataset's class mapping.
//
// These are the {len(labels)} classes the model is actually trained on, taken
// from `class_mapping.json` (dataset version {mapping['dataset_version']}).
//
// Every breed here is CATTLE. This dataset contains no buffalo breeds, so
// buffalo identification is out of scope until a separate dataset is sourced
// (see docs/dataset-report.md section 7.4).
//
// `name` is a display rendering of the dataset's folder label. Regions,
// descriptions and characteristics are intentionally absent — they must come
// from ICAR-NBAGR with citations, not from memory.

export interface GeneratedBreed {{
  /** URL slug. */
  id: string;
  /** Exact class label used by the model — the join key for predictions. */
  modelLabel: string;
  /** Human-readable name. */
  name: string;
}}

export const DATASET_VERSION = "{mapping['dataset_version']}";
export const NUM_CLASSES = {len(labels)};

export const GENERATED_BREEDS: GeneratedBreed[] = [
{entries},
];
""",
        encoding="utf-8",
    )

    print(f"Wrote {out}")
    print(f"  {len(labels)} classes, all cattle")
    print(f"  examples: {', '.join(display_name(n) for n in labels[:5])} ...")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
