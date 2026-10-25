"""Stage 4 -- generate figures and docs/dataset-report.md.

Every number in the generated report is read from artefacts produced by the
earlier stages. Nothing is hand-written or estimated.

Usage:
    python ml/scripts/make_report.py [--docs-dir docs]
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import _bootstrap  # noqa: F401

import numpy as np
import pandas as pd

from ml.dataset import viz
from ml.dataset.config import load_config


# Breeds that are not Indian indigenous cattle. Used only to flag a coverage
# mismatch against the dataset's own description; not a judgement on the images.
NON_INDIGENOUS = {"ayrshire", "jersey", "holstein", "friesian", "brown swiss",
                  "guernsey", "holstein friesian"}

# Recognised Indian buffalo breeds. Their absence is worth stating explicitly
# because the product scope names buffaloes alongside cattle.
BUFFALO_MARKERS = ("murrah", "jaffarabadi", "mehsana", "surti", "nili",
                   "bhadawari", "banni", "pandharpuri", "toda", "chilika")


def _quality_findings(valid: pd.DataFrame, meta: Path) -> dict:
    """Measured data-quality concerns that affect modelling decisions."""
    out: dict = {}

    df = valid.copy()
    df["short_edge"] = df[["width", "height"]].min(axis=1)
    out["short_edge_median"] = int(df["short_edge"].median())
    out["below"] = {
        t: (int((df["short_edge"] < t).sum()),
            100.0 * float((df["short_edge"] < t).mean()))
        for t in (224, 300, 380)
    }
    worst = (
        df[df["short_edge"] < 224].groupby("class_label").size()
        / df.groupby("class_label").size()
    ).dropna().sort_values(ascending=False)
    out["worst_low_res"] = [(c, 100.0 * f) for c, f in worst.head(5).items()]

    modes = df["mode"].value_counts().to_dict()
    out["non_rgb"] = {k: int(v) for k, v in modes.items() if k != "RGB"}

    classes = list(df["class_label"].unique())
    out["non_indigenous"] = sorted(
        c for c in classes if c.lower() in NON_INDIGENOUS
    )
    out["buffalo_present"] = sorted(
        c for c in classes
        if any(m in c.lower() for m in BUFFALO_MARKERS)
    )

    # Cross-class exact duplicates: the same bytes under two or more labels.
    dup_path = meta / "exact_duplicates.csv"
    if dup_path.is_file():
        d = pd.read_csv(dup_path)
        d["classes"] = d["classes"].apply(json.loads)
        cross = d[d["classes"].apply(len) > 1]
        touched: dict[str, int] = {}
        for _, r in cross.iterrows():
            for c in r["classes"]:
                touched[c] = touched.get(c, 0) + 1
        out["cross_sets"] = int(len(cross))
        out["cross_files"] = int(cross["count"].sum()) if len(cross) else 0
        out["cross_breeds_touched"] = len(touched)
        out["cross_worst"] = sorted(
            touched.items(), key=lambda kv: -kv[1]
        )[:6]
        out["cross_example"] = (
            sorted(cross["classes"].tolist(), key=len, reverse=True)[0]
            if len(cross) else []
        )
    return out


def _load_json(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}


def _fmt(n) -> str:
    return f"{n:,}" if isinstance(n, (int, np.integer)) else str(n)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--config", default=None)
    ap.add_argument("--root", default=None)
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--docs-dir", default=None)
    args = ap.parse_args()

    cfg = load_config(args.config)
    root = Path(args.root) if args.root else cfg.p("raw")
    meta = Path(args.out_dir) if args.out_dir else cfg.p("metadata")
    docs = Path(args.docs_dir) if args.docs_dir \
        else Path(__file__).resolve().parents[2] / "docs"
    figs = docs / "figures"
    figs.mkdir(parents=True, exist_ok=True)

    inv_path = meta / "inventory.parquet"
    if not inv_path.is_file():
        print(f"ERROR: {inv_path} not found. Run the earlier stages first.")
        return 2

    inv = pd.read_parquet(inv_path)
    inv_summary = _load_json(meta / "inventory_summary.json")
    dup_stats = _load_json(meta / "duplicate_stats.json")
    split_report = _load_json(meta / "split_report.json")

    splits_path = meta / "splits.parquet"
    splits = pd.read_parquet(splits_path) if splits_path.is_file() else None

    valid = inv[inv["status"] == "ok"]
    counts = valid["class_label"].value_counts()

    # --- figures ------------------------------------------------------------
    written = []
    rep_cfg = cfg.section("report")
    written.append(viz.plot_class_distribution(
        valid, figs / "class_distribution.png",
        max_classes=rep_cfg["max_classes_plotted"]))
    written.append(viz.plot_class_imbalance(
        valid, figs / "class_imbalance.png"))
    written.append(viz.plot_resolution(valid, figs / "resolution.png"))

    hist_path = meta / "phash_distance_histogram.npy"
    if hist_path.is_file():
        written.append(viz.plot_phash_distance_histogram(
            np.load(hist_path),
            threshold=cfg.section("duplicates")["phash_threshold"],
            out=figs / "phash_distances.png"))

    if splits is not None and "group_id" in splits:
        written.append(viz.plot_group_sizes(splits, figs / "group_sizes.png"))
        modelled = splits[splits["split"] != "excluded"]
        if len(modelled):
            written.append(viz.plot_split_distribution(
                modelled, figs / "split_distribution.png"))

    try:
        top_classes = counts.head(rep_cfg.get("contact_sheet_classes", 12)).index
        written.append(viz.contact_sheet(
            valid, root, figs / "samples.png", classes=list(top_classes),
            per_class=rep_cfg["samples_per_class"], seed=cfg.seed))
    except Exception as exc:
        print(f"  (contact sheet skipped: {exc})")

    # --- resolution stats ---------------------------------------------------
    res = valid.dropna(subset=["width", "height"])
    res_rows = ""
    if len(res):
        mp = (res["width"] * res["height"]) / 1e6
        res_rows = "\n".join(
            f"| {name} | {res['width'].quantile(q):.0f} x "
            f"{res['height'].quantile(q):.0f} | {mp.quantile(q):.2f} |"
            for name, q in (("min", 0.0), ("25th pct", 0.25),
                            ("median", 0.5), ("75th pct", 0.75),
                            ("max", 1.0))
        )

    # --- markdown -----------------------------------------------------------
    quality = _quality_findings(valid, meta)
    md = _render(cfg, inv, valid, counts, inv_summary, dup_stats,
                 split_report, splits, res_rows, quality)

    out = docs / "dataset-report.md"
    out.write_text(md, encoding="utf-8")

    print(f"Figures written: {len(written)}")
    for p in written:
        print(f"  {p}")
    print(f"\nReport written: {out}")
    return 0


def _render(cfg, inv, valid, counts, inv_summary, dup_stats, split_report,
            splits, res_rows, quality) -> str:
    L = []
    a = L.append

    a("# BreedVision — Dataset Report (Phase 1)\n")
    a(f"**Generated:** {date.today().isoformat()}  ")
    a(f"**Dataset version:** `{cfg.dataset_version}`  ")
    a(f"**Seed:** `{cfg.seed}`  ")
    a(f"**Source:** Kaggle `{cfg.raw['kaggle']['dataset']}`  ")
    a(f"**Raw root:** `{cfg.p('raw')}`\n")
    a("Every figure in this report is generated by `ml/scripts/`. "
      "No value is hand-entered.\n")
    a("---\n")

    a("## 1. Totals\n")
    a("| Metric | Value |")
    a("|---|---|")
    a(f"| Files discovered | {_fmt(inv_summary.get('total_files', len(inv)))} |")
    a(f"| Valid images | {_fmt(inv_summary.get('valid_images', len(valid)))} |")
    a(f"| Corrupt | {_fmt(inv_summary.get('corrupt', 0))} |")
    a(f"| Too small | {_fmt(inv_summary.get('too_small', 0))} |")
    a(f"| Unreadable | {_fmt(inv_summary.get('unreadable', 0))} |")
    a(f"| Classes | {_fmt(inv_summary.get('num_classes', 0))} |")
    a(f"| Total size | "
      f"{inv_summary.get('total_bytes', 0) / 1e9:.2f} GB |")
    a("")

    a("## 2. Class distribution\n")
    if len(counts):
        a("| Metric | Value |")
        a("|---|---|")
        a(f"| Classes | {len(counts)} |")
        a(f"| Smallest class | {counts.min()} (`{counts.idxmin()}`) |")
        a(f"| Median class size | {counts.median():.0f} |")
        a(f"| Mean class size | {counts.mean():.1f} |")
        a(f"| Largest class | {counts.max()} (`{counts.idxmax()}`) |")
        a(f"| Imbalance ratio | {counts.max() / max(counts.min(), 1):.1f}x |")
        a("")
    a("![Class distribution](figures/class_distribution.png)\n")
    a("![Class imbalance](figures/class_imbalance.png)\n")

    a("## 3. Image properties\n")
    if res_rows:
        a("| Percentile | Dimensions (W x H) | Megapixels |")
        a("|---|---|---|")
        a(res_rows)
        a("")
    fmt_counts = valid["img_format"].value_counts()
    mode_counts = valid["mode"].value_counts()
    a(f"**Formats:** " + ", ".join(
        f"`{k}` ({v:,})" for k, v in fmt_counts.items()) + "  ")
    a(f"**Colour modes:** " + ", ".join(
        f"`{k}` ({v:,})" for k, v in mode_counts.items()) + "\n")
    a("![Resolution](figures/resolution.png)\n")

    a("## 4. Duplicates and grouping\n")
    if dup_stats:
        a("| Metric | Value |")
        a("|---|---|")
        a(f"| Exact-duplicate sets | "
          f"{_fmt(dup_stats.get('exact_duplicate_sets', 0))} |")
        a(f"| Redundant files (exact) | "
          f"{_fmt(dup_stats.get('exact_redundant_files', 0))} |")
        a(f"| Identical files under >1 class | "
          f"{_fmt(dup_stats.get('exact_cross_class_sets', 0))} |")
        a(f"| pHash size / threshold | "
          f"{dup_stats.get('phash_size')} bits² / "
          f"{dup_stats.get('phash_threshold')} |")
        a(f"| Near-duplicate pairs | "
          f"{_fmt(dup_stats.get('near_duplicate_pairs', 0))} |")
        a(f"| Groups after clustering | {_fmt(dup_stats.get('groups', 0))} |")
        a(f"| Multi-image groups | "
          f"{_fmt(dup_stats.get('multi_image_groups', 0))} |")
        a(f"| Images inside multi-image groups | "
          f"{_fmt(dup_stats.get('images_in_multi_image_groups', 0))} |")
        a(f"| Largest group | {_fmt(dup_stats.get('largest_group', 0))} |")
        a("")
        a("The threshold was chosen from the sampled pairwise-distance "
          "distribution below: near-duplicates form a mode near zero, "
          "unrelated images a much broader mode. A threshold placed in the "
          "valley separates them.\n")
    a("![pHash distances](figures/phash_distances.png)\n")
    a("![Group sizes](figures/group_sizes.png)\n")

    a("## 5. Splits and leakage\n")
    if split_report:
        a(f"Requested fractions: "
          f"`{split_report.get('requested_fractions')}`  ")
        a(f"Classes modelled: **{split_report.get('num_classes_modelled')}**  ")
        small = split_report.get("excluded_classes_too_small") or []
        configured = split_report.get("excluded_classes_configured") or {}
        dropped = split_report.get("cross_class_duplicates_dropped", 0)

        if small:
            a(f"Classes excluded for having fewer than "
              f"{split_report.get('min_images_per_class')} images: "
              f"**{len(small)}** -- "
              + ", ".join("`" + c + "`" for c in small))
        if configured:
            a("Classes excluded by configuration:")
            for name, reason in configured.items():
                a(f"- `{name}` -- {' '.join(str(reason).split())}")
        if dropped:
            a(f"Images dropped for contradictory labels (an identical "
              f"file filed under more than one breed): "
              f"**{_fmt(int(dropped))}**. See section 7.1.")
        a("")

        a("| Split | Images | Fraction | Classes | Groups |")
        a("|---|---|---|---|---|")
        for row in split_report.get("achieved", []):
            a(f"| {row['split']} | {_fmt(int(row['images']))} | "
              f"{row['fraction']:.3f} | {row['classes']} | "
              f"{_fmt(int(row['groups'])) if row.get('groups') else '—'} |")
        a("")

        g = split_report.get("group_aware_leakage", {})
        n = split_report.get("naive_leakage", {})
        a("### Leakage measurement\n")
        a("This is the central result of Phase 1. Near-duplicate images "
          "straddling a split boundary inflate validation accuracy, because "
          "the model effectively sees validation images during training.\n")
        a("| Strategy | Cross-split near-duplicate pairs |")
        a("|---|---|")
        a(f"| Naive image-level split | "
          f"**{_fmt(n.get('cross_split_pairs', 0))}** |")
        a(f"| Group-aware split (production) | "
          f"**{_fmt(g.get('cross_split_pairs', 0))}** |")
        a("")
        a(f"Groups spanning more than one split: "
          f"**{split_report.get('group_overlap_count', 0)}** (must be 0)  ")
        a(f"Acceptance: "
          f"**{'PASS' if split_report.get('acceptance_pass') else 'FAIL'}**\n")

        missing = split_report.get("classes_missing_from_split") or {}
        if missing:
            a("**Classes absent from a split** (breaks per-class evaluation "
              "for those classes):\n")
            for k, v in missing.items():
                a(f"- `{k}`: {len(v)} class(es) — "
                  f"{', '.join('`' + c + '`' for c in v[:10])}"
                  + (" …" if len(v) > 10 else ""))
            a("")
    a("![Split distribution](figures/split_distribution.png)\n")

    a("## 6. Representative images\n")
    a("![Samples](figures/samples.png)\n")

    # --- data quality concerns ---------------------------------------------
    a("## 7. Data quality concerns\n")
    a("These are measured properties of the dataset that constrain what can "
      "honestly be built on it. They are not reasons to abandon it, but they "
      "must shape Phase 2 and must not be omitted from any results claim.\n")

    a("### 7.1 Contradictory labels\n")
    if quality.get("cross_sets"):
        a(f"**{quality['cross_sets']} sets of byte-identical images appear "
          f"under more than one breed label**, covering "
          f"{_fmt(quality['cross_files'])} files and touching "
          f"{quality['cross_breeds_touched']} of {len(counts)} breeds.\n")
        if quality.get("cross_example"):
            ex = ", ".join(f"`{c}`" for c in quality["cross_example"])
            a(f"The worst single case is one identical image filed under "
              f"{len(quality['cross_example'])} different breeds: {ex}. "
              f"Those labels cannot all be correct.\n")
        a("Most affected breeds:\n")
        a("| Breed | Cross-class duplicate sets |")
        a("|---|---|")
        for c, n in quality["cross_worst"]:
            a(f"| `{c}` | {n} |")
        a("")
        a("This is **demonstrated label noise, not an estimate**. It places a "
          "hard ceiling on achievable accuracy: no model can be right about an "
          "image whose ground truth contradicts itself. Grouping keeps these "
          "copies inside one split so they do not leak, but they still "
          "corrupt both the training signal and the evaluation.\n")
    else:
        a("No cross-class exact duplicates were found.\n")

    a("### 7.2 Resolution is low for standard training sizes\n")
    b = quality["below"]
    a(f"Median short edge is **{quality['short_edge_median']} px**.\n")
    a("| Threshold | Images below | Share |")
    a("|---|---|---|")
    for t in (224, 300, 380):
        n, pct = b[t]
        a(f"| short edge < {t} px | {_fmt(n)} | {pct:.1f}% |")
    a("")
    a("Worst-affected classes (share below 224 px):\n")
    for c, pct in quality["worst_low_res"]:
        a(f"- `{c}` -- {pct:.1f}%")
    a("")
    a("With most of the dataset below 224 px, training at larger input sizes "
      "would mostly upscale rather than add detail. Phase 2 should test 224 px "
      "inputs first and treat larger-input variants as an experiment to "
      "justify, not a default.\n")

    a("### 7.3 Colour modes needing conversion\n")
    if quality["non_rgb"]:
        a(", ".join(f"`{k}` ({_fmt(v)})" for k, v in quality["non_rgb"].items())
          + " -- all must be converted to RGB during preprocessing. RGBA in "
            "particular will otherwise be silently mishandled.\n")
    else:
        a("All images are RGB.\n")

    a("### 7.4 Coverage does not match the product scope\n")
    if quality["non_indigenous"]:
        a("- The dataset is described as *Indian* breeds, but includes "
          + ", ".join(f"`{c}`" for c in quality["non_indigenous"])
          + " -- not an Indian indigenous breed.")
    if not quality["buffalo_present"]:
        a(f"- **No buffalo breeds are present.** All {len(counts)} classes are "
          "cattle. The product scope names cattle *and* buffaloes; on this "
          "dataset alone, buffalo identification cannot be built or claimed. "
          "A separate buffalo dataset would be required.")
    a("")

    a("## 8. Reproduction\n")
    a("```bash")
    a("python ml/scripts/download_dataset.py")
    a("python ml/scripts/inspect_dataset.py")
    a("python ml/scripts/detect_duplicates.py")
    a("python ml/scripts/build_splits.py")
    a("python ml/scripts/make_report.py")
    a("```\n")
    a(f"All stochastic steps are seeded with `{cfg.seed}` from "
      f"`ml/config.yaml`. Re-running reproduces identical splits.\n")

    a("## 9. Limitations\n")
    a("- Near-duplicate grouping is a **proxy** for same-animal identity. The "
      "dataset carries no animal ID, so groups are inferred from perceptual "
      "similarity alone. Two photographs of the same animal from very "
      "different angles will not be grouped, so some same-animal leakage may "
      "remain. The measured cross-split count is therefore a lower bound.")
    a("- Breed labels are taken from directory names and have not been "
      "verified against an authority such as ICAR-NBAGR. Label noise is "
      "unmeasured.")
    a("- No bounding-box annotations are present, so Phase 6 cannot train a "
      "detector from this dataset (audit Risk R8).")
    a("- Class imbalance is carried into the splits by design; stratification "
      "preserves proportions rather than correcting them. Rebalancing is a "
      "Phase 2/4 modelling decision, not a dataset decision.")
    a("- Corrupt and undersized images are excluded from modelling but are "
      "retained in `inventory.parquet` for audit.")
    return "\n".join(L)


if __name__ == "__main__":
    raise SystemExit(main())
