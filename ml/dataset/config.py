"""Configuration loading for the BreedVision dataset pipeline.

Every script reads paths, seeds and thresholds from here so that no value is
duplicated across the codebase (Engineering Principle 6).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

# ml/dataset/config.py -> ml/ -> repo root
ML_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = ML_DIR.parent
DEFAULT_CONFIG_PATH = ML_DIR / "config.yaml"


@dataclass(frozen=True)
class Config:
    """Parsed pipeline configuration."""

    raw: dict[str, Any]
    path: Path

    # -- convenience accessors ------------------------------------------------

    @property
    def seed(self) -> int:
        return int(self.raw["seed"])

    @property
    def dataset_version(self) -> str:
        return str(self.raw["project"]["dataset_version"])

    def paths(self) -> dict[str, Path]:
        return {k: Path(v) for k, v in self.raw["paths"].items()}

    def p(self, key: str) -> Path:
        """Return a configured path by key, e.g. ``cfg.p("raw")``."""
        return Path(self.raw["paths"][key])

    def section(self, name: str) -> dict[str, Any]:
        return dict(self.raw[name])


def load_config(path: str | os.PathLike[str] | None = None) -> Config:
    """Load ``ml/config.yaml`` (or an explicit override path)."""
    cfg_path = Path(path) if path is not None else DEFAULT_CONFIG_PATH
    if not cfg_path.is_file():
        raise FileNotFoundError(f"Config not found: {cfg_path}")
    with cfg_path.open("r", encoding="utf-8") as fh:
        raw = yaml.safe_load(fh)

    _validate(raw, cfg_path)
    return Config(raw=raw, path=cfg_path)


def _validate(raw: dict[str, Any], cfg_path: Path) -> None:
    """Fail fast on a malformed config rather than deep inside a long run."""
    for key in ("project", "paths", "seed", "inventory", "duplicates", "split"):
        if key not in raw:
            raise ValueError(f"{cfg_path}: missing top-level key '{key}'")

    split = raw["split"]
    total = split["train"] + split["val"] + split["test"]
    if abs(total - 1.0) > 1e-9:
        raise ValueError(
            f"{cfg_path}: split fractions must sum to 1.0, got {total:.6f}"
        )
    for name in ("train", "val", "test"):
        if not 0.0 < split[name] < 1.0:
            raise ValueError(f"{cfg_path}: split.{name} must be in (0, 1)")

    if raw["duplicates"]["phash_threshold"] < 0:
        raise ValueError(f"{cfg_path}: duplicates.phash_threshold must be >= 0")


def ensure_dirs(cfg: Config) -> None:
    """Create every configured directory if missing."""
    for p in cfg.paths().values():
        p.mkdir(parents=True, exist_ok=True)
