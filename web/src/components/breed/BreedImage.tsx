"use client";

import { useT } from "@/i18n";
import { cn } from "@/lib/cn";
import type { AnimalCategory } from "@/types";

interface BreedImageProps {
  name: string;
  category: AnimalCategory;
  imageUrl: string | null;
  className?: string;
  /** Larger monogram and a visible caption, for the detail page. */
  size?: "card" | "hero";
}

/**
 * Breed photograph, or an honest stand-in when none exists.
 *
 * No cattle or buffalo photography has been licensed for this project, and
 * every breed in the current dataset has `imageUrl: null`. Rather than fill the
 * gap with stock imagery of the wrong animal — which would actively mislead on
 * a breed-identification product — this renders a monogram placeholder that is
 * unmistakably not a photograph.
 */
export function BreedImage({
  name,
  category,
  imageUrl,
  className,
  size = "card",
}: BreedImageProps) {
  const t = useT();
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={`${name} ${category}`}
        className={cn("h-full w-full object-cover", className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-1 bg-cream",
        className,
      )}
      role="img"
      aria-label={t("breed.noPhotoFor", { name })}
    >
      <span
        aria-hidden="true"
        className={cn(
          "font-semibold tracking-tight text-ink-4",
          size === "hero" ? "text-section" : "text-title",
        )}
      >
        {name.slice(0, 2)}
      </span>
      {size === "hero" ? (
        <span className="text-micro text-ink-3">{t("breed.noPhoto")}</span>
      ) : null}
    </div>
  );
}
