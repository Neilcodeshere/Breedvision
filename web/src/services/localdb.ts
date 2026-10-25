/**
 * Minimal IndexedDB wrapper for device-local identification records.
 *
 * Why IndexedDB rather than localStorage: records carry the animal photograph.
 * localStorage is synchronous, capped around 5 MB, and stores strings only, so
 * images would have to be base64-encoded — roughly a third larger, on the main
 * thread. IndexedDB stores Blobs natively and asynchronously.
 *
 * This is also the storage layer Phase 13 (offline capture and sync) needs, so
 * it is built once here rather than retrofitted later. Every record carries a
 * `syncState` from the start.
 */

import type { GeoLocation, Prediction } from "@/types";

const DB_NAME = "breedvision";
const DB_VERSION = 2;
const STORE = "records";
const SALES_STORE = "sales";

/** How a record stands with respect to a backend that does not exist yet. */
export type SyncState = "local-only" | "pending" | "synced";

export interface StoredRecord {
  id: string;
  createdAt: string;
  prediction: Prediction;
  location: GeoLocation | null;
  note: string | null;
  image: Blob;
  imageWidth: number;
  imageHeight: number;
  syncState: SyncState;
  /** 64-bit perceptual hash (hex), for the duplicate-photo check. */
  phash?: string;
  /** Set when, at save time, this photo matched an earlier record. */
  duplicateOf?: { id: string; distance: number; tier: "same" | "similar" } | null;
}

function isAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        // History is shown newest first, so index the sort key.
        store.createIndex("createdAt", "createdAt");
        store.createIndex("syncState", "syncState");
      }
      // v2: user-logged sale prices. Additive, so existing records survive.
      if (!db.objectStoreNames.contains(SALES_STORE)) {
        const sales = db.createObjectStore(SALES_STORE, { keyPath: "id" });
        sales.createIndex("soldOn", "soldOn");
        sales.createIndex("source", "source");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const req = run(transaction.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
        transaction.oncomplete = () => db.close();
      }),
  );
}

export async function putRecord(record: StoredRecord): Promise<void> {
  if (!isAvailable()) throw new Error("storage unavailable");
  await tx("readwrite", (s) => s.put(record) as IDBRequest<IDBValidKey>);
}

export async function getAllRecords(): Promise<StoredRecord[]> {
  if (!isAvailable()) return [];
  const all = await tx<StoredRecord[]>("readonly", (s) => s.getAll());
  // Newest first.
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getRecordById(
  id: string,
): Promise<StoredRecord | undefined> {
  if (!isAvailable()) return undefined;
  return tx<StoredRecord | undefined>("readonly", (s) => s.get(id));
}

export async function deleteRecordById(id: string): Promise<void> {
  if (!isAvailable()) return;
  await tx("readwrite", (s) => s.delete(id) as unknown as IDBRequest<undefined>);
}

export async function countRecords(): Promise<number> {
  if (!isAvailable()) return 0;
  return tx<number>("readonly", (s) => s.count());
}


/* ------------------------------------------------------------------ sales -- */

export interface StoredSale {
  id: string;
  breedId: string;
  breedName: string;
  /** Rupees, whole number. */
  priceInr: number;
  /** YYYY-MM-DD. */
  soldOn: string;
  milkYieldLitres: number | null;
  pregnant: boolean | null;
  ageYears: number | null;
  note: string | null;
  createdAt: string;
  /** "synthetic" rows are demonstration data and must always be labelled. */
  source: "user" | "synthetic";
  /** True once this sale has been uploaded to the user's account. */
  synced?: boolean;
}

function salesTx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(SALES_STORE, mode);
        const req = run(t.objectStore(SALES_STORE));
        t.oncomplete = () => {
          db.close();
          resolve(req ? req.result : undefined);
        };
        t.onerror = () => reject(t.error ?? new Error("sales transaction failed"));
        t.onabort = () => reject(t.error ?? new Error("sales transaction aborted"));
      }),
  );
}

export async function putSales(sales: StoredSale[]): Promise<void> {
  if (!isAvailable()) throw new Error("storage unavailable");
  await salesTx("readwrite", (s) => {
    sales.forEach((x) => s.put(x));
  });
}

export async function getAllSales(): Promise<StoredSale[]> {
  if (!isAvailable()) return [];
  const all = (await salesTx<StoredSale[]>("readonly", (s) => s.getAll())) ?? [];
  return all.sort((a, b) => b.soldOn.localeCompare(a.soldOn));
}

export async function deleteSaleById(id: string): Promise<void> {
  if (!isAvailable()) return;
  await salesTx("readwrite", (s) => {
    s.delete(id);
  });
}

export async function deleteSalesBySource(
  source: StoredSale["source"],
): Promise<void> {
  if (!isAvailable()) return;
  const all = await getAllSales();
  const ids = all.filter((x) => x.source === source).map((x) => x.id);
  await salesTx("readwrite", (s) => {
    ids.forEach((id) => s.delete(id));
  });
}

/* ------------------------------------------------------------ sync state -- */

export async function markRecordSynced(id: string): Promise<void> {
  const rec = await getRecordById(id);
  if (rec) await putRecord({ ...rec, syncState: "synced" });
}

export async function markSalesSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const all = await getAllSales();
  const set = new Set(ids);
  await putSales(all.filter((s) => set.has(s.id)).map((s) => ({ ...s, synced: true })));
}
