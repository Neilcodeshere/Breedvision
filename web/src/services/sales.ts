/**
 * Sale-price log.
 *
 * Real sale prices are the dataset this project is missing, so logging them is
 * the honest route to a price model: users record what animals actually sold
 * for, and estimates can only be shown once enough real rows exist.
 *
 * Stored on the device only. `source: "synthetic"` rows are demonstration data
 * and are always labelled as such in the UI.
 */

import {
  deleteSaleById,
  deleteSalesBySource,
  getAllSales,
  putSales,
  type StoredSale,
} from "./localdb";
import type { ServiceResult } from "@/types";

export type SaleRecord = StoredSale;

export interface NewSale {
  breedId: string;
  breedName: string;
  priceInr: number;
  soldOn: string;
  milkYieldLitres: number | null;
  pregnant: boolean | null;
  ageYears: number | null;
  note: string | null;
}

export const PRICE_LIMITS = { min: 1_000, max: 1_000_000 } as const;
const MAX_YIELD = 60;
const MAX_AGE = 30;

/** Returns a user-facing sentence naming the problem and the fix, or null. */
export function validateSale(s: NewSale, today = new Date()): string | null {
  if (!s.breedId) return "Choose a breed.";
  if (!Number.isFinite(s.priceInr) || !Number.isInteger(s.priceInr))
    return "Enter the sale price as a whole number of rupees.";
  if (s.priceInr < PRICE_LIMITS.min || s.priceInr > PRICE_LIMITS.max)
    return `Enter a price between ₹${PRICE_LIMITS.min.toLocaleString("en-IN")} and ₹${PRICE_LIMITS.max.toLocaleString("en-IN")}.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.soldOn)) return "Enter the date the animal was sold.";
  const d = new Date(`${s.soldOn}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "That date is not valid.";
  if (d.getTime() > today.getTime()) return "The sale date cannot be in the future.";
  if (s.milkYieldLitres !== null && (s.milkYieldLitres < 0 || s.milkYieldLitres > MAX_YIELD))
    return `Daily milk yield should be between 0 and ${MAX_YIELD} litres.`;
  if (s.ageYears !== null && (s.ageYears < 0 || s.ageYears > MAX_AGE))
    return `Age should be between 0 and ${MAX_AGE} years.`;
  return null;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `sale_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const STORAGE_ERROR = {
  code: "server" as const,
  message: "Sale prices could not be stored on this device. Private browsing can block storage.",
};

export async function listSales(): Promise<ServiceResult<SaleRecord[]>> {
  try {
    return { ok: true, data: await getAllSales() };
  } catch {
    return { ok: false, error: STORAGE_ERROR };
  }
}

export async function addSale(input: NewSale): Promise<ServiceResult<SaleRecord>> {
  const problem = validateSale(input);
  if (problem) return { ok: false, error: { code: "unknown", message: problem } };
  const sale: SaleRecord = {
    ...input,
    id: newId(),
    createdAt: new Date().toISOString(),
    source: "user",
  };
  try {
    await putSales([sale]);
    return { ok: true, data: sale };
  } catch {
    return { ok: false, error: STORAGE_ERROR };
  }
}

export async function removeSale(id: string): Promise<ServiceResult<null>> {
  try {
    await deleteSaleById(id);
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: STORAGE_ERROR };
  }
}

/** Loads the generated demo set. Every row keeps source "synthetic". */
export async function loadDemoSales(): Promise<ServiceResult<number>> {
  try {
    const res = await fetch("/demo/synthetic-sales.json");
    if (!res.ok)
      return { ok: false, error: { code: "server", message: "The demo data file could not be loaded." } };
    const rows = (await res.json()) as SaleRecord[];
    const demo = rows.map((r) => ({ ...r, source: "synthetic" as const }));
    await putSales(demo);
    return { ok: true, data: demo.length };
  } catch {
    return { ok: false, error: STORAGE_ERROR };
  }
}

export async function removeDemoSales(): Promise<ServiceResult<null>> {
  try {
    await deleteSalesBySource("synthetic");
    return { ok: true, data: null };
  } catch {
    return { ok: false, error: STORAGE_ERROR };
  }
}
