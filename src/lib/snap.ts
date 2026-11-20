/** Timeline magnet (components/timeline/useCueDrag): what a dragged edge or block can catch. */

export type SnapKind = 'playhead' | 'subtitle' | 'speech';
export interface SnapPoint {
  at: number;
  kind: SnapKind;
}

/** The point nearest to `ms` within `threshold` (all in ms), or null when none is in reach. */
export function snapNear(ms: number, points: SnapPoint[], threshold: number): SnapPoint | null {
  let best: SnapPoint | null = null;
  let bestD = threshold;
  for (const p of points) {
    const d = Math.abs(p.at - ms);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/**
 * The points a drag can catch:
 * - the playhead where it was when the drag began (it follows the dragged edge afterwards:
 *   catching that would hold the edge back at every move);
 * - the neighbours' edges, the minimum gap away;
 * - where speech starts and ends (the dialogue waveform's spans, already padded a little: a
 *   subtitle caught there shows just before the voice).
 */
export function snapPoints(playheadAtStart: number, others: { start: number; end: number }[], minGapMs: number, speech: [number, number][] = []): SnapPoint[] {
  const points: SnapPoint[] = [{ at: playheadAtStart, kind: 'playhead' }];
  for (const c of others) points.push({ at: c.start - minGapMs, kind: 'subtitle' }, { at: c.end + minGapMs, kind: 'subtitle' });
  for (const [a, b] of speech) points.push({ at: a, kind: 'speech' }, { at: b, kind: 'speech' });
  return points;
}
