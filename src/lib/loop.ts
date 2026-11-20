/** Playback loop: a subtitle (follows its edits) or a fixed range around a moment. */
import type { Cue } from './types';

export type Loop = { cue: string } | { from: number; to: number };

/** Margin around a looped subtitle, and half-width of a loop around a moment. */
export const CUE_PAD_MS = 1000;
export const AROUND_MS = 3000;
/** Jumping this far outside the loop means you went elsewhere: the loop moves there. */
const LEAVE_MS = 1000;

export const loopAround = (t: number): Loop => ({ from: Math.max(0, t - AROUND_MS), to: t + AROUND_MS });

/**
 * Where the loop goes when you navigate to `t`: a subtitle loop moves to the subtitle there (if any),
 * otherwise the loop is 3 s around `t`.
 */
export function loopAt(current: Loop, t: number, cueIdAt: string | null): Loop {
  return 'cue' in current && cueIdAt ? { cue: cueIdAt } : loopAround(t);
}

export function loopRange(loop: Loop, cues: Cue[]): { from: number; to: number } | null {
  if ('from' in loop) return loop;
  const c = cues.find((x) => x.id === loop.cue);
  return c ? { from: Math.max(0, c.start - CUE_PAD_MS), to: c.end + CUE_PAD_MS } : null;
}

/** What to do at time `now`: jump back to the start, move the loop (you went elsewhere), or nothing. */
export function loopStep(range: { from: number; to: number }, now: number): 'wrap' | 'move' | null {
  if (now < range.from - LEAVE_MS || now > range.to + LEAVE_MS) return 'move';
  if (now >= range.to) return 'wrap';
  return null;
}
