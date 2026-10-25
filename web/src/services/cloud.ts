/**
 * Cloud account, sync and cross-account duplicate check (Supabase).
 *
 * Local-first: the app works fully without an account, and everything here is
 * additive. Records always exist on the device first; signing in uploads them.
 *
 * Security notes:
 *  - Only the PUBLIC key is ever used. resolveSupabaseConfig refuses a
 *    service-role / secret key even if someone pastes one into the env file.
 *  - Access control is enforced by row-level security in the database
 *    (supabase/migrations), not by this code.
 *
 * Not verified against a live Supabase project: this file needs a project's URL
 * and key. The database rules it relies on are tested (supabase/tests); the
 * orchestration it calls is tested (web/tests); the wiring below is not.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { bandFor } from "@/lib/confidence";
import { resolveSupabaseConfig } from "@/lib/supabase-config";
import type { PhotoFingerprint } from "@/lib/phash";
import type { ServiceResult } from "@/types";

import {
  getAllRecords,
  getAllSales,
  markRecordSynced,
  markSalesSynced,
} from "./localdb";
import {
  pushRecords,
  salesToUpload,
  toSaleRow,
  type LocalRecordForSync,
  type SyncDeps,
} from "./syncCore";

const BUCKET = "record-images";

const resolved = resolveSupabaseConfig(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

let client: SupabaseClient | null = null;

export function cloudStatus(): { configured: boolean; message: string } {
  return resolved.ok
    ? { configured: true, message: "" }
    : { configured: false, message: resolved.message };
}

function getClient(): SupabaseClient | null {
  if (!resolved.ok) return null;
  if (!client) {
    client = createClient(resolved.config.url, resolved.config.key, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

function fail<T>(message: string): ServiceResult<T> {
  return { ok: false, error: { code: "server", message } };
}

/** Maps SDK errors to sentences that say what happened and what to do. */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "That email and password don’t match. Check them and try again.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "An account with that email already exists. Try signing in instead.";
  if (m.includes("email not confirmed")) return "Confirm your email first. Check your inbox for the link.";
  if (m.includes("password") && m.includes("characters")) return "Choose a longer password (at least 8 characters).";
  if (m.includes("rate limit")) return "Too many attempts. Wait a minute and try again.";
  if (m.includes("fetch") || m.includes("network")) return "No connection to the server. Check your network and try again.";
  return "That didn’t work. Check your details and try again.";
}

/* ---------------------------------------------------------------- account -- */

export interface CloudUser {
  id: string;
  email: string | null;
}

export async function currentUser(): Promise<CloudUser | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const { data } = await c.auth.getSession();
    const u = data.session?.user;
    return u ? { id: u.id, email: u.email ?? null } : null;
  } catch {
    return null;
  }
}

export async function signIn(email: string, password: string): Promise<ServiceResult<CloudUser>> {
  const c = getClient();
  if (!c) return fail(cloudStatus().message);
  try {
    const { data, error } = await c.auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.user) return fail(friendly(error?.message ?? ""));
    return { ok: true, data: { id: data.user.id, email: data.user.email ?? null } };
  } catch (e) {
    return fail(friendly(e instanceof Error ? e.message : ""));
  }
}

export async function signUp(
  email: string,
  password: string,
): Promise<ServiceResult<{ user: CloudUser | null; needsConfirmation: boolean }>> {
  const c = getClient();
  if (!c) return fail(cloudStatus().message);
  if (password.length < 8) return fail("Choose a longer password (at least 8 characters).");
  try {
    const { data, error } = await c.auth.signUp({ email: email.trim(), password });
    if (error) return fail(friendly(error.message));
    const hasSession = !!data.session;
    return {
      ok: true,
      data: {
        user: data.user ? { id: data.user.id, email: data.user.email ?? null } : null,
        needsConfirmation: !hasSession,
      },
    };
  } catch (e) {
    return fail(friendly(e instanceof Error ? e.message : ""));
  }
}

export async function signOut(): Promise<void> {
  try {
    await getClient()?.auth.signOut();
  } catch {
    /* signing out locally still succeeds */
  }
}

/* ------------------------------------------------------------------- sync -- */

export interface SyncSummary {
  recordsSynced: number;
  recordsFailed: { id: string; message: string }[];
  salesSynced: number;
  salesFailed: string | null;
  pendingBefore: number;
}

export async function syncAll(): Promise<ServiceResult<SyncSummary>> {
  const c = getClient();
  const user = await currentUser();
  if (!c) return fail(cloudStatus().message);
  if (!user) return fail("Sign in to sync your records.");

  try {
    const stored = await getAllRecords();
    const records = stored as unknown as LocalRecordForSync[];
    const pendingBefore = records.filter((r) => r.syncState !== "synced").length;

    const deps: SyncDeps = {
      userId: user.id,
      bandOf: (conf) => bandFor(conf),
      uploadImage: async (path, blob) => {
        const { error } = await c.storage
          .from(BUCKET)
          .upload(path, blob, { upsert: true, contentType: blob.type || "image/jpeg" });
        if (error) throw new Error(error.message);
      },
      upsertRecord: async (row) => {
        const { error } = await c.from("identification_records").upsert(row);
        if (error) throw new Error(error.message);
      },
      markSynced: markRecordSynced,
    };
    const res = await pushRecords(records, deps);

    // Sale prices: real ones only. Synthetic demo rows are never uploaded, and
    // the database would reject them anyway.
    let salesSynced = 0;
    let salesFailed: string | null = null;
    const toSend = salesToUpload(await getAllSales());
    if (toSend.length > 0) {
      const { error } = await c
        .from("sale_logs")
        .upsert(toSend.map((s) => toSaleRow(s, user.id)));
      if (error) salesFailed = error.message;
      else {
        await markSalesSynced(toSend.map((s) => s.id));
        salesSynced = toSend.length;
      }
    }

    return {
      ok: true,
      data: {
        recordsSynced: res.synced.length,
        recordsFailed: res.failed,
        salesSynced,
        salesFailed,
        pendingBefore,
      },
    };
  } catch (e) {
    return fail(friendly(e instanceof Error ? e.message : ""));
  }
}

/* ------------------------------------------------- cross-account duplicates -- */

export interface RemoteDuplicate {
  tier: "same" | "similar";
  distance: number;
  /** True when the earlier photo belongs to this account. */
  isOwn: boolean;
}

/**
 * Asks the database whether a similar photo exists on ANY account. The database
 * function returns only a distance, a tier and whether it is the caller's own
 * record: never an id, owner, location or (for others) a date. Compares
 * photographs, not animals. Returns null on any failure; never blocks.
 */
export async function remoteDuplicate(fp: PhotoFingerprint): Promise<RemoteDuplicate | null> {
  const c = getClient();
  if (!c || !(await currentUser())) return null;
  try {
    const { data, error } = await c.rpc("check_duplicate_photo", {
      p_hash: fp.hash,
      p_mirror: fp.mirror,
    });
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const r = data[0] as { distance: number; tier: "same" | "similar"; is_own: boolean };
    return { tier: r.tier, distance: r.distance, isOwn: r.is_own };
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- delete -- */

/**
 * Removes a synced record's cloud copy (row and image). Deleting locally while
 * leaving the cloud copy would leave the user believing their data is gone when
 * it is not, so callers must treat a failure here as "do not delete".
 */
export async function deleteRemoteRecord(id: string): Promise<ServiceResult<null>> {
  const c = getClient();
  const user = await currentUser();
  if (!c || !user)
    return fail("This record is saved to your account. Sign in to delete it from the cloud as well.");
  try {
    // The image path is read from the cloud row so it is always exact.
    const { data: row, error: readErr } = await c
      .from("identification_records")
      .select("image_path")
      .eq("id", id)
      .maybeSingle();
    if (readErr) return fail("The cloud copy could not be reached. Try again when you’re online.");

    if (row?.image_path) {
      const { error } = await c.storage.from(BUCKET).remove([row.image_path as string]);
      if (error) return fail("The cloud copy could not be deleted. Try again when you’re online.");
    }
    const { error: delErr } = await c.from("identification_records").delete().eq("id", id);
    if (delErr) return fail("The cloud copy could not be deleted. Try again when you’re online.");
    return { ok: true, data: null };
  } catch {
    return fail("The cloud copy could not be deleted. Try again when you’re online.");
  }
}
