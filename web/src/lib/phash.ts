/** Browser side of the perceptual hash: decode, downscale, greyscale. */

import { mirrorGray, phashFromGray, SIZE } from "./phash-core";

export interface PhotoFingerprint {
  /** 16 hex characters, 64-bit pHash. */
  hash: string;
  /** Hash of the horizontally mirrored photo. */
  mirror: string;
}

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
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
 * Downscale by repeated halving, then a final draw to 32x32.
 *
 * A single drawImage from 1280 px to 32 px aliases badly, because the browser
 * samples only a few source pixels per target pixel. Halving first averages
 * properly, which keeps this close to the Lanczos resize the thresholds were
 * measured with.
 */
function toGray32(src: ImageBitmap | HTMLImageElement): number[] {
  let w = "naturalWidth" in src ? src.naturalWidth : src.width;
  let h = "naturalHeight" in src ? src.naturalHeight : src.height;
  let current: CanvasImageSource = src;

  while (w > SIZE * 2 || h > SIZE * 2) {
    const nw = Math.max(SIZE, Math.floor(w / 2));
    const nh = Math.max(SIZE, Math.floor(h / 2));
    const c = document.createElement("canvas");
    c.width = nw;
    c.height = nh;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(current, 0, 0, nw, nh);
    current = c;
    w = nw;
    h = nh;
  }

  const out = document.createElement("canvas");
  out.width = SIZE;
  out.height = SIZE;
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(current, 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;

  const gray = new Array<number>(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    // ITU-R 601 luma with integer floor, exactly as PIL's convert("L").
    gray[i] = Math.floor(
      (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000,
    );
  }
  return gray;
}

export async function fingerprintBlob(blob: Blob): Promise<PhotoFingerprint> {
  const src = await decode(blob);
  try {
    const gray = toGray32(src);
    return { hash: phashFromGray(gray), mirror: phashFromGray(mirrorGray(gray)) };
  } finally {
    if ("close" in src) src.close();
  }
}
