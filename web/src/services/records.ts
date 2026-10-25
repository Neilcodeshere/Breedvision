/**
 * Identification records.
 *
 * Records are currently stored on the device only. There is no backend and no
 * account, so nothing leaves this browser. Every record is written with
 * `syncState: "local-only"`; when the API exists, this module gains an upload
 * step and the state advances to "pending" then "synced". The UI already reads
 * `syncState`, so that change needs no component work.
 */

import {
  deleteRecordById,
  getAllRecords,
  getRecordById,
  putRecord,
  type StoredRecord,
  type SyncState,
} from "./localdb";
import type { GeoLocation, Prediction, ServiceResult } from "@/types";

import { deleteRemoteRecord } from "./cloud";

/** A record plus a live object URL for its image. Revoke when finished. */
export interface LocalRecord {
  id: string;
  createdAt: string;
  prediction: Prediction;
  location: GeoLocation | null;
  note: string | null;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  syncState: SyncState;
  duplicateOf: StoredRecord["duplicateOf"] | null;
}

function toLocalRecord(r: StoredRecord): LocalRecord {
  return {
    id: r.id,
    createdAt: r.createdAt,
    prediction: r.prediction,
    location: r.location,
    note: r.note,
    imageUrl: URL.createObjectURL(r.image),
    imageWidth: r.imageWidth,
    imageHeight: r.imageHeight,
    syncState: r.syncState,
    duplicateOf: r.duplicateOf ?? null,
  };
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `rec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface SaveRecordInput {
  file: File;
  prediction: Prediction;
  width: number;
  height: number;
  location?: GeoLocation | null;
  note?: string | null;
  /** Hash and match result from the duplicate-photo check, when it ran. */
  phash?: string;
  duplicateOf?: StoredRecord["duplicateOf"] | null;
}

export async function saveRecord(
  input: SaveRecordInput,
): Promise<ServiceResult<{ id: string }>> {
  const record: StoredRecord = {
    id: newId(),
    createdAt: new Date().toISOString(),
    prediction: input.prediction,
    location: input.location ?? null,
    note: input.note ?? null,
    image: input.file,
    imageWidth: input.width,
    imageHeight: input.height,
    syncState: "local-only",
    phash: input.phash,
    duplicateOf: input.duplicateOf ?? null,
  };

  try {
    await putRecord(record);
    return { ok: true, data: { id: record.id } };
  } catch {
    return {
      ok: false,
      error: {
        code: "server",
        message:
          "This record could not be saved on your device. Private browsing can block storage.",
      },
    };
  }
}

export async function listRecords(): Promise<ServiceResult<LocalRecord[]>> {
  try {
    const all = await getAllRecords();
    return { ok: true, data: all.map(toLocalRecord) };
  } catch {
    return {
      ok: false,
      error: {
        code: "server",
        message: "Your saved records could not be read from this device.",
      },
    };
  }
}

export async function getRecord(
  id: string,
): Promise<ServiceResult<LocalRecord>> {
  try {
    const found = await getRecordById(id);
    if (!found) {
      return {
        ok: false,
        error: { code: "unknown", message: "That record no longer exists." },
      };
    }
    return { ok: true, data: toLocalRecord(found) };
  } catch {
    return {
      ok: false,
      error: {
        code: "server",
        message: "That record could not be read from this device.",
      },
    };
  }
}

export async function deleteRecord(id: string): Promise<ServiceResult<null>> {
  try {
    // A synced record also lives in the cloud. Deleting only the local copy
    // would leave the user believing their data is gone when it is not, so the
    // cloud copy goes first and a failure there stops the deletion.
    const existing = await getRecordById(id);
    if (existing?.syncState === "synced") {
      const remote = await deleteRemoteRecord(id);
      if (!remote.ok) return remote;
    }
    await deleteRecordById(id);
    return { ok: true, data: null };
  } catch {
    return {
      ok: false,
      error: { code: "server", message: "That record could not be deleted." },
    };
  }
}
