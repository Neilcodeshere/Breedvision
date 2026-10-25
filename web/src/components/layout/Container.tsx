import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/cn";

type Width = "narrow" | "text" | "default" | "wide" | "full";

const WIDTH: Record<Width, string> = {
  narrow: "max-w-2xl",   // forms, single-column flows
  text: "max-w-3xl",     // long-form reading
  default: "max-w-6xl",  // most pages
  wide: "max-w-[88rem]", // dashboards, dense tables
  full: "max-w-none",
};

interface ContainerProps {
  as?: ElementType;
  width?: Width;
  children: ReactNode;
  className?: string;
}

export function Container({
  as: Tag = "div",
  width = "default",
  children,
  className,
}: ContainerProps) {
  return (
    <Tag className={cn("mx-auto w-full px-5 sm:px-8", WIDTH[width], className)}>
      {children}
    </Tag>
  );
}

type Spacing = "tight" | "default" | "loose";

const SPACING: Record<Spacing, string> = {
  tight: "py-10 sm:py-14",
  default: "py-14 sm:py-20",
  loose: "py-20 sm:py-28",
};

interface SectionProps {
  as?: ElementType;
  spacing?: Spacing;
  /** Subtle tonal shift to separate bands without drawing a box. */
  tone?: "paper" | "sunk" | "forest";
  children: ReactNode;
  className?: string;
}

const TONE = {
  paper: "",
  sunk: "bg-paper-sunk",
  forest: "bg-forest text-paper",
} as const;

export function Section({
  as: Tag = "section",
  spacing = "default",
  tone = "paper",
  children,
  className,
}: SectionProps) {
  return (
    <Tag className={cn(SPACING[spacing], TONE[tone], className)}>
      {children}
    </Tag>
  );
}

interface SectionHeadingProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Editorial layouts read better left-aligned; centre only for short bands. */
  align?: "start" | "center";
  className?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "start",
  className,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        align === "center" && "items-center text-center",
        className,
      )}
    >
      {eyebrow ? (
        <p className="text-micro font-semibold uppercase tracking-[0.14em] text-ink-3">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="text-section font-semibold text-balance text-ink">
        {title}
      </h2>
      {description ? (
        <p
          className={cn(
            "text-lead text-ink-2 text-pretty",
            align === "center" ? "max-w-2xl" : "max-w-xl",
          )}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}

/** Hairline rule. Warm, low contrast — separates without dividing. */
export function Rule({ className }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-line", className)} />;
}
