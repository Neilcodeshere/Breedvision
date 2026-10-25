"use client";

import type { ReactNode } from "react";

import { useT } from "@/i18n";
import { USE_MOCKS } from "@/services/config";
import { cn } from "@/lib/cn";

interface MockDataNoticeProps {
  /** What specifically is mocked on this screen. */
  what: ReactNode;
  className?: string;
}

/**
 * Shown wherever the screen renders data that did not come from a trained
 * model or a real backend. The user must never be unable to tell demo output
 * from a real prediction — that distinction is the product's credibility.
 *
 * Renders nothing once NEXT_PUBLIC_USE_MOCKS=false.
 */
export function MockDataNotice({ what, className }: MockDataNoticeProps) {
  const t = useT();
  if (!USE_MOCKS) return null;
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-md border border-terracotta/30 bg-terracotta-soft px-4 py-3",
        className,
      )}
    >
      <svg
        viewBox="0 0 16 16"
        className="mt-0.5 h-4 w-4 shrink-0 text-terracotta"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 5v3.5" strokeLinecap="round" />
        <circle cx="8" cy="11" r="0.75" fill="currentColor" stroke="none" />
      </svg>
      <p className="text-small text-ink-2">
        <strong className="font-semibold text-terracotta">{t("mock.label")}</strong>{" "}
        {what} {t("mock.tail")}
      </p>
    </div>
  );
}
