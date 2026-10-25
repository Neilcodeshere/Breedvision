// GENERATED FILE - do not edit by hand.
// Source: ml/synthetic/price_anchors.json via ml/scripts/make_synthetic_prices.py
//
// Indicative price anchors in rupees. Listing ranges from a breed guide read in
// October 2026, NOT a market survey and NOT live prices. See
// docs/price-reference.md for sources, assumptions and limits.

export interface PriceAnchor {
  lowInr: number;
  highInr: number;
  typicalInr: number;
  /** True when a price source was found for this specific breed. */
  sourced: boolean;
  note: string | null;
}

export const REFERENCE_DATE = "2026-10";
export const REFERENCE_MILK_YIELD_LITRES = 6;
export const PER_LITRE_INR = 4000;
export const PREGNANCY_LITRE_EQUIVALENT_FOR_PRICE = 1.548;
export const MIN_FACTOR = 0.4;
export const DEFAULT_ANCHOR: PriceAnchor = {
  "lowInr": 40000,
  "highInr": 90000,
  "typicalInr": 60000,
  "sourced": false,
  "note": null
};
export const DEFAULT_BASIS = "No price source was found for this breed. This is the general desi-cow range: the median of the typical values of the breeds that do have a listed range, with the Tharparkar/Rathi range as its bounds.";
export const SOURCE_TITLE = "Desi Cow Milk Per Day: 13 Indian Breeds Compared (2026), Kamdhenu Gauveda Team, 3 Oct 2026";
export const SOURCE_URL = "https://kamdhenugauveda.com/desi-cow-milk-per-day/";

export const PRICE_ANCHORS: Record<string, PriceAnchor> = {
  "gir": {
    "lowInr": 50000,
    "highInr": 150000,
    "typicalInr": 87000,
    "sourced": true,
    "note": "Pedigree animals above 2,00,000."
  },
  "hariana": {
    "lowInr": 35000,
    "highInr": 80000,
    "typicalInr": 53000,
    "sourced": true,
    "note": null
  },
  "kankrej": {
    "lowInr": 35000,
    "highInr": 80000,
    "typicalInr": 53000,
    "sourced": true,
    "note": null
  },
  "ongole": {
    "lowInr": 35000,
    "highInr": 80000,
    "typicalInr": 53000,
    "sourced": true,
    "note": "Ongole is mainly a draught breed; show and export animals sell far higher."
  },
  "punganur": {
    "lowInr": 50000,
    "highInr": 150000,
    "typicalInr": 87000,
    "sourced": true,
    "note": "Show animals sell far higher."
  },
  "rathi": {
    "lowInr": 40000,
    "highInr": 90000,
    "typicalInr": 60000,
    "sourced": true,
    "note": "One dealer-guide figure for Rathi alone is 45,000 to 60,000."
  },
  "red-sindhi": {
    "lowInr": 40000,
    "highInr": 100000,
    "typicalInr": 63000,
    "sourced": true,
    "note": null
  },
  "sahiwal": {
    "lowInr": 50000,
    "highInr": 150000,
    "typicalInr": 87000,
    "sourced": true,
    "note": null
  },
  "tharparkar": {
    "lowInr": 40000,
    "highInr": 90000,
    "typicalInr": 60000,
    "sourced": true,
    "note": "Dealer listings span about 20,000 to 1,40,000."
  },
  "vechur": {
    "lowInr": 65000,
    "highInr": 110000,
    "typicalInr": 85000,
    "sourced": true,
    "note": null
  }
};
