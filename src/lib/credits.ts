/**
 * The end credits, found in the filmstrip: light text on black makes a long stretch of dark pictures
 * in the last part of the film. Measured on the keyframes' average colours (store/thumbs.ts), so it
 * costs nothing more. Credits rolling over pictures aren't found (null).
 */

export interface CreditsOptions {
  /** Average brightness (0…255) under which a picture counts as dark. */
  dark: number;
  /** The shortest stretch of dark pictures that makes credits. */
  minRunMs: number;
  /** Where to look: this last part of the film. */
  lastPart: number;
  /** Bright pictures in a row allowed inside the credits (a logo, a title card). */
  allowBright: number;
}

// Tried on a dark horror film: its night scenes reach 20 on average and last up to 1.5 min, its
// credits stay under 12 for 7 min.
export const CREDITS_OPTIONS: CreditsOptions = { dark: 16, minRunMs: 90000, lastPart: 0.25, allowBright: 1 };

/** Perceived brightness of an average colour, 0…255. */
export const luma = ([r, g, b]: readonly [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** When the end credits start (ms), or null: the first long dark stretch in the last part of the film. */
export function creditsStart(
  times: readonly number[],
  colours: readonly (readonly [number, number, number])[],
  durationMs: number,
  o: CreditsOptions = CREDITS_OPTIONS,
): number | null {
  const from = durationMs * (1 - o.lastPart);
  let start: number | null = null;
  let lastDark = 0;
  let bright = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] < from) continue;
    if (luma(colours[i]) < o.dark) {
      start ??= times[i];
      lastDark = times[i];
      bright = 0;
    } else if (start !== null && ++bright > o.allowBright) {
      if (lastDark - start >= o.minRunMs) return start;
      start = null;
      bright = 0;
    }
  }
  return start !== null && lastDark - start >= o.minRunMs ? start : null;
}
