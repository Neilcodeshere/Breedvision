/**
 * Prediction service.
 *
 * UI components import from here and never call `fetch` directly. When the
 * FastAPI backend lands, only the `real*` functions below change.
 */

import type {
  IdentificationRecord,
  Prediction,
  PredictionAlternative,
  ServiceResult,
} from "@/types";

import { API_BASE_URL, USE_MOCKS } from "./config";
import { MOCK_BREED_SUMMARIES, MOCK_MODEL_INFO } from "./mock/data";

/* ------------------------------------------------------------------ mocks -- */

/** Stable 32-bit hash so the same image always yields the same mock result —
 *  a demo that changes its answer on re-upload feels broken. */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function mockPrediction(seedKey: string): Prediction {
  const h = hashString(seedKey);
  const pool = MOCK_BREED_SUMMARIES;

  // Spread across the three confidence bands so every result state is
  // reachable while building. Ranges straddle the derived cut-offs (0.85 and
  // 0.30): confident 0.86 – 0.97, uncertain 0.31 – 0.84, low 0.12 – 0.29.
  const roll = (h % 100) / 100;
  const top =
    roll < 0.3
      ? 0.86 + ((h >> 3) % 12) / 100
      : roll < 0.75
        ? 0.31 + ((h >> 5) % 54) / 100
        : 0.12 + ((h >> 7) % 18) / 100;

  const primary = pool[h % pool.length];
  const others = pool.filter((b) => b.id !== primary.id);

  // Remaining mass split over the next four, descending.
  const rest = 1 - top;
  const weights = [0.45, 0.27, 0.17, 0.11];
  const alternatives: PredictionAlternative[] = weights.map((w, i) => {
    const b = others[(h >> (2 * (i + 1))) % others.length];
    return { breedId: b.id, breedName: b.name, probability: rest * w };
  });

  // De-duplicate in case the hash picked the same breed twice.
  const seen = new Set([primary.id]);
  const unique = alternatives.filter((a) =>
    seen.has(a.breedId) ? false : (seen.add(a.breedId), true),
  );

  return {
    breedId: primary.id,
    breedName: primary.name,
    confidence: top,
    alternatives: unique,
    isConfident: top >= MOCK_MODEL_INFO.confidenceThreshold,
    modelVersion: MOCK_MODEL_INFO.version,
    inferenceMs: 380 + (h % 900),
    boundingBox: null,
  };
}

/* -------------------------------------------------------------- real API -- */

/** Shape returned by the FastAPI `POST /api/classify` route. */
interface ClassifyResponse {
  animal_id: string;
  breed_id: string;
  breed_name: string;
  confidence: number;
  band: "confident" | "uncertain" | "low";
  is_confident: boolean;
  looks_like_cattle?: boolean | null;
  alternatives: {
    breed_id: string;
    breed_name: string;
    probability: number;
  }[];
  model_version: string;
  inference_ms: number;
}

/**
 * The backend uses snake_case throughout; the client maps into the camelCase
 * domain type. Keeping the adaptation here rather than bending the API means
 * the backend stays internally consistent and only this one function changes
 * if the contract moves.
 */
function toPrediction(r: ClassifyResponse): Prediction {
  return {
    breedId: r.breed_id,
    breedName: r.breed_name,
    confidence: r.confidence,
    alternatives: r.alternatives.map((a) => ({
      breedId: a.breed_id,
      breedName: a.breed_name,
      probability: a.probability,
    })),
    isConfident: r.is_confident,
    looksLikeCattle: r.looks_like_cattle ?? null,
    modelVersion: r.model_version,
    inferenceMs: r.inference_ms,
    // The classifier does not localise the animal; /api/detect does that.
    boundingBox: null,
  };
}

async function realPredictBreed(file: File): Promise<ServiceResult<Prediction>> {
  const body = new FormData();
  body.append("file", file);

  try {
    const res = await fetch(`${API_BASE_URL}/api/classify`, {
      method: "POST",
      body,
    });

    if (res.status === 503) {
      return {
        ok: false,
        error: {
          code: "server",
          message:
            "The breed model is not loaded on the server. Analysis is unavailable right now.",
        },
      };
    }
    if (res.status === 413) {
      return {
        ok: false,
        error: {
          code: "image_too_large",
          message: "That image is too large to analyse. Try a photo under 10 MB.",
        },
      };
    }
    if (res.status === 400) {
      return {
        ok: false,
        error: {
          code: "invalid_image",
          message:
            "That image could not be analysed. It may be damaged — try another photo.",
        },
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: {
          code: "server",
          message:
            "The analysis service could not be reached. Try again in a moment.",
        },
      };
    }
    return { ok: true, data: toPrediction((await res.json()) as ClassifyResponse) };
  } catch {
    return {
      ok: false,
      error: {
        code: "network",
        message:
          "No connection to the analysis service. Check your network and try again.",
      },
    };
  }
}

/* ---------------------------------------------------------------- public -- */

/**
 * Analyse an image and return a breed prediction.
 *
 * While `USE_MOCKS` is true this returns illustrative data, not model output.
 */
export async function predictBreed(
  file: File,
): Promise<ServiceResult<Prediction>> {
  if (!USE_MOCKS) return realPredictBreed(file);

  // Simulate a realistic round trip so the processing UI is exercised properly.
  await new Promise((r) => setTimeout(r, 1500));
  return {
    ok: true,
    data: mockPrediction(`${file.name}:${file.size}:${file.lastModified}`),
  };
}

export async function getPredictionHistory(): Promise<
  ServiceResult<IdentificationRecord[]>
> {
  if (USE_MOCKS) return { ok: true, data: [] };

  try {
    const res = await fetch(`${API_BASE_URL}/api/animals`);
    if (!res.ok) {
      return {
        ok: false,
        error: { code: "server", message: "Could not load your records." },
      };
    }
    return { ok: true, data: (await res.json()) as IdentificationRecord[] };
  } catch {
    return {
      ok: false,
      error: {
        code: "network",
        message: "No connection. Your records will load when you’re back online.",
      },
    };
  }
}
