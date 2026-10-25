/**
 * Design tokens as plain values.
 *
 * `globals.css` is the source of truth for the web app. This file mirrors the
 * same values as framework-agnostic constants so the Expo field app can share
 * one visual system without importing CSS. Keep the two in sync — if you change
 * a colour here, change it there.
 */

export const color = {
  paper: "#faf7f1",
  paperSunk: "#f2eee5",
  surface: "#ffffff",
  cream: "#ede7d9",

  ink: "#1a1917",
  ink2: "#46433c",
  ink3: "#6b665c",
  ink4: "#756f62",

  line: "#e3dcce",
  lineStrong: "#cfc6b3",
  /** Bounds form controls; meets the 3:1 non-text contrast requirement. */
  fieldLine: "#94876d",

  forest: "#347453",
  forestDeep: "#276046",
  /** Fill only — fails AA as text. Use forestDeep for text on tints. */
  forestMid: "#3a7f5b",
  forestSoft: "#eaf4ec",

  terracotta: "#a4512b",
  terracottaSoft: "#f7ece4",

  amber: "#8a6614",
  amberSoft: "#f6eedc",
  clay: "#8f3a22",
  claySoft: "#f8eae5",
} as const;

/** 4px base scale. */
export const space = {
  0.5: 2,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

export const radius = { xs: 2, sm: 3, md: 5, lg: 8, full: 999 } as const;

export const fontSize = {
  display: 52,
  section: 34,
  title: 28,
  lead: 18,
  body: 16,
  small: 14,
  micro: 13,
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
} as const;

/** Matches Tailwind's default breakpoints, named for intent. */
export const breakpoint = {
  phone: 0,
  tablet: 768,
  laptop: 1024,
  desktop: 1280,
} as const;

export const duration = { fast: 120, base: 180, slow: 260 } as const;

export const easing = "cubic-bezier(0.22, 0.61, 0.36, 1)";
