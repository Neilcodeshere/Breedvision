/** Breed service. UI imports from here; never fetches directly. */

import type { Breed, BreedSummary, ServiceResult } from "@/types";

import { MOCK_BREEDS, MOCK_BREED_SUMMARIES } from "./mock/data";

/**
 * The breed list is NOT mock data and does not depend on the API.
 *
 * It is generated from the model's class mapping, so it is exactly the set of
 * breeds the classifier can predict. Fetching it from a server would risk the
 * library advertising breeds the model was never trained on, and would break
 * the page offline for no benefit. Descriptions and photographs are the parts
 * that will eventually come from a backend (Phase 16).
 */
export async function getBreeds(): Promise<ServiceResult<BreedSummary[]>> {
  return { ok: true, data: MOCK_BREED_SUMMARIES };
}

export async function getBreed(id: string): Promise<ServiceResult<Breed>> {
  const found = MOCK_BREEDS.find((b) => b.id === id);
  return found
    ? { ok: true, data: found }
    : {
        ok: false,
        error: { code: "unknown", message: "That breed could not be found." },
      };
}
