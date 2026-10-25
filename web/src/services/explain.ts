/**
 * Heat-map of where the model found evidence for its prediction.
 *
 * Only available from the real model. In mock mode there is no model, so any
 * heat-map would be as invented as the mock prediction it claimed to explain;
 * this returns "unavailable" instead.
 */

import type { ServiceResult } from "@/types";

import { API_BASE_URL, USE_MOCKS } from "./config";

export interface Explanation {
  breedName: string;
  probability: number;
  /** The exact centre crop the model received (data URL). Not the whole photo. */
  viewUrl: string;
  /** Transparent overlay for the same square (data URL). */
  heatmapUrl: string;
  /** 7 x 7, 0-100, row-major. */
  grid: number[][];
  /** Plain-language description of where the evidence sits. */
  summary: string;
  limits: string[];
}

interface ExplainResponse {
  breed_name: string;
  probability: number;
  view_png: string;
  heatmap_png: string;
  grid: number[][];
  summary: string;
  limits: string[];
}

export const EXPLAIN_AVAILABLE = !USE_MOCKS;

export async function explainPrediction(file: File): Promise<ServiceResult<Explanation>> {
  if (USE_MOCKS) {
    return {
      ok: false,
      error: {
        code: "server",
        message: "Heat-maps are available when the app is connected to the live model.",
      },
    };
  }
  const body = new FormData();
  body.append("file", file);
  try {
    const res = await fetch(`${API_BASE_URL}/api/explain`, { method: "POST", body });
    if (res.status === 503)
      return { ok: false, error: { code: "server", message: "The breed model is not loaded on the server." } };
    if (!res.ok)
      return { ok: false, error: { code: "server", message: "The heat-map could not be produced for this photo. Try again." } };
    const r = (await res.json()) as ExplainResponse;
    return {
      ok: true,
      data: {
        breedName: r.breed_name,
        probability: r.probability,
        viewUrl: r.view_png,
        heatmapUrl: r.heatmap_png,
        grid: r.grid,
        summary: r.summary,
        limits: r.limits,
      },
    };
  } catch {
    return { ok: false, error: { code: "network", message: "No connection to the analysis service. Check your network and try again." } };
  }
}
