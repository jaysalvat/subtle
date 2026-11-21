/**
 * Quality check (Tools › Check quality): a profile of rules (reading speed, line length, durations,
 * gap), the problems found per kind, and the fixes that can be applied automatically, each one a pure
 * `(cues, profile) => cues`. Fixes never move the START of a subtitle.
 */
import type { Span } from './audio/speech';
import { hasColour, withoutColours } from './colour';
import { balanceCueText } from './lines';
import { charCount, extendToMinDuration, sortCues, visibleText } from './tools';
import type { Cue, Settings } from './types';

export interface Profile {
  maxCps: number;
  maxLineLength: number;
  minDurationMs: number;
  maxDurationMs: number;
  minGapMs: number;
  /** White text only: coloured text is a problem (Netflix, Prime Video). */
  whiteOnly?: boolean;
  /** The language checked: where Fix cuts long lines (lib/lines.ts). */
  lang?: string;
}

export type ProfileId = 'mine' | 'netflix' | 'netflixEn' | 'netflixSdh' | 'prime' | 'ted';

/** A published convention. `null`: the source gives no value (the user's own setting is kept). */
export interface Convention {
  cps: number;
  childrenCps: number | null;
  /** Prime Video allows this much as a last resort, when nothing else works. */
  lastResortCps?: number;
  maxLineLength: number;
  minDurationMs: number | null;
  maxDurationMs: number | null;
  /** Between two subtitles, in frames of the video. */
  gapFrames: number | null;
  /** Text colour: white only (Netflix's and Prime Video's "Font color: White"). */
  whiteOnly?: boolean;
}

/**
 * Checked on the providers' pages (Nov 2026). Netflix: language guides (French, German, Spanish…
 * 17 / 13 cps; English 20 / 17; SDH 20 / 17), 42 characters, 2 lines, 5/6 s (20 frames) to 7 s,
 * 2 frames apart (Subtitle Timing Guidelines). Prime Video: 17 / 13 cps, 22 as a last resort,
 * 42 characters, 2 lines, ≈ 5/6 s to 7 s, 2 frames apart. TED: 21 cps, 42 characters, 2 lines.
 * Netflix and Prime Video: white text only.
 */
export const CONVENTIONS: Record<Exclude<ProfileId, 'mine'>, Convention> = {
  netflix: { cps: 17, childrenCps: 13, maxLineLength: 42, minDurationMs: 833, maxDurationMs: 7000, gapFrames: 2, whiteOnly: true },
  netflixEn: { cps: 20, childrenCps: 17, maxLineLength: 42, minDurationMs: 833, maxDurationMs: 7000, gapFrames: 2, whiteOnly: true },
  netflixSdh: { cps: 20, childrenCps: 17, maxLineLength: 42, minDurationMs: 833, maxDurationMs: 7000, gapFrames: 2, whiteOnly: true },
  prime: { cps: 17, childrenCps: 13, lastResortCps: 22, maxLineLength: 42, minDurationMs: 833, maxDurationMs: 7000, gapFrames: 2, whiteOnly: true },
  ted: { cps: 21, childrenCps: null, maxLineLength: 42, minDurationMs: null, maxDurationMs: null, gapFrames: null },
};

/** Frames → ms at the video's frame rate (24 when unknown), rounded up so the gap is never short. */
export const framesToMs = (frames: number, fps: number | null) => Math.ceil((frames * 1000) / (fps || 24));

/** The rules a convention gives, on top of the user's settings for what it doesn't say. */
export function profileFor(c: Convention, children: boolean, fps: number | null, s: Settings): Profile {
  return {
    maxCps: children && c.childrenCps ? c.childrenCps : c.cps,
    maxLineLength: c.maxLineLength,
    minDurationMs: c.minDurationMs ?? s.minDurationMs,
    maxDurationMs: c.maxDurationMs ?? 7000,
    minGapMs: c.gapFrames !== null ? framesToMs(c.gapFrames, fps) : s.minGapMs,
    whiteOnly: !!c.whiteOnly,
  };
}

export const profileFromSettings = (s: Settings): Profile => ({
  maxCps: s.maxCps,
  maxLineLength: s.maxLineLength,
  minDurationMs: s.minDurationMs,
  maxDurationMs: 7000,
  minGapMs: s.minGapMs,
});

/** Profiles kept for older code and tests: Netflix's two common cases at 24 fps. */
export const PROFILES = {
  netflixEn: profileFor(CONVENTIONS.netflixEn, false, 24, { minDurationMs: 0, minGapMs: 0 } as Settings),
  netflixOther: profileFor(CONVENTIONS.netflix, false, 24, { minDurationMs: 0, minGapMs: 0 } as Settings),
};

/** Problems that make the file worse (fixable or not), then things only worth a look. */
export type AuditKind = 'empty' | 'overlap' | 'gap' | 'tooShort' | 'tooFast' | 'lines' | 'tooLong' | 'hi' | 'speechOnly' | 'colour';
export const FIXABLE: AuditKind[] = ['empty', 'overlap', 'gap', 'tooShort', 'tooFast', 'lines', 'colour'];
/**
 * No "subtitle with no dialogue under it": the speech detector misses some voices, so it raised false
 * alarms. Dialogue with no subtitle stays: when the detector hears speech, it's almost always right.
 */
export const TO_CHECK: AuditKind[] = ['tooLong', 'hi', 'speechOnly'];

export interface AuditResult {
  /** Subtitle ids per kind (empty kinds left out). */
  ids: Partial<Record<AuditKind, string[]>>;
  /** Speech with no subtitle at all, [start, end] ms. */
  speechOnly: Span[];
}

/** The text a check reads: the translation while translating, when there is one. */
const shown = (c: Cue) => (c.target !== undefined && c.target.trim() ? c.target : c.text);
const field = (c: Cue): 'text' | 'target' => (c.target !== undefined && c.target.trim() ? 'target' : 'text');

export function audit(cues: Cue[], p: Profile, spans: Span[] | null): AuditResult {
  const list = sortCues(cues);
  const ids: AuditResult['ids'] = {};
  const add = (k: AuditKind, id: string) => (ids[k] ??= []).push(id);
  list.forEach((c, i) => {
    const next = list[i + 1];
    const d = c.end - c.start;
    const text = shown(c);
    if (!visibleText(text).trim()) return add('empty', c.id);
    if (next && next.start < c.end) add('overlap', c.id);
    else if (next && next.start - c.end < p.minGapMs) add('gap', c.id);
    if (d < p.minDurationMs) add('tooShort', c.id);
    if (charCount(text) / Math.max(d / 1000, 0.001) > p.maxCps) add('tooFast', c.id);
    const lines = text.split('\n').map((l) => visibleText(l).trim());
    if (lines.length > 2 || lines.some((l) => l.length > p.maxLineLength)) add('lines', c.id);
    if (d > p.maxDurationMs) add('tooLong', c.id);
    if (/\[[^\]]*\]|♪/.test(c.text)) add('hi', c.id);
    if (p.whiteOnly && hasColour(text)) add('colour', c.id);
  });
  const speechOnly: Span[] = [];
  if (spans) {
    for (const [a, b] of spans) {
      if (b - a < 1000) continue; // "uh", "ha": not worth a subtitle
      const covered = list.reduce((s, c) => s + Math.max(0, Math.min(b, c.end) - Math.max(a, c.start)), 0);
      if (covered < (b - a) * 0.2) speechOnly.push([a, b]);
    }
    if (speechOnly.length) ids.speechOnly = [];
  }
  return { ids, speechOnly };
}

/* ---------------- Fixes ---------------- */

/** End before the next subtitle starts, with the gap (overlaps and too-small gaps). Start untouched. */
export function fixGaps(cues: Cue[], p: Profile, floorMs = 300): Cue[] {
  const list = sortCues(cues);
  return list.map((c, i) => {
    const next = list[i + 1];
    if (!next || next.start - c.end >= p.minGapMs) return c;
    const end = next.start - p.minGapMs;
    return end - c.start >= floorMs ? { ...c, end } : c;
  });
}

/** Too short, or too fast to read: lengthen the end as far as the next subtitle allows. */
export function fixDurations(cues: Cue[], p: Profile): Cue[] {
  const withShown = cues.map((c) => ({ ...c, text: shown(c) }));
  const { cues: out } = extendToMinDuration(withShown, { minMs: p.minDurationMs, gapMs: p.minGapMs, cpsBased: true, maxCps: p.maxCps });
  const byId = new Map(out.map((c) => [c.id, c.end]));
  // Never longer than the maximum because of this.
  return sortCues(cues).map((c) => {
    const end = byId.get(c.id) ?? c.end;
    return end === c.end ? c : { ...c, end: Math.max(c.end, Math.min(end, c.start + p.maxDurationMs)) };
  });
}

/** Lines too long, or more than 2: re-cut like Tools › Balance lines (when the text fits in 2). */
export function fixLines(cues: Cue[], p: Profile): Cue[] {
  return cues.map((c) => {
    const f = field(c);
    const text = c[f] ?? '';
    const lines = text.split('\n');
    if (lines.length <= 2 && lines.every((l) => visibleText(l).trim().length <= p.maxLineLength)) return c;
    // Dialogue lines ("- …") stay one per speaker.
    if (lines.filter((l) => /^\s*[-–—]/.test(visibleText(l))).length > 1) return c;
    const cut = balanceCueText(text, p.maxLineLength, p.lang);
    return cut.split('\n').every((l) => visibleText(l).length <= p.maxLineLength) ? { ...c, [f]: cut } : c;
  });
}

function removeEmpty(cues: Cue[]): Cue[] {
  return cues.filter((c) => visibleText(shown(c)).trim());
}

/** The fix for a kind, if there is one. */
export function fixFor(kind: AuditKind): ((cues: Cue[], p: Profile) => Cue[]) | null {
  if (kind === 'empty') return (c) => removeEmpty(c);
  if (kind === 'overlap' || kind === 'gap') return fixGaps;
  if (kind === 'tooShort' || kind === 'tooFast') return fixDurations;
  if (kind === 'lines') return fixLines;
  if (kind === 'colour') return (c) => withoutColours(c);
  return null;
}

/** Every automatic fix, in an order where one doesn't undo another. */
export function fixAll(cues: Cue[], p: Profile): Cue[] {
  const lines = fixLines(fixDurations(fixGaps(removeEmpty(cues), p), p), p);
  return p.whiteOnly ? withoutColours(lines) : lines;
}
