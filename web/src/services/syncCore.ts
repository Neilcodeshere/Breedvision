/**
 * Push local records to the cloud.
 *
 * Pure orchestration with injected dependencies (no browser, no SDK), so it is
 * testable without a network or a database. The real wiring is in cloud.ts.
 *
 * Properties this must hold, each covered by a test:
 *  - Idempotent: re-running after a partial failure never duplicates anything
 *    (record ids are client-generated and the upsert is keyed on them).
 *  - One bad record never blocks the rest.
 *  - Oldest first, so a "duplicate of" reference points at something already
 *    uploaded. A reference to a record that is not in the cloud is dropped
 *    rather than failing a foreign-key constraint.
 *  - The image uploads before the row, so a row never points at a missing file.
 *  - Already-synced records are skipped.
 */

export interface LocalRecordForSync {
  id: string;
  createdAt: string;
  syncState: "local-only" | "pending" | "synced";
  prediction: {
    breedId: string;
    breedName: string;
    confidence: number;
    modelVersion: string;
    alternatives: { breedId: string; breedName: string; probability: number }[];
  };
  location: { latitude: number; longitude: number; accuracyM: number | null } | null;
  note: string | null;
  image: Blob;
  imageWidth: number;
  imageHeight: number;
  phash?: string;
  duplicateOf?: { id: string; distance: number; tier: "same" | "similar" } | null;
}

export interface RecordRow {
  id: string;
  user_id: string;
  created_at: string;
  breed_id: string;
  breed_name: string;
  confidence: number;
  band: "confident" | "uncertain" | "low";
  alternatives: unknown[];
  model_version: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  note: string | null;
  image_path: string;
  image_width: number;
  image_height: number;
  phash: string | null;
  duplicate_of: string | null;
  duplicate_distance: number | null;
  duplicate_tier: "same" | "similar" | null;
}

export interface SyncDeps {
  userId: string;
  /** Maps a probability onto the same band the UI uses. */
  bandOf: (confidence: number) => "confident" | "uncertain" | "low";
  uploadImage: (path: string, blob: Blob) => Promise<void>;
  upsertRecord: (row: RecordRow) => Promise<void>;
  markSynced: (id: string) => Promise<void>;
}

export interface SyncResult {
  synced: string[];
  skipped: string[];
  failed: { id: string; message: string }[];
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function imagePathFor(userId: string, id: string, mime: string): string {
  return `${userId}/${id}.${EXT[mime] ?? "jpg"}`;
}

export function toRow(
  rec: LocalRecordForSync,
  deps: Pick<SyncDeps, "userId" | "bandOf">,
  duplicateTargetInCloud: boolean,
): RecordRow {
  const dup = rec.duplicateOf && duplicateTargetInCloud ? rec.duplicateOf : null;
  return {
    id: rec.id,
    user_id: deps.userId,
    created_at: rec.createdAt,
    breed_id: rec.prediction.breedId,
    breed_name: rec.prediction.breedName,
    confidence: rec.prediction.confidence,
    band: deps.bandOf(rec.prediction.confidence),
    alternatives: rec.prediction.alternatives,
    model_version: rec.prediction.modelVersion,
    latitude: rec.location?.latitude ?? null,
    longitude: rec.location?.longitude ?? null,
    accuracy_m: rec.location?.accuracyM ?? null,
    note: rec.note,
    image_path: imagePathFor(deps.userId, rec.id, rec.image.type),
    image_width: rec.imageWidth,
    image_height: rec.imageHeight,
    phash: rec.phash ?? null,
    duplicate_of: dup?.id ?? null,
    duplicate_distance: dup?.distance ?? null,
    duplicate_tier: dup?.tier ?? null,
  };
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return "unknown error";
}

export async function pushRecords(
  records: LocalRecordForSync[],
  deps: SyncDeps,
): Promise<SyncResult> {
  const result: SyncResult = { synced: [], skipped: [], failed: [] };

  // Ids already in the cloud, so duplicate_of references can be validated.
  const inCloud = new Set(records.filter((r) => r.syncState === "synced").map((r) => r.id));

  const ordered = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const rec of ordered) {
    if (rec.syncState === "synced") {
      result.skipped.push(rec.id);
      continue;
    }
    try {
      const targetInCloud = rec.duplicateOf ? inCloud.has(rec.duplicateOf.id) : false;
      const row = toRow(rec, deps, targetInCloud);

      await deps.uploadImage(row.image_path, rec.image); // file first
      await deps.upsertRecord(row); //                      then the row
      await deps.markSynced(rec.id);

      inCloud.add(rec.id);
      result.synced.push(rec.id);
    } catch (err) {
      result.failed.push({ id: rec.id, message: describe(err) });
    }
  }
  return result;
}

export interface SaleForSync {
  id: string;
  breedId: string;
  breedName: string;
  priceInr: number;
  soldOn: string;
  milkYieldLitres: number | null;
  pregnant: boolean | null;
  ageYears: number | null;
  note: string | null;
  source: "user" | "synthetic";
  synced?: boolean;
}

/** Only real, not-yet-uploaded sales. Synthetic rows are never sent. */
export function salesToUpload(sales: SaleForSync[]): SaleForSync[] {
  return sales.filter((s) => s.source === "user" && !s.synced);
}

export function toSaleRow(s: SaleForSync, userId: string) {
  return {
    id: s.id,
    user_id: userId,
    breed_id: s.breedId,
    breed_name: s.breedName,
    price_inr: s.priceInr,
    sold_on: s.soldOn,
    milk_yield_litres: s.milkYieldLitres,
    pregnant: s.pregnant,
    age_years: s.ageYears,
    note: s.note,
    source: "user" as const,
  };
}
