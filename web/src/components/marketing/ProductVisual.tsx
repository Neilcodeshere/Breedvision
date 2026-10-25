"use client";

import { ConfidenceIndicator } from "@/components/prediction/ConfidenceIndicator";
import { T } from "@/i18n";
import { cn } from "@/lib/cn";

/**
 * A rendering of the product's own result screen, used as the hero visual.
 *
 * Deliberately not a stock photograph and not an abstract "AI" illustration:
 * the most honest thing to show someone deciding whether to use this is the
 * thing they will actually see.
 *
 * The image area is an explicit placeholder — no real cattle photography has
 * been licensed for this project yet, and inventing one would misrepresent the
 * product. Swap `PhotoPlaceholder` for a real photograph when one exists.
 */

function PhotoPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 bg-cream",
        className,
      )}
      role="img"
      aria-label="Placeholder for the photographed animal"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-7 w-7 text-ink-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.1-1.8A1.5 1.5 0 0 1 9.1 4.5h5.8a1.5 1.5 0 0 1 1.3.7L17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
        <circle cx="12" cy="12.8" r="3.4" />
      </svg>
      <span className="text-micro text-ink-3"><T k="visual.photo" /></span>
    </div>
  );
}

export function ProductVisual({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow-float)]",
        className,
      )}
    >
      <PhotoPlaceholder className="aspect-4/3 w-full border-b border-line" />

      <div className="p-5 sm:p-6">
        <p className="text-micro font-semibold uppercase tracking-[0.14em] text-ink-3">
          <T k="pred.predicted" />
        </p>
        <p className="mt-1.5 text-section font-semibold tracking-tight text-ink">
          Gir
        </p>

        <div className="mt-4">
          <ConfidenceIndicator value={0.914} size="sm" />
        </div>

        <div className="mt-5 border-t border-line pt-4">
          <p className="text-micro font-semibold text-ink-2">
            <T k="pred.other" />
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {[
              ["Sahiwal", "4.2%"],
              ["Kankrej", "2.1%"],
            ].map(([name, value]) => (
              <li
                key={name}
                className="flex items-center justify-between text-small"
              >
                <span className="text-ink-2">{name}</span>
                <span data-numeric="" className="text-ink-3">
                  {value}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
