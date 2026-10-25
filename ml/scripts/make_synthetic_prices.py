"""Generate the SYNTHETIC sale-price dataset and the estimator's price anchors.

Read this before trusting any number it produces.

* The sale rows are INVENTED. No livestock price series exists for these breeds.
  Each row is a random draw around a price range taken from a breed guide (see
  ml/synthetic/price_anchors.json), so the dataset is *anchored* to published
  asking-price ranges but is not a record of any real sale.
* It can exercise the price-log screens, the history chart and the estimator.
* It CANNOT validate a price model. A model fitted to it only relearns the
  formula below, so any accuracy it reports is circular.

How a row is built (all assumptions are recorded in the output):

    price = typical(breed) x f(yield, pregnancy) x trend(month) x season x noise

    f      = (typical + per_litre*(yield - reference_yield) + pregnancy premium)
             / typical, floored at 0.4  -- the same function the website uses
    trend  = assumed 6% a year, with the last month pinned to the anchor, so the
             latest rows sit on the researched ranges (the 6% is NOT measured)
    season = assumed +-5% sine wave (NOT measured)
    noise  = lognormal, sigma = ln(high/low) / 3.29, i.e. the listed range is
             treated as roughly a 90% interval

Outputs:
    ml/synthetic/SYNTHETIC_sales.csv, ml/synthetic/README.md
    web/public/demo/synthetic-sales.json
    web/src/lib/price-anchors.generated.ts   (used by the website's estimator)

Usage:
    python ml/scripts/make_synthetic_prices.py
"""

from __future__ import annotations

import csv
import json
import math
from datetime import date
from pathlib import Path

import _bootstrap  # noqa: F401
import numpy as np

from export_breeds_to_frontend import display_name, slug
from ml.dataset.config import load_config

REPO = Path(__file__).resolve().parents[2]
ANCHORS = REPO / "ml" / "synthetic" / "price_anchors.json"
OUT_CSV = REPO / "ml" / "synthetic" / "SYNTHETIC_sales.csv"
OUT_README = REPO / "ml" / "synthetic" / "README.md"
OUT_JSON = REPO / "web" / "public" / "demo" / "synthetic-sales.json"
OUT_TS = REPO / "web" / "src" / "lib" / "price-anchors.generated.ts"

PARAMS = {
    "seed": 42,
    "start": "2021-01",
    "end": "2026-09",
    "sales_per_month": 6,
    "annual_inflation": 0.06,
    "seasonal_amplitude": 0.05,
    "milk_yield_litres_range": [2, 16],
    "pregnant_probability": 0.35,
    "age_years_range": [3, 10],
    "min_factor": 0.4,
    "note": "ALL VALUES ARE SYNTHETIC. Anchored to listed price ranges; not a market record.",
}


def typical(low: int, high: int) -> int:
    return int(round(math.sqrt(low * high), -3))


def factor(a: dict, typ: int, litres: float, pregnant: bool) -> float:
    delta = a["per_litre_inr"] * (litres - a["reference_milk_yield_litres"])
    if pregnant:
        delta += a["pregnancy_litre_equivalent"] * a["per_litre_inr"]
    return max(PARAMS["min_factor"], (typ + delta) / typ)


def main() -> int:
    a = json.loads(ANCHORS.read_text(encoding="utf-8"))
    cfg = load_config()
    mapping = json.loads(
        (cfg.p("metadata") / "class_mapping.json").read_text(encoding="utf-8")
    )
    labels = sorted(mapping["class_to_idx"])

    d = a["default"]
    anchors = {}
    for label in labels:
        b = a["breeds"].get(label)
        if b:
            lo, hi, sourced, note = b["lowInr"], b["highInr"], True, b.get("note")
        else:
            lo, hi, sourced, note = d["lowInr"], d["highInr"], False, None
        anchors[label] = {
            "id": slug(label),
            "lowInr": lo,
            "highInr": hi,
            "typicalInr": typical(lo, hi) if sourced else d["typicalInr"],
            "sourced": sourced,
            "note": note,
        }

    rng = np.random.default_rng(PARAMS["seed"])
    sy, sm = map(int, PARAMS["start"].split("-"))
    ey, em = map(int, PARAMS["end"].split("-"))
    months = [(y, m) for y in range(sy, ey + 1) for m in range(1, 13)
              if (sy, sm) <= (y, m) <= (ey, em)]
    T = len(months) - 1

    rows = []
    for t, (y, m) in enumerate(months):
        # Last month = 1.0, earlier months proportionally cheaper.
        trend = (1 + PARAMS["annual_inflation"]) ** ((t - T) / 12)
        season = 1 + PARAMS["seasonal_amplitude"] * math.sin(2 * math.pi * (m - 1) / 12)
        for k in range(PARAMS["sales_per_month"]):
            label = labels[int(rng.integers(len(labels)))]
            an = anchors[label]
            yld = float(rng.uniform(*PARAMS["milk_yield_litres_range"]))
            preg = bool(rng.random() < PARAMS["pregnant_probability"])
            age = int(rng.integers(PARAMS["age_years_range"][0], PARAMS["age_years_range"][1] + 1))
            sigma = math.log(an["highInr"] / an["lowInr"]) / 3.29
            price = (an["typicalInr"] * factor(a, an["typicalInr"], yld, preg)
                     * trend * season * math.exp(rng.normal(0, sigma)))
            day = int(rng.integers(1, 28))
            rows.append({
                "id": f"synthetic-{y}{m:02d}-{k:02d}",
                "breedId": an["id"],
                "breedName": display_name(label),
                "priceInr": max(1000, int(round(price, -2))),
                "soldOn": date(y, m, day).isoformat(),
                "milkYieldLitres": round(yld, 1),
                "pregnant": preg,
                "ageYears": age,
                "note": "SYNTHETIC - not a real sale",
                "createdAt": f"{y}-{m:02d}-{day:02d}T00:00:00.000Z",
                "source": "synthetic",
            })

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    OUT_JSON.write_text(json.dumps(rows, indent=0), encoding="utf-8")

    default_anchor = json.dumps(
        {"lowInr": d["lowInr"], "highInr": d["highInr"],
         "typicalInr": d["typicalInr"], "sourced": False, "note": None},
        indent=2,
    )
    by_id = {v["id"]: {k: v[k] for k in ("lowInr", "highInr", "typicalInr", "sourced", "note")}
             for v in anchors.values()}
    OUT_TS.write_text(
        "// GENERATED FILE - do not edit by hand.\n"
        "// Source: ml/synthetic/price_anchors.json via ml/scripts/make_synthetic_prices.py\n"
        "//\n"
        "// Indicative price anchors in rupees. Listing ranges from a breed guide read in\n"
        "// October 2026, NOT a market survey and NOT live prices. See\n"
        "// docs/price-reference.md for sources, assumptions and limits.\n\n"
        "export interface PriceAnchor {\n"
        "  lowInr: number;\n  highInr: number;\n  typicalInr: number;\n"
        "  /** True when a price source was found for this specific breed. */\n"
        "  sourced: boolean;\n  note: string | null;\n}\n\n"
        f"export const REFERENCE_DATE = {json.dumps(a['reference_date'])};\n"
        f"export const REFERENCE_MILK_YIELD_LITRES = {a['reference_milk_yield_litres']};\n"
        f"export const PER_LITRE_INR = {a['per_litre_inr']};\n"
        f"export const PREGNANCY_LITRE_EQUIVALENT_FOR_PRICE = {a['pregnancy_litre_equivalent']};\n"
        f"export const MIN_FACTOR = {PARAMS['min_factor']};\n"
        f"export const DEFAULT_ANCHOR: PriceAnchor = {default_anchor};\n"
        f"export const DEFAULT_BASIS = {json.dumps(d['basis'])};\n"
        f"export const SOURCE_TITLE = {json.dumps(a['sources']['kamdhenu']['title'])};\n"
        f"export const SOURCE_URL = {json.dumps(a['sources']['kamdhenu']['url'])};\n\n"
        "export const PRICE_ANCHORS: Record<string, PriceAnchor> = "
        + json.dumps({k: v for k, v in by_id.items() if v["sourced"]}, indent=2)
        + ";\n",
        encoding="utf-8",
    )

    OUT_README.write_text(
        "# SYNTHETIC sale prices\n\n"
        "**Not real data.** Every row is generated by "
        "`ml/scripts/make_synthetic_prices.py`.\n\n"
        "Each price is a random draw around an *indicative price range per breed* "
        "taken from a breed guide (`price_anchors.json`; sources and limits in "
        "`docs/price-reference.md`). So the rupee levels are plausible, but no row "
        "is a real sale, and the trend, seasonality and noise are assumptions.\n\n"
        "It exercises the price-log screens, the history chart and the website's "
        "estimator. It **cannot validate a price model**: a model fitted to it only "
        "relearns the generating formula, so any accuracy it reports is circular.\n\n"
        "## Parameters used\n\n```json\n"
        + json.dumps(PARAMS, indent=2)
        + "\n```\n\n## Anchors by breed\n\n```json\n"
        + json.dumps(by_id, indent=2)
        + "\n```\n",
        encoding="utf-8",
    )

    prices = np.array([r["priceInr"] for r in rows])
    print(f"rows: {len(rows)}  breeds: {len(labels)}  months: {len(months)}")
    print(f"price range: {prices.min():,} - {prices.max():,}  median {int(np.median(prices)):,}")
    sourced = sum(1 for v in anchors.values() if v["sourced"])
    print(f"breeds with a price source: {sourced} of {len(labels)}")
    print(f"wrote {OUT_CSV}\nwrote {OUT_JSON}\nwrote {OUT_TS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
