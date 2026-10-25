import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const here = (p) => new URL(p, import.meta.url);
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";
const R1 = "11111111-1111-1111-1111-111111111111";
const R2 = "22222222-2222-2222-2222-222222222222";
const MIGRATION = "../migrations/20261025000000_core.sql";
let db;

// Run SQL as a given user (or anonymous), exactly as an API request would.
async function as(user, sql, params = []) {
  await db.exec(user ? "set role authenticated" : "set role anon");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
  }
}
async function rejects(user, sql, params, pattern) {
  await assert.rejects(() => as(user, sql, params), pattern);
}

const rec = (id, extra = {}) => ({
  id,
  created_at: "2026-10-01T10:00:00Z",
  breed_id: "gir",
  breed_name: "Gir",
  confidence: 0.9,
  band: "confident",
  model_version: "m1",
  phash: "98e4e31a5cb1e98e",
  ...extra,
});
const INSERT_REC = `insert into public.identification_records
  (id, created_at, breed_id, breed_name, confidence, band, model_version, phash, latitude, longitude)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`;
const args = (r) => [
  r.id, r.created_at, r.breed_id, r.breed_name, r.confidence, r.band,
  r.model_version, r.phash ?? null, r.latitude ?? null, r.longitude ?? null,
];

before(async () => {
  db = new PGlite();
  await db.exec(readFileSync(here("./platform_stub.sql"), "utf8"));
  await db.exec(`insert into auth.users values ('${A}'), ('${B}')`);
  // The real migration, unmodified.
  await db.exec(readFileSync(here(MIGRATION), "utf8"));
});

beforeEach(async () => {
  await db.exec("reset role");
  await db.exec(
    "delete from public.identification_records; delete from public.sale_logs; delete from storage.objects",
  );
});

test("owner can insert and read their own record", async () => {
  await as(A, INSERT_REC, args(rec(R1)));
  const r = await as(A, "select id from public.identification_records");
  assert.equal(r.rows.length, 1);
});

test("a user_id left unspecified defaults to the caller", async () => {
  await as(A, INSERT_REC, args(rec(R1)));
  const r = await db.query("select user_id from public.identification_records where id = $1", [R1]);
  assert.equal(r.rows[0].user_id, A);
});

test("cannot insert a record owned by someone else", async () => {
  await rejects(
    A,
    `insert into public.identification_records
       (id, user_id, created_at, breed_id, breed_name, confidence, band, model_version)
       values ($1, $2, now(), 'gir','Gir',0.9,'confident','m1')`,
    [R1, B],
    /row-level security/,
  );
});

test("another user sees none of my records", async () => {
  await as(A, INSERT_REC, args(rec(R1)));
  const r = await as(B, "select id from public.identification_records");
  assert.equal(r.rows.length, 0);
});

test("another user cannot update or delete my record (0 rows affected)", async () => {
  await as(A, INSERT_REC, args(rec(R1)));
  const u = await as(B, "update public.identification_records set breed_name = 'HACKED' where id = $1", [R1]);
  const d = await as(B, "delete from public.identification_records where id = $1", [R1]);
  assert.equal(u.affectedRows, 0);
  assert.equal(d.affectedRows, 0);
  const still = await db.query("select breed_name from public.identification_records where id = $1", [R1]);
  assert.equal(still.rows[0].breed_name, "Gir");
});

test("another user cannot overwrite my record by upserting its id", async () => {
  await as(A, INSERT_REC, args(rec(R1)));
  await rejects(
    B,
    INSERT_REC + " on conflict (id) do update set breed_name = 'HACKED'",
    args(rec(R1)),
    /row-level security|duplicate key/,
  );
  const still = await db.query("select breed_name, user_id from public.identification_records where id = $1", [R1]);
  assert.equal(still.rows[0].breed_name, "Gir");
  assert.equal(still.rows[0].user_id, A);
});

test("the owner can re-upload the same record (sync is idempotent)", async () => {
  await as(A, INSERT_REC, args(rec(R1)));
  await as(
    A,
    INSERT_REC + " on conflict (id) do update set breed_name = excluded.breed_name",
    args(rec(R1, { breed_name: "Gir (retry)" })),
  );
  const r = await as(A, "select breed_name from public.identification_records");
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].breed_name, "Gir (retry)");
});

test("an anonymous visitor can read and write nothing", async () => {
  await as(A, INSERT_REC, args(rec(R1)));
  await rejects(null, "select * from public.identification_records", [], /permission denied/);
  await rejects(null, INSERT_REC, args(rec(R2)), /permission denied/);
  await rejects(null, "select * from public.sale_logs", [], /permission denied/);
});

test("data constraints reject bad values", async () => {
  const bad = (extra, re) => rejects(A, INSERT_REC, args(rec(R1, extra)), re);
  await bad({ confidence: 1.5 }, /confidence/);
  await bad({ band: "certain" }, /band/);
  await bad({ phash: "XYZ" }, /phash/);
  await bad({ phash: "98E4E31A5CB1E98E" }, /phash/); // uppercase not allowed
  await bad({ latitude: 22.3 }, /location_is_a_pair/); // half a coordinate
  await bad({ latitude: 95, longitude: 73 }, /latitude/);
  await as(A, INSERT_REC, args(rec(R2, { latitude: 22.3, longitude: 73.1 }))); // a full pair is fine
});

test("sale logs: valid row accepted, bad rows rejected", async () => {
  const ins = `insert into public.sale_logs (id, breed_id, breed_name, price_inr, sold_on, source)
               values ($1,'gir','Gir',$2,$3,$4)`;
  await as(A, ins, [R1, 60000, "2025-01-10", "user"]);
  await rejects(A, ins, [R2, 500, "2025-01-10", "user"], /price_inr/);
  await rejects(A, ins, [R2, 5000000, "2025-01-10", "user"], /price_inr/);
  await rejects(A, ins, [R2, 60000, "2999-01-10", "user"], /sold_on/);
});

test("synthetic demo rows can never reach the shared database", async () => {
  await rejects(
    A,
    `insert into public.sale_logs (id, breed_id, breed_name, price_inr, sold_on, source)
     values ($1,'gir','Gir',60000,'2025-01-10','synthetic')`,
    [R1],
    /source/,
  );
});

test("sale logs are private to their owner", async () => {
  await as(
    A,
    `insert into public.sale_logs (id, breed_id, breed_name, price_inr, sold_on)
     values ($1,'gir','Gir',60000,'2025-01-10')`,
    [R1],
  );
  const r = await as(B, "select * from public.sale_logs");
  assert.equal(r.rows.length, 0);
});

// ---- cross-user duplicate check -------------------------------------------

const DUP = "select * from public.check_duplicate_photo($1, $2)";

test("duplicate check: finds my own earlier photo, with its date", async () => {
  await as(A, INSERT_REC, args(rec(R1, { phash: "98e4e31a5cb1e98e" })));
  const r = await as(A, DUP, ["98e4e31a5cb1e98e", "cdb0b64a09a4bcdb"]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].distance, 0);
  assert.equal(r.rows[0].tier, "same");
  assert.equal(r.rows[0].is_own, true);
  assert.ok(r.rows[0].recorded_on);
});

test("duplicate check: sees ANOTHER user's photo but reveals almost nothing", async () => {
  await as(A, INSERT_REC, args(rec(R1, { phash: "98e4e31a5cb1e98e" })));
  const r = await as(B, DUP, ["98e4e31a5cb1e98e", "cdb0b64a09a4bcdb"]);
  assert.equal(r.rows.length, 1, "B is told a match exists");
  assert.equal(r.rows[0].is_own, false);
  assert.equal(r.rows[0].recorded_on, null, "no date for someone else's record");
  assert.deepEqual(
    Object.keys(r.rows[0]).sort(),
    ["distance", "is_own", "recorded_on", "tier"],
    "no id, owner, path, or location is returned",
  );
  assert.equal((await as(B, "select * from public.identification_records")).rows.length, 0);
});

test("duplicate check: tiers and the 8-bit limit", async () => {
  await as(A, INSERT_REC, args(rec(R1, { phash: "0000000000000000" })));
  const q = (h) => as(A, DUP, [h, "ffffffffffffffff"]);
  assert.equal((await q("000000000000000f")).rows[0].tier, "same"); // 4 bits
  assert.equal((await q("00000000000000ff")).rows[0].tier, "similar"); // 8 bits
  assert.equal((await q("00000000000001ff")).rows.length, 0); // 9 bits: not a match
});

test("duplicate check: a mirrored copy matches via the mirror hash", async () => {
  await as(A, INSERT_REC, args(rec(R1, { phash: "98e4e31a5cb1e98e" })));
  // The uploaded photo is a flip: its own hash is far, but its mirror equals the original.
  const r = await as(B, DUP, ["cdb0b64a09a4bcdb", "98e4e31a5cb1e98e"]);
  assert.equal(r.rows[0].distance, 0);
});

test("duplicate check: rejects malformed hashes and anonymous callers", async () => {
  await rejects(A, DUP, ["nope", "98e4e31a5cb1e98e"], /16 lowercase hex/);
  await rejects(A, DUP, ["98e4e31a5cb1e98e'; drop table x;--", "98e4e31a5cb1e98e"], /16 lowercase hex/);
  await rejects(null, DUP, ["98e4e31a5cb1e98e", "98e4e31a5cb1e98e"], /permission denied/);
});

test("hash_distance agrees with Python's imagehash values", async () => {
  const cases = [
    ["98e4e31a5cb1e98e", "98c4e31a5cf1e98e", 2],
    // Expected values computed independently in Python (popcount of a xor b and
    // imagehash's own subtraction both give 28 for this pair).
    ["98e4e31a5cb1e98e", "cdb0b64a09a4bcdb", 28],
  ];
  for (const [a, b, want] of cases) {
    const r = await db.query("select public.hash_distance($1,$2) as d", [a, b]);
    assert.equal(r.rows[0].d, want);
  }
});

// ---- storage ----------------------------------------------------------------

const PUT = "insert into storage.objects (bucket_id, name) values ('record-images', $1)";

test("storage: a user can write only inside their own folder", async () => {
  await as(A, PUT, [`${A}/one.jpg`]);
  await rejects(A, PUT, [`${B}/stolen.jpg`], /row-level security/);
  await rejects(A, PUT, ["loose.jpg"], /row-level security/);
});

test("storage: other users cannot see or delete my images", async () => {
  await db.exec(`insert into storage.objects (bucket_id, name) values ('record-images', '${A}/one.jpg')`);
  assert.equal((await as(B, "select * from storage.objects")).rows.length, 0);
  assert.equal((await as(B, "delete from storage.objects where name = $1", [`${A}/one.jpg`])).affectedRows, 0);
  assert.equal((await as(A, "select * from storage.objects")).rows.length, 1);
});

test("storage: the bucket is private with size and type limits", async () => {
  const b = (await db.query("select * from storage.buckets where id = 'record-images'")).rows[0];
  assert.equal(b.public, false);
  assert.equal(Number(b.file_size_limit), 5 * 1024 * 1024);
  assert.deepEqual(b.allowed_mime_types, ["image/jpeg", "image/png", "image/webp"]);
});

test("migration is idempotent (safe to run twice)", async () => {
  await db.exec(readFileSync(here(MIGRATION), "utf8"));
});
