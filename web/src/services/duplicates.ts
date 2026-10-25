/**
 * Duplicate-photo check.
 *
 * What it detects: a photo that is the same picture as one already saved on
 * this device, even after re-saving, resizing, recompression, brightness
 * changes or mirroring.
 *
 * What it does NOT detect, and must never be described as detecting:
 *  - two different photographs of the same animal;
 *  - a photo that has been cropped by more than a few percent or rotated.
 * Measured recall for those cases is low (docs/duplicate-detection.md).
 *
 * Scope: this device only. It cannot see records on other devices, so it is not
 * by itself a defence against fraud across users.
 */

import { fingerprintBlob, type PhotoFingerprint } from "@/lib/phash";
import { matchDistance, tierFor, type MatchTier } from "@/lib/phash-core";

import { getAllRecords } from "./localdb";

export type { PhotoFingerprint, MatchTier };

export interface DuplicateMatch {
  recordId: string;
  createdAt: string;
  distance: number;
  tier: MatchTier;
}

export function fingerprint(blob: Blob): Promise<PhotoFingerprint> {
  return fingerprintBlob(blob);
}

/** Closest saved record within the similarity limit, or null. Never throws. */
export async function findDuplicate(
  fp: PhotoFingerprint,
): Promise<DuplicateMatch | null> {
  try {
    const records = await getAllRecords();
    let best: DuplicateMatch | null = null;

    for (const r of records) {
      // Older records predate fingerprinting; derive theirs from the stored image.
      const stored = r.phash ?? (await fingerprintBlob(r.image)).hash;
      const distance = matchDistance(fp, stored);
      const tier = tierFor(distance);
      if (tier && (!best || distance < best.distance)) {
        best = { recordId: r.id, createdAt: r.createdAt, distance, tier };
      }
    }
    return best;
  } catch {
    // A failed check must never block identification or saving.
    return null;
  }
}
