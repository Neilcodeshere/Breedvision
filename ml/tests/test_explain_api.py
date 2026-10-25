"""The /api/explain endpoint, exercised against the real model."""

import base64
import io
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
BUNDLE = REPO / "backend" / "models" / "breedvision_classifier.pt"
pytestmark = pytest.mark.skipif(not BUNDLE.is_file(), reason="deployment bundle not built")


@pytest.fixture(scope="module")
def client():
    sys.path.insert(0, str(REPO / "backend"))
    sys.path.insert(0, str(REPO))
    from fastapi.testclient import TestClient
    import main
    with TestClient(main.app) as c:
        yield c


def _jpeg(w=320, h=400, seed=1):
    rng = np.random.default_rng(seed)
    arr = np.kron(rng.uniform(30, 230, (8, 8, 3)), np.ones((h // 8, w // 8, 1))).astype(np.uint8)
    b = io.BytesIO(); Image.fromarray(arr, "RGB").save(b, "JPEG"); return b.getvalue()


def _png(data_url):
    assert data_url.startswith("data:image/png;base64,")
    return Image.open(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1])))


def test_returns_two_224_images_and_a_7x7_grid(client):
    r = client.post("/api/explain", files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
    assert r.status_code == 200
    d = r.json()
    assert _png(d["view_png"]).size == (224, 224)
    ov = _png(d["heatmap_png"])
    assert ov.size == (224, 224) and ov.mode == "RGBA"
    assert len(d["grid"]) == 7 and all(len(row) == 7 for row in d["grid"])
    assert all(0 <= v <= 100 for row in d["grid"] for v in row)
    assert max(max(row) for row in d["grid"]) == 100        # normalised per image


def test_explains_the_same_breed_that_classify_predicts(client):
    img = _jpeg(seed=9)
    c = client.post("/api/classify", files={"file": ("a.jpg", img, "image/jpeg")}).json()
    e = client.post("/api/explain", files={"file": ("a.jpg", img, "image/jpeg")}).json()
    assert e["breed_id"] == c["breed_id"]
    assert abs(e["probability"] - c["confidence"]) < 1e-3


def test_states_its_limits_and_names_no_anatomy(client):
    d = client.post("/api/explain", files={"file": ("a.jpg", _jpeg(), "image/jpeg")}).json()
    text = (d["summary"] + " ".join(d["limits"])).lower().replace("body parts", "").replace("features", "")
    assert "regions, not body parts" in " ".join(d["limits"]).lower()
    assert "centre crop" in " ".join(d["limits"]).lower()
    for word in ("horn", "hump", "udder", "dewlap", "muzzle"):
        assert word not in text


def test_rejects_non_images_and_oversized_uploads(client):
    assert client.post("/api/explain", files={"file": ("x.txt", b"hi", "text/plain")}).status_code == 400
    assert client.post("/api/explain", files={"file": ("b.jpg", b"\xff\xd8junk", "image/jpeg")}).status_code == 400
    assert client.post("/api/explain", files={"file": ("c.jpg", b"0" * (11 * 1024 * 1024), "image/jpeg")}).status_code == 413


def test_nothing_is_stored(client):
    import main
    con = main.db()
    before = con.execute("select count(*) from detections").fetchone()[0]
    con.close()
    client.post("/api/explain", files={"file": ("a.jpg", _jpeg(), "image/jpeg")})
    con = main.db()
    after = con.execute("select count(*) from detections").fetchone()[0]
    con.close()
    assert before == after
