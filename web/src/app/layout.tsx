import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Devanagari, Noto_Sans_Tamil, Noto_Sans_Telugu } from "next/font/google";

import { LocaleSync } from "@/i18n";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Inter has no Devanagari, Tamil or Telugu glyphs. These load by unicode range,
// so a visitor reading English never downloads them.
const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  variable: "--font-devanagari",
  display: "swap",
});
const tamil = Noto_Sans_Tamil({
  subsets: ["tamil"],
  variable: "--font-tamil",
  display: "swap",
});
const telugu = Noto_Sans_Telugu({
  subsets: ["telugu"],
  variable: "--font-telugu",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "BreedVision — Breed identification for Indian livestock",
    template: "%s — BreedVision",
  },
  description:
    "Image-based breed identification for Indian cattle. Photograph an animal, get a predicted breed with a confidence score, and keep a record.",
};

export const viewport: Viewport = {
  themeColor: "#faf7f1",
  // Field users need to be able to zoom into an animal photo.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${devanagari.variable} ${tamil.variable} ${telugu.variable}`}>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-small focus:font-medium focus:shadow-[var(--shadow-float)]"
        >
          Skip to content
        </a>
        <LocaleSync>{children}</LocaleSync>
      </body>
    </html>
  );
}
