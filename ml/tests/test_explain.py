"""The heat-map must mean what it claims. These tests tie it to the model:
the closed form equals autograd Grad-CAM, the cells sum to the logit, and the
map describes the view the model actually received."""

from pathlib import Path

import numpy as np
import pytest
import torch
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
BUNDLE = REPO / "backend" / "models" / "breedvision_classifier.pt"

pytestmark = pytest.mark.skipif(not BUNDLE.is_file(), reason="deployment bundle not built")


@pytest.fixture(scope="module")
def predictor():
    import sys
    sys.path.insert(0, str(REPO))
    from ml.training.inference import BreedPredictor
    return BreedPredictor(BUNDLE, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])


@pytest.fixture(scope="module")
def image():
    rng = np.random.default_rng(3)
    base = rng.uniform(40, 220, (8, 8, 3))
    arr = np.kron(base, np.ones((40, 50, 1))).astype(np.uint8)
    return Image.fromarray(arr, "RGB")          # 320x400, so the centre crop discards edges


def test_pooled_feature_is_the_spatial_mean_of_the_last_map(predictor, image):
    from ml.training import explain as ex
    x, _ = ex.model_view(predictor, image)
    with torch.inference_mode():
        fmap = ex.feature_map(predictor, x)
        assert torch.allclose(predictor.backbone(x), fmap.mean(dim=(2, 3)), atol=1e-5)


def test_closed_form_equals_autograd_gradcam(predictor, image):
    from ml.training import explain as ex
    x, _ = ex.model_view(predictor, image)
    fmap = ex.feature_map(predictor, x)
    for ci in (0, 7, 30):
        a = ex.closed_form_cam(predictor, fmap, ci)
        b = ex.autograd_cam(predictor, x, ci)
        assert np.allclose(a, b, atol=1e-5), f"class {ci}: max diff {np.abs(a-b).max()}"


def test_cells_sum_to_the_class_score_up_to_a_constant(predictor, image):
    """logit_c = const_c + sum(map). The constant must not depend on the image."""
    from ml.training import explain as ex
    rng = np.random.default_rng(5)
    consts = []
    for _ in range(4):
        arr = rng.integers(0, 255, (260, 300, 3), dtype=np.uint8)
        x, _ = ex.model_view(predictor, Image.fromarray(arr, "RGB"))
        fmap = ex.feature_map(predictor, x)
        with torch.inference_mode():
            feats = fmap.mean(dim=(2, 3))
            logit = predictor.head((feats - predictor.feature_mean) / predictor.feature_std)[0, 4]
        consts.append(float(logit) - float(ex.closed_form_cam(predictor, fmap, 4).sum()))
    assert np.ptp(consts) < 1e-4


def test_explained_view_is_the_centre_crop_the_model_saw(predictor, image):
    from ml.training import explain as ex
    e = ex.explain(predictor, image)
    assert e.crop.size == (224, 224)
    assert e.heat.shape == (7, 7)
    assert 0.0 <= e.heat.min() and e.heat.max() <= 1.0
    # the crop must be a resize+centre-crop of the input, not the whole image
    assert not np.array_equal(np.asarray(e.crop.resize((224, 224))), np.asarray(image.resize((224, 224))))


def test_explanation_matches_the_prediction(predictor, image):
    from ml.training import explain as ex
    e = ex.explain(predictor, image)
    top = predictor.predict(image, top_k=1).top
    assert e.breed_label == top.breed
    assert abs(e.probability - top.probability) < 1e-4


def test_summary_names_regions_not_anatomy(predictor, image):
    from ml.training import explain as ex
    s = ex.explain(predictor, image).summary.lower()
    assert "part of the image" in s
    for word in ("horn", "hump", "coat", "ear", "leg", "face", "udder"):
        assert word not in s


def test_overlay_is_an_image_of_the_same_size(predictor, image):
    from ml.training import explain as ex
    e = ex.explain(predictor, image)
    assert ex.overlay(e.crop, e.heat).size == (224, 224)
    assert ex.heatmap_rgba(e.heat).mode == "RGBA"
