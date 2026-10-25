"use client";

import { useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { bandFor, formatConfidence } from "@/lib/confidence";
import type { ConfidenceBand } from "@/types";

const SEGMENTS = 10;

const BAND_STYLE: Record<
  ConfidenceBand,
  { fill: string; text: string; dot: string }
> = {
  confident: {
    fill: "bg-forest-mid",
    text: "text-forest-deep",
    dot: "bg-forest-mid",
  },
  uncertain: { fill: "bg-amber", text: "text-amber", dot: "bg-amber" },
  low: { fill: "bg-clay", text: "text-clay", dot: "bg-clay" },
};

interface ConfidenceIndicatorProps {
  /** 0..1 */
  value: number;
  /** Hide the numeric value where the band alone is the message. */
  showValue?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Confidence meter.
 *
 * Deliberately communicates through three redundant channels — a written band
 * label, a segmented fill, and the number itself — so the reading never depends
 * on colour alone. This is an accessibility requirement and, more importantly,
 * a trust requirement: an agricultural officer must be able to tell a strong
 * result from a weak one at a glance and be right.
 */
export function ConfidenceIndicator({
  value,
  showValue = true,
  size = "md",
  className,
}: ConfidenceIndicatorProps) {
  const t = useT();
  const band = bandFor(value);
  const style = BAND_STYLE[band];
  const filled = Math.max(1, Math.round(value * SEGMENTS));
  const percent = formatConfidence(value);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 font-medium",
            size === "sm" ? "text-micro" : "text-small",
            style.text,
          )}
        >
          <span
            aria-hidden="true"
            className={cn("h-1.5 w-1.5 rounded-full", style.dot)}
          />
          {t(`band.${band}.label` as const)}
        </span>
        {showValue ? (
          <span
            data-numeric=""
            className={cn(
              "font-semibold text-ink",
              size === "sm" ? "text-small" : "text-body",
            )}
          >
            {percent}
          </span>
        ) : null}
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Number((value * 100).toFixed(1))}
        aria-valuetext={`${percent} — ${t(`band.${band}.label` as const)}`}
        className={cn(
          "flex gap-[3px]",
          size === "sm" ? "h-1.5" : "h-2",
        )}
      >
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "flex-1 rounded-xs transition-colors duration-200",
              i < filled ? style.fill : "bg-cream",
            )}
          />
        ))}
      </div>
    </div>
  );
}
