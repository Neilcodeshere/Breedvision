"use client";

import Link from "next/link";

import { useDateTag, useT } from "@/i18n";
import type { RemoteDuplicate } from "@/services/cloud";
import type { DuplicateMatch } from "@/services/duplicates";

/**
 * Says what was found and what it does not mean. The check compares photos, not
 * animals, so the wording never claims two photos show the same animal.
 */
export function DuplicateNotice({ match }: { match: DuplicateMatch }) {
  const t = useT();
  const dateTag = useDateTag();
  const when = new Date(match.createdAt).toLocaleDateString(dateTag, {
    dateStyle: "medium",
  });
  const same = match.tier === "same";

  return (
    <div
      role="status"
      className="rounded-md border border-amber/30 bg-amber-soft px-4 py-3"
    >
      <p className="text-small text-ink-2">
        <strong className="font-semibold text-amber">
          {same ? t("dup.same", { date: when }) : t("dup.similar", { date: when })}
        </strong>{" "}
        <Link
          href={`/history/${match.recordId}`}
          className="font-medium text-forest underline underline-offset-2"
        >
          {t("dup.view")}
        </Link>
      </p>
      <p className="mt-1 text-micro text-ink-3">{t("dup.caveat")}</p>
    </div>
  );
}

/**
 * A match found in the shared database. It deliberately says very little: the
 * database reveals only that a similar photo exists, and whether it is the
 * caller's own, never whose or when.
 */
export function RemoteDuplicateNotice({ match }: { match: RemoteDuplicate }) {
  const t = useT();
  const same = match.tier === "same";
  return (
    <div role="status" className="rounded-md border border-amber/30 bg-amber-soft px-4 py-3">
      <p className="text-small text-ink-2">
        <strong className="font-semibold text-amber">
          {same ? t("dup.remote.same") : t("dup.remote.similar")}
        </strong>{" "}
        {match.isOwn ? t("dup.remote.own") : t("dup.remote.shared")}
      </p>
      <p className="mt-1 text-micro text-ink-3">{t("dup.remote.caveat")}</p>
    </div>
  );
}
