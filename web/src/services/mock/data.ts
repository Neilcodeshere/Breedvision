/**
 * Breed data for the mock service layer.
 *
 * The breed list is GENERATED from the dataset's class mapping
 * (`breeds.generated.ts`) rather than hand-maintained, so the library can never
 * advertise a breed the model was not trained on.
 *
 * Names are the dataset's own class labels. Home tracts come from the
 * ICAR-NBAGR registry; use and notes are a general summary kept in
 * `breed-info.ts` (see its header for exactly what is and isn't cited).
 * Photos are samples from the training dataset. Where a fact is unknown the
 * field is left empty rather than guessed.
 *
 * Scope: this dataset contains **cattle only**. It has no buffalo breeds, so
 * buffalo identification is not offered anywhere in the product until a
 * separate dataset is sourced (docs/dataset-report.md section 7.4).
 *
 * Confidence figures produced by the mock predictor are illustrative values for
 * building the interface. They are NOT model output and must never be quoted.
 */

import type { Breed, BreedSummary, ModelInfo } from "@/types";

import { BREED_INFO, BREED_SOURCE, BREED_SOURCE_URL } from "./breed-info";
import { GENERATED_BREEDS, NUM_CLASSES } from "./breeds.generated";

export const MOCK_BREED_SUMMARIES: BreedSummary[] = GENERATED_BREEDS.map(
  (b) => {
    const info = BREED_INFO[b.id];
    return {
      id: b.id,
      name: b.name,
      category: "cattle" as const,
      region: info?.region ?? null,
      shortDescription: info?.notes ?? null,
      // Photos are resized samples from the training dataset, written by
      // ml/scripts/export_breed_photos.py. 1.jpg is the card/hero image.
      imageUrl: `/breeds/${b.id}/1.jpg`,
    };
  },
);

export const MOCK_BREEDS: Breed[] = MOCK_BREED_SUMMARIES.map((b) => {
  const info = BREED_INFO[b.id];
  return {
    ...b,
    description: info?.notes ?? null,
    characteristics: [
      ...(info?.use ? [{ label: "Primary use", value: info.use }] : []),
    ],
    gallery: [1, 2, 3].map((n) => `/breeds/${b.id}/${n}.jpg`),
    relatedBreedIds: info?.related ?? [],
    source: BREED_SOURCE,
    sourceUrl: BREED_SOURCE_URL,
  };
});

export const MOCK_MODEL_INFO: ModelInfo = {
  // No model has been selected for deployment yet. Phase 2 compares backbones;
  // Phase 3 evaluates on the held-out test split.
  version: "not-deployed",
  architecture: "under evaluation (Phase 2 backbone comparison)",
  numClasses: NUM_CLASSES,
  confidenceThreshold: 0.85,
  trainedAt: null,
};
