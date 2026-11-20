/** Bookmarks: markers in the film to come back to (keys 1–9 jump to slots 1–9). */
import type { Bookmark, Cue } from './types';
import { cueAt } from './tools';

/** Slots are fixed: a bookmark keeps its number when others are added or removed. Lowest free one. */
export function nextSlot(list: Bookmark[]): number {
  const used = new Set(list.map((b) => b.slot));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** Default name: the subtitle shown at that time, else "Bookmark n". */
export function defaultLabel(cues: Cue[], t: number, slot: number): string {
  const i = cueAt(cues, t);
  if (i < 0) return `Bookmark ${slot}`;
  const text = cues[i].text
    .replace(/<[^>]+>|\{\\[^}]*\}/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
  return text.length > 40 ? `${text.slice(0, 39).trimEnd()}…` : text || `Bookmark ${slot}`;
}

/** A bookmark already at this moment (a double click shouldn't add the same one twice). */
export function bookmarkNear(list: Bookmark[], t: number, tolMs = 250): Bookmark | undefined {
  return list.find((b) => Math.abs(b.time - t) <= tolMs);
}

export const byTime = (list: Bookmark[]) => [...list].sort((a, b) => a.time - b.time || a.slot - b.slot);

/**
 * The mark (bookmark or scene note time) before or after `now`, else null. One within `tolMs` counts
 * as "here" and is skipped, so pressing again moves on.
 */
export function nextMark(times: number[], now: number, dir: 1 | -1, tolMs = 250): number | null {
  const ahead = times.filter((x) => (dir > 0 ? x > now + tolMs : x < now - tolMs));
  if (!ahead.length) return null;
  return dir > 0 ? Math.min(...ahead) : Math.max(...ahead);
}
