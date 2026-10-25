"""Where did the model look? Class-evidence heat-maps for the breed classifier.

The classifier is a frozen backbone, global average pooling, feature
standardisation, then one linear layer. For that architecture Grad-CAM needs no
approximation:

    pooled_k = mean_ij F[k, i, j]                     (global average pool)
    logit_c  = b_c + sum_k W[c,k] * (pooled_k - mu_k) / sd_k
             = const_c + sum_ij M_c[i, j]
    M_c[i,j] = (1 / HW) * sum_k (W[c,k] / sd_k) * F[k, i, j]

So M_c is the exact contribution of each spatial cell to the class-c score, and
the Grad-CAM weights (mean gradient per channel) equal W[c,k] / (sd_k * HW).
`closed_form_cam` computes it directly; `autograd_cam` computes standard
Grad-CAM through autograd, and the tests require the two to agree.

What a heat-map IS: where, in the 224x224 view the model actually received,
the evidence for the predicted class came from. Positive cells support the
class; the map shown keeps only those (Grad-CAM's ReLU).

What it is NOT, and must never be presented as:
  * proof of biological reasoning (horns, hump, coat...). It shows image
    regions, not features. Nothing here names a body part.
  * a measure comparable across images: brightness is normalised per image.
  * fine-grained: the map is 7x7 cells, each ~32 px of the 224 px view.
  * the whole photo: the model sees a centre crop, so anything outside that
    crop cannot influence the prediction and is not shown.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image


@dataclass
class Explanation:
    breed_label: str
    class_index: int
    probability: float
    #: (h, w) contribution map for the class, signed, in logit units.
    contribution: np.ndarray
    #: same grid, positive part only, scaled to 0..1 for display.
    heat: np.ndarray
    #: the exact 224x224 RGB view the model received.
    crop: Image.Image
    #: how much of the total positive evidence sits in each coarse region.
    summary: str


def model_view(predictor, image: Image.Image) -> tuple[torch.Tensor, Image.Image]:
    """The tensor the model sees, and the PIL image of that same view."""
    img = image.convert("RGB")
    x = predictor.transform(img)
    # Undo normalisation only for display; the tensor itself is untouched.
    mean = torch.tensor(predictor.transform.transforms[-1].mean).view(3, 1, 1)
    std = torch.tensor(predictor.transform.transforms[-1].std).view(3, 1, 1)
    shown = (x * std + mean).clamp(0, 1).permute(1, 2, 0).numpy()
    return x.unsqueeze(0), Image.fromarray((shown * 255).round().astype(np.uint8))


@torch.inference_mode()
def feature_map(predictor, x: torch.Tensor) -> torch.Tensor:
    """Last convolutional feature map, shape (1, C, h, w)."""
    return predictor.backbone.forward_features(x.to(predictor.device))


@torch.no_grad()
def closed_form_cam(predictor, fmap: torch.Tensor, class_index: int) -> np.ndarray:
    """Exact per-cell contribution to the raw (uncalibrated) class logit."""
    w = predictor.head.weight[class_index]                       # (C,)
    sd = predictor.feature_std.reshape(-1)                       # (C,)
    hw = fmap.shape[2] * fmap.shape[3]
    coeff = (w / sd).view(1, -1, 1, 1)
    m = (fmap * coeff).sum(dim=1)[0] / hw                        # (h, w)
    return m.detach().cpu().numpy()


def autograd_cam(predictor, x: torch.Tensor, class_index: int) -> np.ndarray:
    """Standard Grad-CAM through autograd (pre-ReLU), for cross-checking."""
    fmap = predictor.backbone.forward_features(x.to(predictor.device)).detach()
    fmap.requires_grad_(True)
    pooled = fmap.mean(dim=(2, 3))
    logits = predictor.head((pooled - predictor.feature_mean) / predictor.feature_std)
    logits[0, class_index].backward()
    # d logit / d F[k,i,j] = W[c,k] / (sd_k * HW) at every cell, so the mean
    # gradient over space (Grad-CAM's channel weight) is that same value and the
    # pre-ReLU map equals the closed form exactly, with no extra scaling.
    alpha = fmap.grad.mean(dim=(2, 3), keepdim=True)
    cam = (alpha * fmap).sum(dim=1)[0]
    return cam.detach().cpu().numpy()


def _describe(heat: np.ndarray) -> str:
    """A plain-language, deliberately coarse description of where evidence sits.

    Used as the image's text alternative, so it is useful without sight. It
    names image regions only, never anatomy.
    """
    total = heat.sum()
    if total <= 0:
        return "The model found no clear region supporting this prediction."
    h, w = heat.shape
    rows = heat.sum(axis=1) / total
    cols = heat.sum(axis=0) / total
    top, mid, bot = rows[: h // 3].sum(), rows[h // 3 : h - h // 3].sum(), rows[h - h // 3 :].sum()
    left, cen, right = cols[: w // 3].sum(), cols[w // 3 : w - w // 3].sum(), cols[w - w // 3 :].sum()
    v = max((("upper", top), ("middle", mid), ("lower", bot)), key=lambda t: t[1])
    hz = max((("left", left), ("central", cen), ("right", right)), key=lambda t: t[1])
    spread = (heat > 0.5 * heat.max()).mean()
    where = f"{v[0]} {hz[0]} part of the image"
    return (
        f"Most of the evidence is in the {where}, "
        f"{'concentrated in a small area' if spread < 0.2 else 'spread over a wide area' if spread > 0.45 else 'covering a moderate area'}."
    )


def explain(predictor, image: Image.Image, class_index: int | None = None) -> Explanation:
    x, crop = model_view(predictor, image)
    fmap = feature_map(predictor, x)

    with torch.inference_mode():
        feats = fmap.mean(dim=(2, 3))
        logits = predictor.head((feats - predictor.feature_mean) / predictor.feature_std)
        probs = torch.softmax(logits / predictor.temperature, dim=1)[0]
    ci = int(probs.argmax()) if class_index is None else class_index

    m = closed_form_cam(predictor, fmap, ci)
    pos = np.maximum(m, 0.0)
    heat = pos / pos.max() if pos.max() > 0 else pos

    return Explanation(
        breed_label=predictor.idx_to_class[ci],
        class_index=ci,
        probability=float(probs[ci]),
        contribution=m,
        heat=heat,
        crop=crop,
        summary=_describe(pos),
    )


# --------------------------------------------------------------------- render

def _ramp(v: np.ndarray) -> np.ndarray:
    """Single-hue ramp (pale amber -> deep terracotta). Luminance rises with
    value, so it reads in greyscale and for colour-blind viewers, unlike a
    rainbow map."""
    lo = np.array([253, 224, 160], dtype=np.float32)
    hi = np.array([150, 52, 28], dtype=np.float32)
    return (lo + (hi - lo) * v[..., None]).astype(np.uint8)


def heatmap_rgba(heat: np.ndarray, size: int = 224, max_alpha: float = 0.85) -> Image.Image:
    """Smooth upsample of the 7x7 grid to an RGBA overlay. Weak cells are
    transparent, so unimportant regions show the photo untouched."""
    t = torch.from_numpy(heat.astype(np.float32))[None, None]
    up = F.interpolate(t, size=(size, size), mode="bilinear", align_corners=False)[0, 0].clamp(0, 1).numpy()
    rgb = _ramp(up)
    alpha = (np.clip((up - 0.15) / 0.85, 0, 1) * max_alpha * 255).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def overlay(crop: Image.Image, heat: np.ndarray) -> Image.Image:
    base = crop.convert("RGBA")
    return Image.alpha_composite(base, heatmap_rgba(heat, base.size[0])).convert("RGB")


def to_png_bytes(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()
