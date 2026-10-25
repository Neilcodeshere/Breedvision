/**
 * Perceptual hash, pure maths (no DOM), matching Python `imagehash.phash`
 * with hash_size = 8: a 32x32 greyscale image, 2-D DCT-II, the top-left 8x8
 * low-frequency block, each coefficient compared with the block's median.
 *
 * Kept free of browser APIs so it can be tested bit-for-bit against the Python
 * implementation that the thresholds were measured with
 * (ml/scripts/eval_duplicate_detection.py). A hash that quietly differed from
 * the measured one would invalidate those thresholds.
 */

export const SIZE = 32;
const LOW = 8;

/** Unnormalised DCT-II, as scipy.fftpack.dct(type=2) computes it. */
const COS: number[][] = Array.from({ length: LOW }, (_, k) =>
  Array.from({ length: SIZE }, (_, n) =>
    2 * Math.cos((Math.PI * (2 * n + 1) * k) / (2 * SIZE)),
  ),
);

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** `gray` is SIZE*SIZE values, row-major. Returns 16 hex characters. */
export function phashFromGray(gray: ArrayLike<number>): string {
  if (gray.length !== SIZE * SIZE) throw new Error("expected a 32x32 image");

  // Only the 8x8 low-frequency block is needed, so compute just that.
  // rows[y][u] = DCT along x for the first LOW frequencies.
  const rows: number[][] = [];
  for (let y = 0; y < SIZE; y++) {
    const r: number[] = [];
    for (let u = 0; u < LOW; u++) {
      let sum = 0;
      for (let x = 0; x < SIZE; x++) sum += gray[y * SIZE + x] * COS[u][x];
      r.push(sum);
    }
    rows.push(r);
  }
  const block: number[] = [];
  for (let v = 0; v < LOW; v++) {
    for (let u = 0; u < LOW; u++) {
      let sum = 0;
      for (let y = 0; y < SIZE; y++) sum += rows[y][u] * COS[v][y];
      block.push(sum);
    }
  }

  const med = median(block);
  let bits = "";
  for (const c of block) bits += c > med ? "1" : "0";

  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Horizontal mirror of a SIZE x SIZE image. */
export function mirrorGray(gray: ArrayLike<number>): number[] {
  const out: number[] = new Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) out[y * SIZE + x] = gray[y * SIZE + (SIZE - 1 - x)];
  return out;
}

const POP = Array.from({ length: 16 }, (_, n) => n.toString(2).replace(/0/g, "").length);

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) throw new Error("hash length mismatch");
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

/**
 * Distance between a new photo and a stored one, trying the mirrored version
 * of the new photo as well. A mirrored copy is the cheapest way to dodge a
 * plain hash comparison, and checking it measured no meaningful false-positive
 * cost (1 of 79,800 distinct-photo pairs at distance 8, none at 6 or below).
 */
export function matchDistance(
  fresh: { hash: string; mirror: string },
  stored: string,
): number {
  return Math.min(hamming(fresh.hash, stored), hamming(fresh.mirror, stored));
}

/** Thresholds measured in docs/duplicate-detection.md. */
export const SAME_PHOTO_MAX = 4;
export const SIMILAR_PHOTO_MAX = 8;

export type MatchTier = "same" | "similar";

export function tierFor(distance: number): MatchTier | null {
  if (distance <= SAME_PHOTO_MAX) return "same";
  if (distance <= SIMILAR_PHOTO_MAX) return "similar";
  return null;
}
