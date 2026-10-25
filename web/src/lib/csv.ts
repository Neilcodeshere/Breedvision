/**
 * CSV export of saved identification records.
 *
 * Dependency-free so it can be tested without a browser. Two details matter:
 *
 *  - The export says only what the app said. `stated_breed` is filled in only
 *    when the app would have named a breed (confident band and the photo looked
 *    like cattle); otherwise it is empty and `top_candidate` carries the model's
 *    best guess, clearly separate. A spreadsheet must not turn an "uncertain"
 *    result into a finding.
 *  - Any cell that starts with = + - or @ is prefixed with an apostrophe so a
 *    spreadsheet cannot run it as a formula (CSV injection). Breed names and
 *    notes can come from outside the app.
 */

export type BandOf = (confidence: number) => "confident" | "uncertain" | "low";

export interface ExportableRecord {
  id: string;
  createdAt: string;
  prediction: {
    breedName: string;
    confidence: number;
    modelVersion: string;
    looksLikeCattle?: boolean | null;
  };
  location: { latitude: number; longitude: number; accuracyM: number | null } | null;
  syncState: string;
  duplicateOf?: { tier: string } | null;
  note?: string | null;
}

export const CSV_COLUMNS = [
  "record_id",
  "recorded_at",
  "stated_breed",
  "top_candidate",
  "confidence",
  "result",
  "model_version",
  "latitude",
  "longitude",
  "location_accuracy_m",
  "duplicate_check",
  "storage",
  "note",
] as const;

/** Escape one cell: neutralise formulas, then quote if needed. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function recordsToCsv(records: ExportableRecord[], bandFor: BandOf): string {
  const rows = records.map((r) => {
    const notCattle = r.prediction.looksLikeCattle === false;
    const band = bandFor(r.prediction.confidence);
    const names = band === "confident" && !notCattle;
    const result = notCattle
      ? "does not look like cattle"
      : band === "confident"
        ? "confident match"
        : band === "uncertain"
          ? "identification uncertain"
          : "could not identify";
    return [
      r.id,
      r.createdAt,
      names ? r.prediction.breedName : "",
      notCattle ? "" : r.prediction.breedName,
      r.prediction.confidence.toFixed(4),
      result,
      r.prediction.modelVersion,
      r.location?.latitude.toFixed(5) ?? "",
      r.location?.longitude.toFixed(5) ?? "",
      r.location?.accuracyM ?? "",
      r.duplicateOf ? (r.duplicateOf.tier === "same" ? "same photo" : "similar photo") : "",
      r.syncState,
      r.note ?? "",
    ].map(csvCell);
  });
  // CRLF line endings and a BOM so Excel opens Devanagari/Tamil/Telugu text
  // correctly.
  return "﻿" + [CSV_COLUMNS.join(","), ...rows.map((c) => c.join(","))].join("\r\n") + "\r\n";
}
