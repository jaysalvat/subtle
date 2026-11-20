/**
 * Align on the dialogue: each subtitle's start moves to the nearest start of speech, its end to the
 * nearest end of speech, within `maxMs`. Only speech that touches the subtitle counts (a short "oh"
 * with no subtitle is left alone); a stretch of speech that also touches the previous subtitle gives
 * its start to that one, one that touches the next gives its end to the next (two lines said without
 * a pause keep their boundary). Subtitles without speech near (title cards) don't move. Never
 * overlaps a neighbour (gap kept) nor goes under the floor duration. Pure.
 */
import type { Cue } from './types';
import type { Span } from './audio/speech';
import { sortCues } from './tools';

export interface AlignOptions {
  /** How far an edge may move. */
  maxMs: number;
  starts: boolean;
  ends: boolean;
  gapMs: number;
  floorMs: number;
}

export interface AlignResult {
  cues: Cue[];
  /** Subtitles whose start or end moved. */
  moved: string[];
}

const touches = (s: Span, a: number, b: number) => s[0] < b && s[1] > a;

export function alignToSpeech(cues: Cue[], spans: Span[], o: AlignOptions, selected?: string[]): AlignResult {
  const sorted = sortCues(cues);
  const sel = selected?.length ? new Set(selected) : null;
  const n = sorted.length;
  // What each subtitle would like, before the neighbours are taken into account.
  const want = sorted.map((c, i) => {
    let start = c.start;
    let end = c.end;
    if ((sel && !sel.has(c.id)) || !c.text.trim() || !spans.length) return { start, end };
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    let bestS = Infinity;
    let bestE = Infinity;
    for (const s of spans) {
      if (s[0] > c.end + o.maxMs) break;
      if (!touches(s, c.start, c.end)) continue;
      if (o.starts && !(prev && touches(s, prev.start, prev.end))) {
        const d = Math.abs(s[0] - c.start);
        if (d <= o.maxMs && d < bestS) [bestS, start] = [d, s[0]];
      }
      if (o.ends && !(next && touches(s, next.start, next.end))) {
        const d = Math.abs(s[1] - c.end);
        if (d <= o.maxMs && d < bestE) [bestE, end] = [d, s[1]];
      }
    }
    if (end - start < o.floorMs) return { start: c.start, end: c.end };
    return { start: Math.round(start), end: Math.round(end) };
  });
  // Neighbours: a start never comes before the previous end + gap, an end never after the next start − gap.
  const out: Cue[] = [];
  const moved: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = sorted[i];
    let { start, end } = want[i];
    const prevEnd = i > 0 ? out[i - 1].end : -Infinity;
    if (start !== c.start) start = Math.max(start, Math.min(c.start, prevEnd + o.gapMs));
    if (end !== c.end && i + 1 < n) end = Math.min(end, Math.max(c.end, want[i + 1].start - o.gapMs));
    if (end - start < o.floorMs) [start, end] = [c.start, c.end];
    if (start !== c.start || end !== c.end) {
      moved.push(c.id);
      out.push({ ...c, start, end });
    } else out.push(c);
  }
  return { cues: out, moved };
}
