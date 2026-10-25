/**
 * Supabase configuration, validated before a client is ever created.
 *
 * Pure (no browser or SDK imports) so it can be tested directly.
 *
 * The one mistake this exists to prevent: pasting the SERVICE-ROLE key into a
 * NEXT_PUBLIC_ variable. Anything with that prefix is bundled into the browser
 * and readable by every visitor, and the service-role key bypasses all of the
 * row-level security rules, giving full read/write access to every user's data.
 * Supabase keys are JWTs carrying a `role` claim, so the role can be inspected.
 */

export interface SupabaseConfig {
  url: string;
  key: string;
}

export type ConfigResult =
  | { ok: true; config: SupabaseConfig }
  | { ok: false; reason: "not-configured" | "unsafe-key" | "bad-url"; message: string };

function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

export function resolveSupabaseConfig(
  url: string | undefined,
  key: string | undefined,
): ConfigResult {
  const u = (url ?? "").trim();
  const k = (key ?? "").trim();

  if (!u || !k) {
    return {
      ok: false,
      reason: "not-configured",
      message: "Cloud sync is not set up for this deployment.",
    };
  }

  // New-style secret keys are recognisable by prefix; legacy ones by JWT role.
  if (k.startsWith("sb_secret_") || jwtRole(k) === "service_role") {
    return {
      ok: false,
      reason: "unsafe-key",
      message:
        "A server-only (service-role / secret) key was supplied to the browser. It was NOT used. Replace it with the public anon / publishable key and rotate the exposed key in the Supabase dashboard.",
    };
  }

  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return { ok: false, reason: "bad-url", message: "The Supabase URL must use https." };
    }
  } catch {
    return { ok: false, reason: "bad-url", message: "The Supabase URL is not valid." };
  }

  return { ok: true, config: { url: u.replace(/\/+$/, ""), key: k } };
}
