/**
 * Sign the subtitles: the subtitler's or translator's lines ("Subtitles by…", "Translation by…"),
 * placed a few seconds after the start of the film, after the last subtitle, or into the end credits. Each one goes in the
 * first free spot from there (no overlap, the minimum gap kept). Signing again replaces the lines
 * already there with the same words instead of adding them twice.
 */
import { setPosition } from './position';
import { charCount, sortCues, visibleText } from './tools';
import { newId, type Cue, type SubtitleFormat } from './types';

export interface Signature {
  /** The text, with its whole-subtitle tags (italics, bold, colour) as in a subtitle. */
  text: string;
  /** At the top of the picture. */
  top: boolean;
  /** From the start of the film, the end of the last subtitle, or the start of the end credits. */
  from: 'start' | 'end' | 'credits';
  afterMs: number;
}

export interface SignOptions {
  minGapMs: number;
  minDurationMs: number;
  cpsBased: boolean;
  maxCps: number;
  format: SubtitleFormat;
  /** Translating: the same text in the translation. */
  translating: boolean;
  /** When the end credits start (lib/credits.ts); null: not found, placed after the last subtitle. */
  creditsMs?: number | null;
  /** The film's length: signatures stay inside it when there's room (0: no film). */
  filmEndMs?: number;
}

const words = (text: string) => visibleText(text).replace(/\s+/g, ' ').trim().toLowerCase();

/** The signatures worth placing (some text). */
export const filledSignatures = (sigs: Signature[]) => sigs.filter((s) => words(s.text));

/** How long a signature shows: the minimum duration, longer for a long text when that rule is on. */
export function signatureDuration(text: string, o: Pick<SignOptions, 'minDurationMs' | 'cpsBased' | 'maxCps'>): number {
  const wanted = o.cpsBased ? Math.ceil((charCount(text) / o.maxCps) * 1000) : 0;
  return Math.max(o.minDurationMs, wanted, 1000);
}

/** The first start from `at` where `dur` fits between the subtitles (sorted), the gap kept on both sides. */
export function freeSpot(cues: Cue[], at: number, dur: number, gap: number): number {
  let t = Math.max(0, at);
  for (const c of cues) {
    if (c.end + gap <= t) continue;
    if (t + dur + gap <= c.start) break;
    t = Math.max(t, c.end + gap);
  }
  return t;
}

/**
 * The subtitles with the signatures placed (sorted), the new ones' ids, and those that couldn't go
 * where asked (a subtitle was there: moved to the next free spot).
 */
export function sign(cues: Cue[], sigs: Signature[], o: SignOptions): { cues: Cue[]; added: string[]; moved: string[] } {
  const todo = filledSignatures(sigs);
  const mine = new Set(todo.map((s) => words(s.text)));
  // Lines already signed: replaced, not doubled.
  let out = sortCues(cues.filter((c) => !mine.has(words(c.text))));
  const lastEnd = out.reduce((m, c) => Math.max(m, c.end), 0);
  const added: string[] = [];
  const moved: string[] = [];
  // Earliest first, so each one is placed around those before it.
  const ordered = todo
    .map((s) => ({ s, at: (s.from === 'start' ? 0 : s.from === 'credits' && o.creditsMs != null ? o.creditsMs : lastEnd) + Math.max(0, s.afterMs) }))
    .sort((a, b) => a.at - b.at);
  for (const { s, at } of ordered) {
    const dur = signatureDuration(s.text, o);
    let start = freeSpot(out, at, dur, o.minGapMs);
    // Past the end of the film: as late as it fits inside it instead (where nothing plays, it can't show).
    if (o.filmEndMs && start + dur > o.filmEndMs) {
      const inside = freeSpot(out, Math.max(0, o.filmEndMs - dur), dur, o.minGapMs);
      if (inside + dur <= o.filmEndMs) start = inside;
    }
    let cue: Cue = { id: newId(), start, end: start + dur, text: s.text.trim(), ...(o.translating ? { target: s.text.trim() } : {}) };
    if (s.top) cue = setPosition(cue, true, o.format);
    out = sortCues([...out, cue]);
    added.push(cue.id);
    if (start !== at) moved.push(cue.id);
  }
  return { cues: out, added, moved };
}
