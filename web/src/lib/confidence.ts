/**
 * Confidence banding — how much the interface is allowed to assert.
 *
 * The cut-offs are DERIVED, not guessed: ml/training/calibrate.py temperature-
 * scales the trained head and reads thresholds off validation data using 5-fold
 * cross-fitting, with no tuning on the test split.
 *
 *   confident >= 0.85  first threshold where accuracy-when-named reaches the
 *                      90% target (the model names a breed for ~24% of photos)
 *   low       <  0.30  below this, the true breed is in the top 3 less than 60%
 *                      of the time, so even a candidate list is unreliable
 *
 * These MUST match the thresholds embedded in the deployed model bundle
 * (backend/models/breedvision_classifier.json), which the API reports at
 * /api/classify/info. If the model is re-exported, update them together.
 *
 * Honest limits: validation was used both to fit the temperature and to choose
 * the cut-offs. They were then confirmed once on the held-out test split
 * (docs/test-evaluation.md): 90.1% accurate on the 24% of photos where a breed
 * is named. That is one dataset, not field conditions. The 90% target is a policy choice, not a fact about
 * the model; a lower target names more breeds at lower accuracy.
 *
 * The band — not the raw number — decides how the result screen speaks:
 *   confident  -> state the breed
 *   uncertain  -> present candidates, do not assert a single breed
 *   low        -> decline to identify, ask for a better photo
 */

import type { ConfidenceBand, Prediction } from "@/types";

export interface ConfidenceThresholds {
  /** At or above this, the UI states a single breed. */
  confident: number;
  /** At or above this (but below `confident`), the UI offers candidates. */
  uncertain: number;
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  confident: 0.85,
  uncertain: 0.3,
};

/** True only while the thresholds are placeholders rather than derived. */
export const THRESHOLDS_ARE_PROVISIONAL = false;

/** One line the UI can show wherever thresholds are explained. */
export const THRESHOLD_BASIS =
  "Derived on validation data (5-fold cross-fitted), targeting 90% accuracy when a breed is named. Confirmed once on the held-out test split.";

export function bandFor(
  confidence: number,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ConfidenceBand {
  if (confidence >= thresholds.confident) return "confident";
  if (confidence >= thresholds.uncertain) return "uncertain";
  return "low";
}

export function bandForPrediction(
  prediction: Prediction,
  thresholds?: ConfidenceThresholds,
): ConfidenceBand {
  return bandFor(prediction.confidence, thresholds);
}

interface BandPresentation {
  /** Short status word. Never the only signal — always paired with text. */
  label: string;
  /** One sentence explaining what the band means for the user. */
  description: string;
  /** Whether the UI may state a single breed as the answer. */
  assertsBreed: boolean;
}

export const BAND_PRESENTATION: Record<ConfidenceBand, BandPresentation> = {
  confident: {
    label: "Confident match",
    description: "The model identified one breed clearly.",
    assertsBreed: true,
  },
  uncertain: {
    label: "Identification uncertain",
    description:
      "The model could not settle on one breed. Review the candidates below.",
    assertsBreed: false,
  },
  low: {
    label: "Could not identify",
    description:
      "The model could not determine the breed from this image. A clearer photo of the whole animal usually helps.",
    assertsBreed: false,
  },
};

/** Percentage string for display, e.g. 0.9137 -> "91.4%". */
export function formatConfidence(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}
