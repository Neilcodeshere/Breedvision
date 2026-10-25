"""End-to-end tests for the Phase 1 dataset pipeline.

These run the real scripts against a synthetic dataset whose defects are known
in advance, then assert the pipeline found exactly those defects. That is what
distinguishes "the pipeline ran" from "the pipeline works".

Run:
    python -m pytest ml/tests -v
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from ml.dataset import hashing, inventory, splitting  # noqa: E402
from ml.dataset.config import load_config  # noqa: E402
from ml.tests.make_fixture import build as build_fixture  # noqa: E402

SCRIPTS = REPO_ROOT / "ml" / "scripts"


def _run(script: str, *args: str) -> subprocess.CompletedProcess:
    cmd = [sys.executable, str(SCRIPTS / script), *args]
    return subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT)


# The production `phash_threshold` in ml/config.yaml is calibrated on the real
# Kaggle dataset, whose unrelated-pair distances sit much closer to zero than
# this synthetic fixture's. Pinning the fixture to its own threshold keeps these
# tests a check on *pipeline behaviour* rather than a check on a value that is
# rightly tuned elsewhere. See docs/dataset-report.md section 7 for the sweep.
FIXTURE_PHASH_THRESHOLD = 13


def _fixture_config(base: Path) -> Path:
    """Copy the real config, overriding only the fixture-specific threshold."""
    import yaml

    cfg = yaml.safe_load(
        (REPO_ROOT / "ml" / "config.yaml").read_text(encoding="utf-8")
    )
    cfg["duplicates"]["phash_threshold"] = FIXTURE_PHASH_THRESHOLD
    path = base / "fixture-config.yaml"
    path.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    return path


@pytest.fixture(scope="module")
def pipeline(tmp_path_factory):
    """Build the fixture and run all four stages once for the whole module."""
    base = tmp_path_factory.mktemp("bv")
    root, meta, docs = base / "fixture", base / "meta", base / "docs"
    truth = build_fixture(root)
    meta.mkdir()

    config = _fixture_config(base)
    common = ["--config", str(config), "--root", str(root),
              "--out-dir", str(meta)]
    r1 = _run("inspect_dataset.py", *common, "--no-progress")
    assert r1.returncode == 0, r1.stdout + r1.stderr
    r2 = _run("detect_duplicates.py", *common, "--no-progress")
    assert r2.returncode == 0, r2.stdout + r2.stderr
    r3 = _run("build_splits.py", *common)
    assert r3.returncode == 0, r3.stdout + r3.stderr
    r4 = _run("make_report.py", *common, "--docs-dir", str(docs))
    assert r4.returncode == 0, r4.stdout + r4.stderr

    return {
        "root": root, "meta": meta, "docs": docs, "truth": truth,
        "config": config,
        "inventory": pd.read_parquet(meta / "inventory.parquet"),
        "groups": pd.read_parquet(meta / "groups.parquet"),
        "splits": pd.read_parquet(meta / "splits.parquet"),
        "inv_summary": json.loads(
            (meta / "inventory_summary.json").read_text(encoding="utf-8")),
        "dup_stats": json.loads(
            (meta / "duplicate_stats.json").read_text(encoding="utf-8")),
        "split_report": json.loads(
            (meta / "split_report.json").read_text(encoding="utf-8")),
    }


# --- Stage 1: inventory ------------------------------------------------------

def test_finds_every_file(pipeline):
    assert pipeline["inv_summary"]["total_files"] == \
        pipeline["truth"]["expected_total_files"]


def test_detects_exactly_the_planted_corrupt_files(pipeline):
    inv = pipeline["inventory"]
    found = set(inv[inv["status"] == inventory.STATUS_CORRUPT]["relpath"])
    assert found == set(pipeline["truth"]["corrupt_files"])


def test_detects_truncated_jpeg(pipeline):
    """Header-only validation passes truncated JPEGs; full decode must not."""
    inv = pipeline["inventory"]
    row = inv[inv["relpath"] == "Sahiwal/corrupt_truncated.jpg"].iloc[0]
    assert row["status"] == inventory.STATUS_CORRUPT


def test_detects_exactly_the_planted_undersized_files(pipeline):
    inv = pipeline["inventory"]
    found = set(inv[inv["status"] == inventory.STATUS_TOO_SMALL]["relpath"])
    assert found == set(pipeline["truth"]["too_small_files"])


def test_class_count(pipeline):
    assert pipeline["inv_summary"]["num_classes"] == \
        len(pipeline["truth"]["classes"])


# --- Stage 2: duplicates and grouping ---------------------------------------

def test_finds_planted_exact_duplicates(pipeline):
    assert pipeline["dup_stats"]["exact_redundant_files"] == \
        len(pipeline["truth"]["exact_duplicate_files"])


def test_groups_match_planted_families(pipeline):
    """The calibrated threshold must recover the planted family count."""
    assert pipeline["dup_stats"]["groups"] == \
        pipeline["truth"]["near_dup_families"]


def test_no_group_collapse(pipeline):
    """Guard against a too-loose threshold merging everything into one group."""
    stats = pipeline["dup_stats"]
    assert stats["largest_group"] < stats["valid_images"] * 0.25


# --- Stage 3: splitting and leakage -----------------------------------------

def test_groupwise_split_has_zero_leakage(pipeline):
    """The central Phase 1 guarantee."""
    assert pipeline["split_report"]["group_aware_leakage"][
        "cross_split_pairs"] == 0


def test_no_group_spans_multiple_splits(pipeline):
    assert pipeline["split_report"]["group_overlap_count"] == 0


def test_naive_split_does_leak(pipeline):
    """If this ever hits zero the fixture stopped exercising the risk."""
    assert pipeline["split_report"]["naive_leakage"]["cross_split_pairs"] > 0


def test_undersized_classes_excluded(pipeline):
    assert "RareBreed" in pipeline["split_report"]["excluded_classes"]


def test_split_fractions_near_requested(pipeline):
    """Groups are indivisible, so allow drift but not drastic imbalance."""
    for row in pipeline["split_report"]["achieved"]:
        want = pipeline["split_report"]["requested_fractions"][row["split"]]
        assert abs(row["fraction"] - want) < 0.08, row


def test_every_modelled_class_present_in_every_split(pipeline):
    splits = pipeline["splits"]
    modelled = splits[splits["split"] != "excluded"]
    per_split = modelled.groupby("split")["class_label"].nunique()
    assert per_split.nunique() == 1, per_split.to_dict()


def test_acceptance_flag(pipeline):
    assert pipeline["split_report"]["acceptance_pass"] is True


# --- Stage 4: report ---------------------------------------------------------

def test_report_and_figures_written(pipeline):
    docs = pipeline["docs"]
    assert (docs / "dataset-report.md").is_file()
    for fig in ("class_distribution.png", "resolution.png",
                "phash_distances.png", "group_sizes.png",
                "split_distribution.png", "samples.png"):
        assert (docs / "figures" / fig).is_file(), fig


def test_report_contains_leakage_numbers(pipeline):
    text = (pipeline["docs"] / "dataset-report.md").read_text(encoding="utf-8")
    assert "Leakage measurement" in text
    assert "Group-aware split" in text


# --- Reproducibility ---------------------------------------------------------

def test_splits_are_deterministic(pipeline):
    """Re-running the split stage must reproduce identical assignments."""
    meta = pipeline["meta"]
    before = pd.read_parquet(meta / "splits.parquet")
    r = _run("build_splits.py", "--config", str(pipeline["config"]),
             "--root", str(pipeline["root"]), "--out-dir", str(meta))
    assert r.returncode == 0, r.stdout + r.stderr
    after = pd.read_parquet(meta / "splits.parquet")
    assert before.equals(after)


# --- Unit-level checks -------------------------------------------------------

def test_union_find_builds_connected_components():
    pairs = [(0, 1, 0), (1, 2, 0), (5, 6, 0)]
    gids = hashing.build_groups(8, pairs)
    assert gids[0] == gids[1] == gids[2]
    assert gids[5] == gids[6]
    assert gids[0] != gids[3] != gids[5]
    assert len(set(gids.tolist())) == 5


def test_cross_split_counter():
    import numpy as np
    pairs = [(0, 1, 3), (1, 2, 4), (2, 3, 5)]
    split_by_pos = np.array(["train", "train", "val", "val"])
    out = splitting.count_cross_split_pairs(pairs, split_by_pos)
    assert out["cross_split_pairs"] == 1
    assert out["within_split_pairs"] == 2


def test_config_rejects_bad_split_fractions(tmp_path):
    import yaml
    cfg = yaml.safe_load((REPO_ROOT / "ml" / "config.yaml").read_text(
        encoding="utf-8"))
    cfg["split"]["train"] = 0.9  # now sums to 1.2
    p = tmp_path / "bad.yaml"
    p.write_text(yaml.safe_dump(cfg), encoding="utf-8")
    with pytest.raises(ValueError, match="sum to 1.0"):
        load_config(p)
