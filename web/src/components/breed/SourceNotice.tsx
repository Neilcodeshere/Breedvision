"use client";

import { useT } from "@/i18n";
import { cn } from "@/lib/cn";

interface SourceNoticeProps {
  source: string | null;
  sourceUrl: string | null;
  className?: string;
}

/**
 * Provenance for breed facts.
 *
 * A null source means the breed description has not been checked against an
 * authority, and the UI must say so rather than letting unattributed text read
 * as established fact. Phase 16 populates these from ICAR-NBAGR.
 */
export function SourceNotice({ source, sourceUrl, className }: SourceNoticeProps) {
  const t = useT();
  if (!source) {
    return (
      <div
        className={cn(
          "rounded-md border border-amber/30 bg-amber-soft px-4 py-3",
          className,
        )}
      >
        <p className="text-small text-ink-2">
          <strong className="font-semibold text-amber">
            {t("src.unverifiedHead")}
          </strong>{" "}
          {t("src.unverifiedBody")}
        </p>
      </div>
    );
  }

  return (
    <p className={cn("text-micro text-ink-3", className)}>
      {t("src.label")}{" "}
      {sourceUrl ? (
        <a
          href={sourceUrl}
          className="text-forest underline underline-offset-2"
          rel="noreferrer noopener"
          target="_blank"
        >
          {source}
        </a>
      ) : (
        source
      )}
    </p>
  );
}
