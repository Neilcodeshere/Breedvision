import { cn } from "@/lib/cn";

interface LogoProps {
  className?: string;
  /** Renders the mark only, for tight spaces such as the mobile header. */
  markOnly?: boolean;
}

/**
 * Wordmark. The mark is an aperture/lens ring around a horn silhouette —
 * camera plus animal, which is exactly what the product does.
 */
export function Logo({ className, markOnly = false }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg
        viewBox="0 0 28 28"
        className="h-7 w-7 shrink-0"
        aria-hidden="true"
        fill="none"
      >
        <circle
          cx="14"
          cy="14"
          r="12.5"
          stroke="currentColor"
          strokeWidth="1.5"
          opacity="0.35"
        />
        <path
          d="M7.5 10.5c0 4.2 2.9 7.5 6.5 7.5s6.5-3.3 6.5-7.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M7.5 10.5c-1.6-.6-2.6-1.6-3-3 1.7-.5 3.1-.2 4.2.9M20.5 10.5c1.6-.6 2.6-1.6 3-3-1.7-.5-3.1-.2-4.2.9"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="14" cy="12.5" r="1.6" fill="currentColor" />
      </svg>
      {markOnly ? null : (
        <span className="text-body font-semibold tracking-[-0.015em]">
          BreedVision
        </span>
      )}
    </span>
  );
}
