import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Custom scale names must be declared, or tailwind-merge silently drops classes.
 *
 * `text-*` is ambiguous: `text-lead` is a font size and `text-paper` is a
 * colour, but both are project-defined so tailwind-merge cannot classify them
 * from its built-in tables. It defaults to treating them as one conflict group
 * and keeps only the last one — which silently stripped `text-paper` from the
 * primary button, rendering charcoal on green at 3.15:1 instead of paper on
 * green at 5.21:1.
 *
 * Declaring both groups fixes that class of bug for good. Add new token names
 * here whenever the scales in globals.css change.
 */
const FONT_SIZES = [
  "display",
  "section",
  "title",
  "lead",
  "body",
  "small",
  "micro",
];

const TEXT_COLORS = [
  "paper",
  "paper-sunk",
  "surface",
  "cream",
  "ink",
  "ink-2",
  "ink-3",
  "ink-4",
  "line",
  "line-strong",
  "field-line",
  "forest",
  "forest-deep",
  "forest-mid",
  "forest-soft",
  "terracotta",
  "terracotta-soft",
  "amber",
  "amber-soft",
  "clay",
  "clay-soft",
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: FONT_SIZES }],
      "text-color": [{ text: TEXT_COLORS }],
    },
  },
});

/** Merge conditional class names, with later Tailwind utilities winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
