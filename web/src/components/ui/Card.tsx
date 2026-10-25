import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/cn";

type Variant = "outlined" | "sunk" | "raised" | "plain";

const VARIANT: Record<Variant, string> = {
  /** Default. A single warm hairline — structure without visual weight. */
  outlined: "border border-line bg-surface",
  /** Recessed well, for secondary content inside an already-bordered area. */
  sunk: "bg-paper-sunk",
  /** Reserved for content that genuinely floats (popovers, result summary). */
  raised: "border border-line bg-surface shadow-[var(--shadow-float)]",
  /** No container at all. Use this by default in editorial layouts. */
  plain: "",
};

interface CardProps {
  as?: ElementType;
  variant?: Variant;
  /** Set false when the child manages its own padding (e.g. a full-bleed image). */
  padded?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * A container — used sparingly.
 *
 * Hierarchy in this product comes from typography and spacing, not from
 * wrapping every element in a rounded rectangle. Reach for `plain` first and
 * only add a border when the content genuinely needs separating.
 */
export function Card({
  as: Tag = "div",
  variant = "outlined",
  padded = true,
  children,
  className,
}: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-lg",
        VARIANT[variant],
        padded && "p-5 sm:p-6",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: CardHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h3 className="text-body font-semibold text-ink">{title}</h3>
        {description ? (
          <p className="mt-1 text-small text-ink-3">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
