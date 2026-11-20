/**
 * Long lists drawn in part: only the rows near the visible area exist, two spacers keep the full
 * height (CueList: thousands of subtitles would take seconds to draw). Rows have their own heights,
 * measured once drawn, estimated before.
 */

/** Where each row starts, plus the total height at the end (n + 1 values). */
export function offsetsOf(heights: number[]): number[] {
  const out: number[] = Array.from({ length: heights.length + 1 }, () => 0);
  out[0] = 0;
  for (let i = 0; i < heights.length; i++) out[i + 1] = out[i] + heights[i];
  return out;
}

/** The first row whose bottom is below `y`. */
function rowAt(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] <= y) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo);
}

/** Rows to draw, [start, end), for a view from `top`, `height` tall, with `extra` px drawn around it. */
export function rangeAt(offsets: number[], top: number, height: number, extra: number): [number, number] {
  const n = offsets.length - 1;
  if (n <= 0) return [0, 0];
  const start = rowAt(offsets, Math.max(0, top - extra));
  const end = Math.min(n, rowAt(offsets, top + height + extra) + 1);
  return [start, end];
}

/**
 * Scroll position showing row `i`: centred, or the nearest edge (with a margin), or null when it's
 * already in view.
 */
export function scrollFor(offsets: number[], i: number, top: number, height: number, block: 'center' | 'nearest', margin = 8): number | null {
  const a = offsets[i];
  const b = offsets[i + 1];
  if (a === undefined || b === undefined) return null;
  if (a >= top + margin && b <= top + height - margin) return null;
  const max = Math.max(0, offsets[offsets.length - 1] - height);
  const want = block === 'center' ? a - (height - (b - a)) / 2 : a < top + margin ? a - margin : b - height + margin;
  return Math.min(max, Math.max(0, Math.round(want)));
}

/** Whether row `i` shows at least partly (`margin` px in) in the view. */
export const rowInView = (offsets: number[], i: number, top: number, height: number, margin = 8) =>
  offsets[i + 1] > top + margin && offsets[i] < top + height - margin;
