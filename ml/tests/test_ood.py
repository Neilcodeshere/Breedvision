"""The not-cattle detector's maths, on synthetic data (no model or images)."""

import numpy as np

from ml.training import ood
from ml.training.ft_logits import is_finetuned


def _clusters(n_per=200, d=16, k=3, seed=0):
    rng = np.random.default_rng(seed)
    centres = rng.normal(0, 5, size=(k, d))
    x = np.concatenate([c + rng.normal(0, 1, size=(n_per, d)) for c in centres])
    y = np.repeat(np.arange(k), n_per)
    return x.astype(np.float32), y, centres


def test_in_distribution_scores_low_and_far_points_score_high():
    x, y, centres = _clusters()
    means, precision = ood.fit_gaussian(x, y, 3)
    near = ood.score(x, means, precision)
    far = ood.score(np.full((5, 16), 40.0, dtype=np.float32), means, precision)
    assert far.min() > near.max()


def test_score_is_the_distance_to_the_nearest_class():
    x, y, centres = _clusters()
    means, precision = ood.fit_gaussian(x, y, 3)
    # A point exactly on one class mean scores about zero whatever the others are.
    s = ood.score(means[1:2], means, precision)
    assert s[0] < 1e-3


def test_means_are_the_class_averages():
    x, y, _ = _clusters()
    means, _ = ood.fit_gaussian(x, y, 3)
    for c in range(3):
        assert np.allclose(means[c], x[y == c].mean(0), atol=1e-4)


def test_fine_tuned_checkpoints_are_recognised():
    assert is_finetuned({"backbone_state_dict": {}})
    assert not is_finetuned({"head_state_dict": {}})
