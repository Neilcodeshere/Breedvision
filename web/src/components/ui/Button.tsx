import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  // The single most important action on a screen. Forest green appears here
  // and in the "confident" state only, so it keeps its meaning.
  primary:
    "bg-forest text-paper border border-forest hover:bg-forest-deep hover:border-forest-deep active:bg-forest-deep",
  secondary:
    "bg-surface text-ink border border-field-line hover:bg-paper-sunk hover:border-ink-2",
  quiet:
    "bg-transparent text-ink-2 border border-transparent hover:bg-paper-sunk hover:text-ink",
  danger:
    "bg-surface text-clay border border-clay/35 hover:bg-clay-soft hover:border-clay/60",
};

/** Heights meet a 44px minimum touch target from `md` up — this product is
 *  used one-handed, outdoors, on a phone. */
const SIZE: Record<Size, string> = {
  sm: "h-9 px-3 text-small gap-1.5",
  md: "h-11 px-4 text-body gap-2",
  lg: "h-13 px-6 text-lead gap-2.5",
};

interface BaseProps {
  variant?: Variant;
  size?: Size;
  /** Stretch to the container — used for the primary field action. */
  block?: boolean;
  /** Decorative only; hidden from assistive tech. */
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  children: ReactNode;
  className?: string;
}

function classes({ variant = "primary", size = "md", block, className }: BaseProps) {
  return cn(
    "inline-flex items-center justify-center rounded-md font-medium",
    "transition-colors duration-150 ease-[cubic-bezier(0.22,0.61,0.36,1)]",
    "disabled:pointer-events-none disabled:opacity-45",
    "aria-disabled:pointer-events-none aria-disabled:opacity-45",
    VARIANT[variant],
    SIZE[size],
    block && "w-full",
    className,
  );
}

type ButtonProps = BaseProps &
  Omit<ComponentPropsWithoutRef<"button">, "children" | "className">;

export function Button({
  variant,
  size,
  block,
  iconLeft,
  iconRight,
  children,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classes({ variant, size, block, className, children })}
      {...rest}
    >
      {iconLeft ? <span aria-hidden="true">{iconLeft}</span> : null}
      {children}
      {iconRight ? <span aria-hidden="true">{iconRight}</span> : null}
    </button>
  );
}

type ButtonLinkProps = BaseProps &
  Omit<ComponentPropsWithoutRef<typeof Link>, "children" | "className">;

/** Same visual treatment as Button, but renders a real anchor so the
 *  destination is right-clickable, middle-clickable and readable by crawlers. */
export function ButtonLink({
  variant,
  size,
  block,
  iconLeft,
  iconRight,
  children,
  className,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link
      className={classes({ variant, size, block, className, children })}
      {...rest}
    >
      {iconLeft ? <span aria-hidden="true">{iconLeft}</span> : null}
      {children}
      {iconRight ? <span aria-hidden="true">{iconRight}</span> : null}
    </Link>
  );
}
