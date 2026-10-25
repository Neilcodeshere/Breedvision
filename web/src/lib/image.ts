/**
 * Client-side image validation and downscaling.
 *
 * Field users are on phone cameras producing 4–10 MB images over patchy rural
 * connections. Downscaling before upload is the single biggest win available to
 * the identify flow, so it happens here rather than being left to the backend.
 */

import { IMAGE_LIMITS } from "@/services/config";
import type { ServiceError } from "@/types";

export interface PreparedImage {
  /** Downscaled file, ready to send. */
  file: File;
  /** Object URL for preview. Caller must revoke it when done. */
  previewUrl: string;
  width: number;
  height: number;
  originalBytes: number;
  bytes: number;
}

/** Cheap checks that need no decoding, so bad input fails instantly. */
export function validateImageFile(file: File): ServiceError | null {
  const accepted = IMAGE_LIMITS.acceptedTypes as readonly string[];
  if (!accepted.includes(file.type)) {
    return {
      code: "unsupported_format",
      message:
        "That file type isn’t supported. Choose a JPG, PNG or WEBP photo.",
    };
  }
  if (file.size > IMAGE_LIMITS.maxBytes) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      code: "image_too_large",
      message: `That photo is ${mb} MB. Choose one under ${
        IMAGE_LIMITS.maxBytes / (1024 * 1024)
      } MB.`,
    };
  }
  return null;
}

function loadBitmap(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    img.src = url;
  });
}

/**
 * Validate, decode and downscale an image.
 *
 * Returns the original file untouched if it is already small enough — there is
 * no point re-encoding (and degrading) an image that needs no change.
 */
export async function prepareImage(
  file: File,
): Promise<{ ok: true; data: PreparedImage } | { ok: false; error: ServiceError }> {
  const invalid = validateImageFile(file);
  if (invalid) return { ok: false, error: invalid };

  let img: HTMLImageElement;
  try {
    img = await loadBitmap(file);
  } catch {
    return {
      ok: false,
      error: {
        code: "invalid_image",
        message:
          "That image could not be opened. It may be damaged — try another photo.",
      },
    };
  }

  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = Math.min(1, IMAGE_LIMITS.maxEdgePx / longest);

  if (scale === 1) {
    return {
      ok: true,
      data: {
        file,
        previewUrl: URL.createObjectURL(file),
        width: img.naturalWidth,
        height: img.naturalHeight,
        originalBytes: file.size,
        bytes: file.size,
      },
    };
  }

  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return {
      ok: false,
      error: {
        code: "invalid_image",
        message: "This browser could not process the image. Try another photo.",
      },
    };
  }
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", IMAGE_LIMITS.compressQuality),
  );
  if (!blob) {
    return {
      ok: false,
      error: {
        code: "invalid_image",
        message: "The image could not be prepared for upload. Try another photo.",
      },
    };
  }

  const resized = new File([blob], replaceExtension(file.name, "jpg"), {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });

  return {
    ok: true,
    data: {
      file: resized,
      previewUrl: URL.createObjectURL(resized),
      width,
      height,
      originalBytes: file.size,
      bytes: resized.size,
    },
  };
}

function replaceExtension(name: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot === -1 ? name : name.slice(0, dot)}.${ext}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
