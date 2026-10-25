import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type Tone = "neutral" | "forest" | "amber" | "clay" | "terracotta";

const TONE: Record<Tone, string> = {
  neutral: "bg-paper-sunk text-ink-2 border-line",
  forest: "bg-forest-soft text-forest-deep border-forest/20",
  amber: "bg-amber-soft text-amber border-amber/25",
  clay: "bg-clay-soft text-clay border-clay/25",
  terracotta: "bg-terracotta-soft text-terracotta border-terracotta/25",
};

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

/** Small status tag. Tone is never the only signal — the text carries meaning. */
export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5",
        "text-micro font-medium",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

interface EyebrowProps {
  children: ReactNode;
  className?: string;
}

/** Uppercase section label. Used to anchor editorial sections without a card. */
export function Eyebrow({ children, className }: EyebrowProps) {
  return (
    <p
      className={cn(
        "text-micro font-semibold uppercase tracking-[0.14em] text-ink-3",
        className,
      )}
    >
      {children}
    </p>
  );
}
