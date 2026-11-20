/**
 * Sync assistant maths: subtitles are re-timed from one anchor (constant offset) or two anchors
 * (offset + speed). An anchor is "this subtitle actually starts at this time in the video".
 */
import { FPS_CONVERSIONS, type FpsConversion } from './fps';
import { applyLinear, linearFromAnchors, shiftCues } from './tools';
import type { Cue } from './types';

export interface Anchor {
  /** Start of the subtitle in the original file. */
  from: number;
  /** Where it is actually spoken in the video. */
  to: number;
}

export interface SyncResult {
  scale: number;
  offset: number;
  /** Set when the speed matches a frame rate conversion (scale rounded to it). */
  fps?: FpsConversion;
}

/** Within this relative distance, a speed is taken as a frame rate conversion (0.2 %). */
const FPS_TOLERANCE = 0.002;

export function solveSync(a: Anchor, b?: Anchor): SyncResult {
  if (!b || a.from === b.from) return { scale: 1, offset: a.to - a.from };
  const { scale, offset } = linearFromAnchors(a, b);
  const fps = FPS_CONVERSIONS.find((c) => Math.abs(scale / c.scale - 1) < FPS_TOLERANCE);
  // Snap to the exact conversion, keeping the first anchor exact.
  if (fps) return { scale: fps.scale, offset: a.to - fps.scale * a.from, fps };
  return { scale, offset };
}

export function applySync(cues: Cue[], r: SyncResult): Cue[] {
  return r.scale === 1 ? shiftCues(cues, r.offset) : applyLinear(cues, r.scale, r.offset);
}

/** A line that's easy to recognise by ear: at least 1 s, a few words, not a sound tag. */
export const isGoodLine = (c: Cue) => c.end - c.start >= 1000 && c.text.replace(/<[^>]+>|\{\\[^}]*\}/g, '').trim().length >= 8 && !/\[[^\]]*\]|♪/.test(c.text);

/** A clear line to listen for, at or after `fraction` of the list (first good one). */
export function pickLine(cues: Cue[], fraction: number): number {
  const startAt = Math.min(cues.length - 1, Math.max(0, Math.floor(fraction * cues.length)));
  for (let i = startAt; i < cues.length; i++) if (isGoodLine(cues[i])) return i;
  for (let i = startAt - 1; i >= 0; i--) if (isGoodLine(cues[i])) return i;
  return startAt;
}

/**
 * The line to sync on: the k-th from the start or from the end (past the opening credits, before the
 * closing ones), a clear one — the nearest further in.
 */
export function pickLineAt(cues: Cue[], k: number, from: 'start' | 'end'): number {
  const n = cues.length;
  const at = from === 'start' ? Math.min(n - 1, k - 1) : Math.max(0, n - k);
  const step = from === 'start' ? 1 : -1;
  for (let i = at; i >= 0 && i < n; i += step) if (isGoodLine(cues[i])) return i;
  for (let i = at - step; i >= 0 && i < n; i -= step) if (isGoodLine(cues[i])) return i;
  return Math.max(0, at);
}

/** Where the k-th line of dialogue from the start or the end begins (speech spans, ms), or null. */
export function speechAt(spans: [number, number][] | null | undefined, k: number, from: 'start' | 'end'): number | null {
  if (!spans?.length) return null;
  const i = from === 'start' ? Math.min(spans.length - 1, k - 1) : Math.max(0, spans.length - k);
  return spans[i][0];
}

/** "+1:23.4" / "−0.3 s" style offset, for people. */
export function formatOffset(ms: number): string {
  const sign = ms < 0 ? '−' : '+';
  const a = Math.abs(ms) / 1000;
  if (a < 60) return `${sign}${a.toFixed(1)} s`;
  const m = Math.floor(a / 60);
  return `${sign}${m}:${(a - m * 60).toFixed(1).padStart(4, '0')}`;
}

/**
 * An offset typed by a person: seconds by default ("1.5", "-0,4", "+2 s"), "1500 ms", or minutes
 * ("1:20.5"). Null when it can't be read.
 */
export function parseOffset(text: string): number | null {
  const m = /^([+-])?\s*(?:(\d+):)?(\d+(?:\.\d*)?|\.\d+)\s*(ms|s)?$/i.exec(text.trim().replace(/,/g, '.').replace(/[−–]/g, '-'));
  if (!m) return null;
  const sign = m[1] === '-' ? -1 : 1;
  const n = Number(m[3]);
  if (m[4]?.toLowerCase() === 'ms') return m[2] ? null : sign * Math.round(n);
  return sign * Math.round((Number(m[2] ?? 0) * 60 + n) * 1000);
}

/** Time two lists of [start, end] spans overlap (both sorted by start). */
function overlap(a: [number, number][], b: [number, number][], shift: number): number {
  let i = 0;
  let j = 0;
  let total = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0] + shift, b[j][0]);
    const e = Math.min(a[i][1] + shift, b[j][1]);
    if (e > s) total += e - s;
    if (a[i][1] + shift < b[j][1]) i++;
    else j++;
  }
  return total;
}

/**
 * The shift that puts the subtitles best on the dialogue: the one where they overlap the speech
 * spans the most, within ±`rangeMs` (every 100 ms, then every 10 ms around the best). `share`:
 * how much of the subtitles' time then falls on speech (0…1). Null without speech or subtitles.
 */
export function guessOffset(cues: Cue[], spans: [number, number][] | null | undefined, rangeMs = 60000): { offset: number; share: number } | null {
  const subs = cues.filter((c) => c.end > c.start && c.text.trim()).map((c): [number, number] => [c.start, c.end]);
  if (!subs.length || !spans?.length) return null;
  const total = subs.reduce((n, [a, b]) => n + b - a, 0);
  let best = 0;
  let bestScore = -1;
  const scan = (from: number, to: number, step: number) => {
    for (let o = from; o <= to; o += step) {
      const score = overlap(subs, spans, o);
      // Equal scores: the smallest shift.
      if (score > bestScore || (score === bestScore && Math.abs(o) < Math.abs(best))) [best, bestScore] = [o, score];
    }
  };
  scan(-rangeMs, rangeMs, 100);
  const coarse = best;
  scan(coarse - 100, coarse + 100, 10);
  return { offset: best, share: bestScore / total };
}
