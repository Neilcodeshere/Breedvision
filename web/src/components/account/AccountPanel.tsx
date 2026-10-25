"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Field";
import {
  cloudStatus,
  currentUser,
  signIn,
  signOut,
  signUp,
  syncAll,
  type CloudUser,
  type SyncSummary,
} from "@/services/cloud";

export function AccountPanel() {
  const status = cloudStatus();
  const [user, setUser] = useState<CloudUser | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SyncSummary | null>(null);

  const refresh = useCallback(async () => setUser(await currentUser()), []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  if (!status.configured) {
    return (
      <Card variant="sunk">
        <h2 className="text-body font-semibold text-ink">Cloud sync is off</h2>
        <p className="mt-2 max-w-prose text-small text-ink-2 text-pretty">
          {status.message} The app still works fully on this device: records,
          history and prices are saved locally. To enable accounts and sync, the
          deployment needs a Supabase project (see docs/supabase.md).
        </p>
      </Card>
    );
  }

  if (user === undefined) return <p className="text-small text-ink-3">Checking your account…</p>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    if (mode === "signin") {
      const r = await signIn(email, password);
      if (!r.ok) setError(r.error.message);
      else {
        setPassword("");
        await refresh();
      }
    } else {
      const r = await signUp(email, password);
      if (!r.ok) setError(r.error.message);
      else if (r.data.needsConfirmation) {
        setMessage("Account created. Check your email for a confirmation link, then sign in.");
        setMode("signin");
        setPassword("");
      } else {
        setPassword("");
        await refresh();
      }
    }
    setBusy(false);
  };

  const sync = async () => {
    setBusy(true);
    setError(null);
    const r = await syncAll();
    if (r.ok) setSummary(r.data);
    else setError(r.error.message);
    setBusy(false);
  };

  if (!user) {
    return (
      <Card>
        <h2 className="text-title font-semibold tracking-tight text-ink">
          {mode === "signin" ? "Sign in" : "Create an account"}
        </h2>
        <p className="mt-2 max-w-prose text-small text-ink-2 text-pretty">
          An account lets your records sync to the cloud and be checked for
          duplicate photos across accounts. It is optional; nothing here is
          needed to identify animals.
        </p>
        <form onSubmit={submit} className="mt-5 flex max-w-sm flex-col gap-4">
          <Field label="Email">
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
            <Input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </Field>
          {error ? <p role="alert" className="text-small text-clay">{error}</p> : null}
          {message ? <p role="status" className="text-small text-ink-2">{message}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            <Button
              type="button"
              variant="quiet"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
                setMessage(null);
              }}
            >
              {mode === "signin" ? "Need an account?" : "Have an account?"}
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="text-title font-semibold tracking-tight text-ink">Signed in</h2>
      <p className="mt-1 text-small text-ink-2">{user.email ?? "your account"}</p>

      <div className="mt-5 flex flex-wrap gap-3">
        <Button size="lg" onClick={sync} disabled={busy}>
          {busy ? "Syncing…" : "Sync now"}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            await signOut();
            setSummary(null);
            await refresh();
          }}
        >
          Sign out
        </Button>
      </div>

      {error ? <p role="alert" className="mt-4 text-small text-clay">{error}</p> : null}

      {summary ? (
        <div role="status" aria-live="polite" className="mt-4 text-small text-ink-2">
          <p>
            Records uploaded: <strong data-numeric="">{summary.recordsSynced}</strong> of{" "}
            <span data-numeric="">{summary.pendingBefore}</span> waiting.
            {summary.salesSynced > 0 ? ` Sale prices uploaded: ${summary.salesSynced}.` : ""}
          </p>
          {summary.recordsFailed.length > 0 ? (
            <p className="mt-1 text-clay">
              {summary.recordsFailed.length} record(s) could not be uploaded and will be retried.
              Reason: {summary.recordsFailed[0].message}
            </p>
          ) : null}
          {summary.salesFailed ? <p className="mt-1 text-clay">Sale prices could not be uploaded: {summary.salesFailed}</p> : null}
        </div>
      ) : null}

      <p className="mt-5 max-w-prose text-micro text-ink-3 text-pretty">
        Sync only <strong>uploads</strong> from this device. Records made on
        another device will not appear here yet. Demo (synthetic) prices are
        never uploaded.
      </p>
    </Card>
  );
}
