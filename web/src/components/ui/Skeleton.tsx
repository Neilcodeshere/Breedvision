import { cn } from "@/lib/cn";

interface SkeletonProps {
  className?: string;
  /** Describes what is loading, for screen readers. */
  label?: string;
}

/** Placeholder block shown while content loads. Pulses gently; respects
 *  prefers-reduced-motion via the global rule in globals.css. */
export function Skeleton({ className, label }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-sm bg-cream/70", className)}
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">{label ?? "Loading"}</span>
    </div>
  );
}
