/**
 * Indicative cattle value in rupees.
 *
 * READ THIS BEFORE QUOTING A NUMBER FROM IT. This is an estimate built from a
 * breed guide's listed price ranges (October 2026) plus two adjustments, not a
 * market price and not a model trained on sales. Real prices move with region,
 * pedigree, season, age, lactation stage and how a negotiation goes.
 *
 *   value = typical(breed) + PER_LITRE x (yield - reference yield)
 *                          + PREGNANCY_LITRES x PER_LITRE   (if pregnant)
 *
 * and the likely range is the breed's listed low-high range scaled by the same
 * factor. Assumptions are named in price-anchors.generated.ts and
 * docs/price-reference.md. The synthetic sale rows use this same function, so
 * they can never "confirm" it.
 */

import {
  DEFAULT_ANCHOR,
  MIN_FACTOR,
  PER_LITRE_INR,
  PREGNANCY_LITRE_EQUIVALENT_FOR_PRICE,
  PRICE_ANCHORS,
  REFERENCE_MILK_YIELD_LITRES,
  type PriceAnchor,
} from "./price-anchors.generated.ts";

export interface ValueEstimateInput {
  breedId: string;
  milkYieldLitres: number;
  pregnant: boolean;
}

export interface ValueEstimate {
  /** Rounded to the nearest 1,000. */
  typicalInr: number;
  lowInr: number;
  highInr: number;
  /** True when a price source exists for this specific breed. */
  sourced: boolean;
  /** The breed's unadjusted listed range. */
  listing: { lowInr: number; highInr: number };
  /** Contributions to the typical value, for explaining it. */
  parts: {
    baseInr: number;
    milkInr: number;
    pregnancyInr: number;
  };
  note: string | null;
}

export const roundTo = (n: number, step: number) => Math.round(n / step) * step;

export function anchorFor(breedId: string): PriceAnchor {
  return PRICE_ANCHORS[breedId] ?? DEFAULT_ANCHOR;
}

export function pregnancyPremiumInr(): number {
  return PREGNANCY_LITRE_EQUIVALENT_FOR_PRICE * PER_LITRE_INR;
}

/** Scale factor applied to the breed's whole listed range. */
export function adjustmentFactor(
  typicalInr: number,
  milkYieldLitres: number,
  pregnant: boolean,
): number {
  const milk = PER_LITRE_INR * (milkYieldLitres - REFERENCE_MILK_YIELD_LITRES);
  const preg = pregnant ? pregnancyPremiumInr() : 0;
  return Math.max(MIN_FACTOR, (typicalInr + milk + preg) / typicalInr);
}

export function estimateValue(input: ValueEstimateInput): ValueEstimate {
  const a = anchorFor(input.breedId);
  const f = adjustmentFactor(a.typicalInr, input.milkYieldLitres, input.pregnant);
  return {
    typicalInr: roundTo(a.typicalInr * f, 1000),
    lowInr: roundTo(a.lowInr * f, 1000),
    highInr: roundTo(a.highInr * f, 1000),
    sourced: a.sourced,
    listing: { lowInr: a.lowInr, highInr: a.highInr },
    parts: {
      baseInr: a.typicalInr,
      milkInr: PER_LITRE_INR * (input.milkYieldLitres - REFERENCE_MILK_YIELD_LITRES),
      pregnancyInr: input.pregnant ? pregnancyPremiumInr() : 0,
    },
    note: a.note,
  };
}

/** Indian digit grouping: 150000 -> "₹1,50,000". */
export function formatInr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}
