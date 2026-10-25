// Tests for the cloud layer's pure logic: key safety and sync orchestration.
// Run with `npm test`. These import only dependency-free modules, so they need
// no browser, no network and no Supabase project.
import test from "node:test";
import assert from "node:assert/strict";

import { resolveSupabaseConfig } from "../src/lib/supabase-config.ts";
import {
  imagePathFor,
  pushRecords,
  toRow,
  type LocalRecordForSync,
  type RecordRow,
  type SyncDeps,
} from "../src/services/syncCore.ts";

// ----------------------------------------------------------------- key safety

const jwt = (role: string) =>
  "h." + Buffer.from(JSON.stringify({ role })).toString("base64url") + ".s";
const URL_OK = "https://abc.supabase.co";

test("a public anon key is accepted", () => {
  assert.equal(resolveSupabaseConfig(URL_OK, jwt("anon")).ok, true);
});

test("a service_role JWT is REFUSED and the user is told to rotate it", () => {
  const r = resolveSupabaseConfig(URL_OK, jwt("service_role"));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "unsafe-key");
    assert.match(r.message, /rotate/i);
  }
});

test("a new-style secret key (sb_secret_) is REFUSED", () => {
  const r = resolveSupabaseConfig(URL_OK, "sb_secret_abcdef");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "unsafe-key");
});

test("a publishable key is accepted", () => {
  assert.equal(resolveSupabaseConfig(URL_OK, "sb_publishable_abc").ok, true);
});

test("missing url or key means not configured, not an error", () => {
  for (const [u, k] of [[undefined, jwt("anon")], [URL_OK, ""], ["", ""]] as const) {
    const r = resolveSupabaseConfig(u, k);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "not-configured");
  }
});

test("non-local http URLs and garbage URLs are rejected; localhost is allowed", () => {
  const bad = (u: string) => {
    const r = resolveSupabaseConfig(u, jwt("anon"));
    return !r.ok && r.reason === "bad-url";
  };
  assert.ok(bad("http://abc.supabase.co"));
  assert.ok(bad("not a url"));
  assert.equal(resolveSupabaseConfig("http://localhost:54321", jwt("anon")).ok, true);
});

test("trailing slashes are trimmed from the url", () => {
  const r = resolveSupabaseConfig(URL_OK + "//", jwt("anon"));
  assert.ok(r.ok && r.config.url === URL_OK);
});

// ---------------------------------------------------------------------- sync

const blob = (t = "image/jpeg") => new Blob([new Uint8Array(10)], { type: t });
const mk = (
  id: string,
  createdAt: string,
  extra: Partial<LocalRecordForSync> = {},
): LocalRecordForSync => ({
  id,
  createdAt,
  syncState: "local-only",
  prediction: { breedId: "gir", breedName: "Gir", confidence: 0.9, modelVersion: "m1", alternatives: [] },
  location: null,
  note: null,
  image: blob(),
  imageWidth: 10,
  imageHeight: 10,
  ...extra,
});
const bandOf = (c: number) => (c >= 0.85 ? "confident" : c >= 0.3 ? "uncertain" : "low") as "confident" | "uncertain" | "low";

function fake(opts: { failUpload?: string[]; failRow?: string[] } = {}) {
  const log: string[] = [];
  const rows = new Map<string, RecordRow>();
  const marked: string[] = [];
  const deps: SyncDeps = {
    userId: "u1",
    bandOf,
    uploadImage: async (p) => {
      log.push("img:" + p);
      if ((opts.failUpload ?? []).some((i) => p.includes(i))) throw new Error("network down");
    },
    upsertRecord: async (r) => {
      log.push("row:" + r.id);
      if (opts.failRow?.includes(r.id)) throw new Error("rls denied");
      rows.set(r.id, r);
    },
    markSynced: async (id) => {
      marked.push(id);
    },
  };
  return { deps, log, rows, marked };
}

test("uploads oldest first, and each image before its row", async () => {
  const f = fake();
  const res = await pushRecords([mk("b", "2026-02-01"), mk("a", "2026-01-01")], f.deps);
  assert.equal(f.log[0], "img:u1/a.jpg");
  assert.ok(f.log.indexOf("img:u1/a.jpg") < f.log.indexOf("row:a"));
  assert.ok(f.log.indexOf("row:a") < f.log.indexOf("img:u1/b.jpg"));
  assert.equal(res.synced.length, 2);
  assert.equal(f.marked.length, 2);
});

test("already-synced records are skipped, not re-uploaded", async () => {
  const f = fake();
  const res = await pushRecords([mk("a", "2026-01-01", { syncState: "synced" }), mk("b", "2026-01-02")], f.deps);
  assert.deepEqual(res.skipped, ["a"]);
  assert.ok(!f.log.some((l) => l.includes("/a.")));
});

test("one failing record does not block the others, and is not marked synced", async () => {
  const f = fake({ failUpload: ["/b."] });
  const res = await pushRecords([mk("a", "2026-01-01"), mk("b", "2026-01-02"), mk("c", "2026-01-03")], f.deps);
  assert.deepEqual(res.synced, ["a", "c"]);
  assert.equal(res.failed.length, 1);
  assert.equal(res.failed[0].id, "b");
  assert.match(res.failed[0].message, /network down/);
  assert.ok(!f.marked.includes("b"));
  assert.ok(!f.rows.has("b"), "no row is written when the image upload failed");
});

test("a failed row write is reported and not marked synced", async () => {
  const f = fake({ failRow: ["a"] });
  const res = await pushRecords([mk("a", "2026-01-01")], f.deps);
  assert.equal(res.failed[0].message, "rls denied");
  assert.equal(f.marked.length, 0);
});

test("a retry uploads only what previously failed (idempotent)", async () => {
  const first = fake({ failUpload: ["/b."] });
  const recs = [mk("a", "2026-01-01"), mk("b", "2026-01-02")];
  await pushRecords(recs, first.deps);
  recs[0].syncState = "synced"; // what markSynced does locally
  const second = fake();
  const res = await pushRecords(recs, second.deps);
  assert.deepEqual(res.synced, ["b"]);
  assert.deepEqual(res.skipped, ["a"]);
});

test("duplicate_of is kept only when its target is in the cloud", async () => {
  const dup = { id: "a", distance: 2, tier: "same" as const };

  const sameRun = fake();
  await pushRecords([mk("a", "2026-01-01"), mk("b", "2026-01-02", { duplicateOf: dup })], sameRun.deps);
  assert.equal(sameRun.rows.get("b")?.duplicate_of, "a");
  assert.equal(sameRun.rows.get("b")?.duplicate_distance, 2);

  const missing = fake();
  await pushRecords([mk("b", "2026-01-02", { duplicateOf: { ...dup, id: "gone" } })], missing.deps);
  assert.equal(missing.rows.get("b")?.duplicate_of, null, "dropped to avoid a foreign-key failure");
  assert.equal(missing.rows.get("b")?.duplicate_tier, null);

  const earlier = fake();
  await pushRecords(
    [mk("a", "2026-01-01", { syncState: "synced" }), mk("b", "2026-01-02", { duplicateOf: { ...dup, distance: 6, tier: "similar" } })],
    earlier.deps,
  );
  assert.equal(earlier.rows.get("b")?.duplicate_of, "a");
  assert.equal(earlier.rows.get("b")?.duplicate_tier, "similar");
});

test("row mapping: owner, band, location pair, and image path", () => {
  const row = toRow(
    mk("r", "2026-01-01", {
      location: { latitude: 22.3, longitude: 73.1, accuracyM: 18 },
      phash: "98e4e31a5cb1e98e",
      image: blob("image/png"),
    }),
    { userId: "u9", bandOf },
    false,
  );
  assert.equal(row.user_id, "u9");
  assert.equal(row.band, "confident");
  assert.deepEqual([row.latitude, row.longitude, row.accuracy_m], [22.3, 73.1, 18]);
  assert.equal(row.image_path, "u9/r.png");
  assert.equal(toRow(mk("r", "2026"), { userId: "u", bandOf }, false).latitude, null);
  assert.equal(imagePathFor("u", "i", "application/x"), "u/i.jpg");
});

// --------------------------------------------------------------------- sales

import { salesToUpload, toSaleRow, type SaleForSync } from "../src/services/syncCore.ts";

const sale = (id: string, extra: Partial<SaleForSync> = {}): SaleForSync => ({
  id, breedId: "gir", breedName: "Gir", priceInr: 60000, soldOn: "2025-01-10",
  milkYieldLitres: 8, pregnant: false, ageYears: 5, note: null, source: "user", ...extra,
});

test("synthetic demo sales are NEVER selected for upload", () => {
  const out = salesToUpload([sale("a"), sale("b", { source: "synthetic" }), sale("c", { synced: true })]);
  assert.deepEqual(out.map((s) => s.id), ["a"]);
});

test("sale row mapping always labels the source as user", () => {
  const row = toSaleRow(sale("a"), "u1");
  assert.equal(row.user_id, "u1");
  assert.equal(row.source, "user");
  assert.equal(row.price_inr, 60000);
});
