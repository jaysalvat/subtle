/** Pure helpers for the video filmstrip. */

/** Gap between thumbnails: at least 2 s, and at most `maxThumbs` for the whole film. */
export function thumbGapMs(durationMs: number, maxThumbs = 600): number {
  return Math.max(2000, durationMs / maxThumbs);
}

/** Index of the last item whose time is ≤ t (items sorted by time), or the first one. */
export function thumbAt(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
