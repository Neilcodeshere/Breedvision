/**
 * Relative value index.
 *
 * Source: Kumar, Nisha, Kumar & Kumar (2014), "Development of valuation index
 * for dairy cattle and buffalo in Tamil Nadu", Indian Journal of Animal
 * Sciences 84(11), Table 2, overall dairy-cow model (525 owners, 7 districts,
 * data collected Oct 2010 - Jan 2011).
 *
 * That model reports, in 2010-11 rupees:
 *   milk yield  +719.54 per litre   (significant)
 *   pregnancy   +1,114.07           (significant)
 * Age, calving interval, body weight and disease tolerance were not
 * significant in the overall cow model, so they are deliberately absent here.
 *
 * WHAT THIS IS NOT: a price. Those rupee figures are 15 years old, from one
 * state, and the study contains no data for the indigenous breeds this product
 * identifies. Using them to quote a rupee amount would be inventing a number.
 * Only the *ratio* between the two coefficients is used, which yields a unitless
 * score that can rank animals against each other and nothing more.
 *
 * Breed is NOT part of the index: the paper has no per-breed effect for our 49
 * breeds, and adding one would be fabrication.
 */

export const SOURCE_CITATION =
  "Kumar et al. (2014), Indian Journal of Animal Sciences 84(11), Table 2, overall dairy-cow model.";

const COEF_MILK_PER_LITRE = 719.54;
const COEF_PREGNANCY = 1114.07;

/** One litre of daily milk yield is the unit; pregnancy is worth this many. */
export const PREGNANCY_LITRE_EQUIVALENT = COEF_PREGNANCY / COEF_MILK_PER_LITRE;

export interface ValueInputs {
  milkYieldLitres: number;
  pregnant: boolean;
}

export interface ValueFactor {
  key: "milk" | "pregnancy";
  label: string;
  /** Contribution in litre-equivalents. */
  points: number;
  /** Share of the total index, 0..1. */
  share: number;
}

export interface ValueIndex {
  /** Litre-equivalents. Higher means higher relative value, nothing more. */
  index: number;
  /** Factors, largest contribution first. */
  factors: ValueFactor[];
}

export function valueIndex(input: ValueInputs): ValueIndex {
  const milk = Math.max(0, input.milkYieldLitres);
  const preg = input.pregnant ? PREGNANCY_LITRE_EQUIVALENT : 0;
  const total = milk + preg;

  const factors: ValueFactor[] = [
    {
      key: "milk",
      label: "Daily milk yield",
      points: milk,
      share: total > 0 ? milk / total : 0,
    },
    {
      key: "pregnancy",
      label: "Pregnant",
      points: preg,
      share: total > 0 ? preg / total : 0,
    },
  ].sort((a, b) => b.points - a.points) as ValueFactor[];

  return { index: total, factors };
}

/** 1 = highest. Ties share a rank. */
export function rankBy<T>(items: T[], score: (item: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  const ranks = new Map<T, number>();
  sorted.forEach((item, i) => {
    const prev = sorted[i - 1];
    ranks.set(
      item,
      prev !== undefined && score(prev) === score(item) ? ranks.get(prev)! : i + 1,
    );
  });
  return ranks;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
