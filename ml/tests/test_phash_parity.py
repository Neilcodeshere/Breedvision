"""The duplicate-photo thresholds were measured with Python's imagehash. The
browser uses a TypeScript reimplementation (web/src/lib/phash-core.ts). If the
two ever disagree, the measured thresholds stop describing what ships. This test
runs the real TypeScript against Python's output and requires bit-exact hashes.

Skipped when Node is unavailable."""

import json
import shutil
import subprocess
from pathlib import Path

import imagehash
import numpy as np
import pytest
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
CORE = REPO / "web" / "src" / "lib" / "phash-core.ts"

RUNNER = """
import { readFileSync } from "node:fs";
import { phashFromGray, mirrorGray, matchDistance } from "./phash-core.ts";
const cases = JSON.parse(readFileSync(new URL("./fx.json", import.meta.url), "utf8"));
let bad = 0;
for (const c of cases) {
  if (phashFromGray(c.gray) !== c.hash) bad++;
  if (phashFromGray(mirrorGray(c.gray)) !== c.mirror) bad++;
  if (matchDistance({ hash: c.mirror, mirror: c.hash }, c.hash) !== 0) bad++;
}
console.log("MISMATCHES=" + bad + " CASES=" + cases.length);
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_typescript_hash_is_bit_exact_with_imagehash(tmp_path):
    rng = np.random.default_rng(7)
    cases = []
    for i in range(80):
        base = rng.uniform(0, 255, (4, 4))
        arr = np.kron(base, np.ones((8, 8))) + rng.normal(0, 12 if i % 2 else 3, (32, 32))
        arr = np.clip(arr, 0, 255).astype(np.uint8)
        cases.append(
            {
                "gray": arr.flatten().tolist(),
                "hash": str(imagehash.phash(Image.fromarray(arr, "L"), hash_size=8)),
                "mirror": str(
                    imagehash.phash(Image.fromarray(arr[:, ::-1].copy(), "L"), hash_size=8)
                ),
            }
        )

    shutil.copy(CORE, tmp_path / "phash-core.ts")
    (tmp_path / "fx.json").write_text(json.dumps(cases), encoding="utf-8")
    (tmp_path / "run.mts").write_text(RUNNER, encoding="utf-8")

    r = subprocess.run(
        ["node", "--experimental-strip-types", "run.mts"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )
    assert "MISMATCHES=0" in r.stdout, r.stdout + r.stderr
    assert f"CASES={len(cases)}" in r.stdout
