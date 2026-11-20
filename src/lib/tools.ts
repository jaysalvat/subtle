import { newId, type Cue, type IssueKind, type Settings } from './types';
import { isTop } from './position';
import { editableText, withEditedText } from './markup';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function sortCues(cues: Cue[]): Cue[] {
  return [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Visible characters (tags and line breaks removed) — used for reading speed. */
export function visibleText(text: string): string {
  return text
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n/g, ' ');
}

export function charCount(text: string): number {
  return visibleText(text).replace(/\s+/g, ' ').trim().length;
}

export function cps(cue: Cue): number {
  const d = (cue.end - cue.start) / 1000;
  return d > 0 ? charCount(cue.text) / d : Infinity;
}

/** Ids of the cues touching the span between `a` and `b` (either order): drag-to-select in the timeline. */
export function cuesInSpan(cues: Cue[], a: number, b: number): string[] {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return cues.filter((c) => c.end > lo && c.start < hi).map((c) => c.id);
}

/** Index of the cue displayed at `t`, or -1. */
export function cueAt(cues: Cue[], t: number): number {
  // Binary search on start, cues are sorted.
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found >= 0 && t < cues[found].end) return found;
  return -1;
}

/** Index of the first cue starting strictly after t (+ epsilon). */
export function nextCueIndex(cues: Cue[], t: number): number {
  return cues.findIndex((c) => c.start > t + 1);
}

/** "Previous" behaviour of a music player: restart the current cue if we are > 500 ms in. */
export function prevCueTarget(cues: Cue[], t: number): number {
  const cur = cueAt(cues, t);
  if (cur >= 0 && t - cues[cur].start > 500) return cur;
  const ref = cur >= 0 ? cues[cur].start : t;
  for (let i = cues.length - 1; i >= 0; i--) if (cues[i].start < ref - 1) return i;
  return cur;
}

const inScope = (ids: Set<string> | null | undefined, id: string) => !ids || ids.size === 0 || ids.has(id);

/* ------------------------------------------------------------------ */
/* Shift & sync                                                        */
/* ------------------------------------------------------------------ */

export type ShiftScope = 'all' | 'selection' | 'fromSelected';

/** Whether a scope (all, the selected ones, from the first selected one on) takes in a subtitle. */
export function scopeFilter(cues: Cue[], scope: ShiftScope, selected: string[]): (c: Cue) => boolean {
  const sel = new Set(selected);
  const fromStart = scope === 'fromSelected' ? Math.min(...cues.filter((c) => sel.has(c.id)).map((c) => c.start)) : Infinity;
  return (c) => scope === 'all' || (scope === 'selection' && sel.has(c.id)) || (scope === 'fromSelected' && c.start >= fromStart);
}

export function shiftCues(cues: Cue[], deltaMs: number, scope: ShiftScope = 'all', selected: string[] = []): Cue[] {
  const takes = scopeFilter(cues, scope, selected);
  return sortCues(
    cues.map((c) => {
      if (!takes(c)) return c;
      const start = Math.max(0, c.start + deltaMs);
      const end = Math.max(start, c.end + deltaMs);
      return { ...c, start, end };
    }),
  );
}

/** t' = a·t + b from two anchor points (original time -> correct time). */
export function linearFromAnchors(a: { from: number; to: number }, b: { from: number; to: number }): { scale: number; offset: number } {
  if (a.from === b.from) return { scale: 1, offset: a.to - a.from };
  const scale = (b.to - a.to) / (b.from - a.from);
  return { scale, offset: a.to - scale * a.from };
}

export function applyLinear(cues: Cue[], scale: number, offset: number): Cue[] {
  return sortCues(
    cues.map((c) => {
      const start = Math.max(0, Math.round(c.start * scale + offset));
      const end = Math.max(start, Math.round(c.end * scale + offset));
      return { ...c, start, end };
    }),
  );
}

/** Subtitles timed for `from` fps, video plays at `to` fps. */
export function fpsScale(from: number, to: number): number {
  return from / to;
}

/* ------------------------------------------------------------------ */
/* Durations                                                           */
/* ------------------------------------------------------------------ */

export interface MinDurationOptions {
  minMs: number;
  gapMs: number;
  cpsBased: boolean;
  maxCps: number;
}

export interface MinDurationResult {
  cues: Cue[];
  extended: string[];
  blocked: string[];
}

/**
 * Extend cues shorter than the minimum. The START IS NEVER CHANGED.
 * The end can go as far as the next cue's start minus the gap.
 */
export function extendToMinDuration(cues: Cue[], opt: MinDurationOptions, selected?: string[]): MinDurationResult {
  const sorted = sortCues(cues);
  const sel = selected && selected.length ? new Set(selected) : null;
  const extended: string[] = [];
  const blocked: string[] = [];
  const out = sorted.map((c, i) => {
    if (!inScope(sel, c.id)) return c;
    const wanted = opt.cpsBased ? Math.max(opt.minMs, Math.ceil((charCount(c.text) / opt.maxCps) * 1000)) : opt.minMs;
    const dur = c.end - c.start;
    if (dur >= wanted) return c;
    const next = sorted[i + 1];
    const limit = next ? next.start - opt.gapMs : Infinity;
    const newEnd = Math.min(c.start + wanted, limit);
    if (newEnd <= c.end) {
      blocked.push(c.id);
      return c;
    }
    if (newEnd < c.start + wanted) blocked.push(c.id);
    extended.push(c.id);
    return { ...c, end: newEnd };
  });
  return { cues: out, extended, blocked };
}

/** Lengthen / shorten the end of the given cues by delta, within the neighbours and the floor duration. */
export function nudgeEnds(cues: Cue[], ids: string[], deltaMs: number, s: Pick<Settings, 'minGapMs' | 'floorDurationMs'>): Cue[] {
  const sorted = sortCues(cues);
  const set = new Set(ids);
  return sorted.map((c, i) => {
    if (!set.has(c.id)) return c;
    const next = sorted[i + 1];
    const max = next ? next.start - s.minGapMs : Infinity;
    const min = c.start + s.floorDurationMs;
    let end = c.end + deltaMs;
    if (deltaMs > 0) end = Math.min(end, Math.max(c.end, max));
    else end = Math.max(end, Math.min(c.end, min));
    return { ...c, end };
  });
}

/**
 * Move subtitles (a whole block, keyboard) by `deltaMs`, together: as far as the room before the
 * nearest subtitle that isn't moving allows (gap kept), never before 0. Durations unchanged.
 */
export function moveCuesBy(cues: Cue[], ids: string[], deltaMs: number, s: Pick<Settings, 'minGapMs'>): Cue[] {
  const sorted = sortCues(cues);
  const set = new Set(ids);
  let d = deltaMs;
  sorted.forEach((c, i) => {
    if (!set.has(c.id)) return;
    if (d > 0) {
      const next = sorted[i + 1];
      if (next && !set.has(next.id)) d = Math.min(d, Math.max(0, next.start - s.minGapMs - c.end));
    } else {
      const prev = sorted[i - 1];
      const room = prev && !set.has(prev.id) ? c.start - (prev.end + s.minGapMs) : prev ? Infinity : c.start;
      d = Math.max(d, -Math.max(0, room));
    }
  });
  if (!d) return cues;
  return sorted.map((c) => (set.has(c.id) ? { ...c, start: c.start + d, end: c.end + d } : c));
}

/**
 * Retime one cue (timeline drag / [ ] shortcuts) without overlapping its neighbours.
 * mode: 'start' | 'end' move one edge, 'move' moves the block keeping its duration.
 */
export function retime(
  cues: Cue[],
  id: string,
  mode: 'start' | 'end' | 'move',
  value: number,
  s: Pick<Settings, 'minGapMs' | 'floorDurationMs'>,
  /**
   * Manual edge drag with ⇧ (timeline): instead of stopping at the neighbour, push it: the previous one's
   * end (or the next one's start) moves along, keeping the gap and its floor duration.
   */
  push = false,
): Cue[] {
  const sorted = sortCues(cues);
  const i = sorted.findIndex((c) => c.id === id);
  if (i < 0) return cues;
  const c = sorted[i];
  let prev = sorted[i - 1];
  let next = sorted[i + 1];
  if (push && mode === 'start' && prev && value < prev.end + s.minGapMs) {
    const prevEnd = Math.max(Math.round(value) - s.minGapMs, prev.start + s.floorDurationMs);
    if (prevEnd < prev.end) prev = { ...prev, end: prevEnd };
  }
  if (push && mode === 'end' && next && value > next.start - s.minGapMs) {
    const nextStart = Math.min(Math.round(value) + s.minGapMs, next.end - s.floorDurationMs);
    if (nextStart > next.start) next = { ...next, start: nextStart };
  }
  const lo = prev ? prev.end + s.minGapMs : 0;
  const hi = next ? next.start - s.minGapMs : Infinity;
  let { start, end } = c;
  if (mode === 'start') {
    start = Math.min(Math.max(value, lo), end - s.floorDurationMs);
  } else if (mode === 'end') {
    end = Math.max(Math.min(value, hi), start + s.floorDurationMs);
  } else {
    const d = c.end - c.start;
    start = Math.max(lo, Math.min(value, hi - d));
    if (start + d > hi) start = Math.max(lo, hi - d);
    end = start + d;
  }
  start = Math.max(0, Math.round(start));
  end = Math.round(end);
  const out = [...sorted];
  out[i] = { ...c, start, end };
  if (prev && prev !== sorted[i - 1]) out[i - 1] = prev;
  if (next && next !== sorted[i + 1]) out[i + 1] = next;
  return out;
}

/* ------------------------------------------------------------------ */
/* Insert / split / merge / delete                                     */
/* ------------------------------------------------------------------ */

/**
 * The line of dialogue at `t` (a speech span of the dialogue waveform) as a new subtitle's times:
 * the span, kept a gap away from the subtitles around it. Null when `t` isn't on speech, already
 * has a subtitle, or there's no room for the floor duration. Pick a line of dialogue (⌥-click).
 */
export function speechSlot(
  cues: Cue[],
  spans: [number, number][],
  t: number,
  s: Pick<Settings, 'minGapMs' | 'floorDurationMs'>,
): { start: number; end: number } | null {
  const span = spans.find(([a, b]) => a <= t && t <= b);
  if (!span) return null;
  const sorted = sortCues(cues);
  if (sorted.some((c) => c.start <= t && t <= c.end)) return null;
  const prev = sorted.filter((c) => c.end < t).pop();
  const next = sorted.find((c) => c.start > t);
  const start = Math.round(Math.max(span[0], prev ? prev.end + s.minGapMs : 0));
  const end = Math.round(Math.min(span[1], next ? next.start - s.minGapMs : Infinity));
  return end - start >= s.floorDurationMs ? { start, end } : null;
}

export function insertCueAt(
  cues: Cue[],
  t: number,
  s: Pick<Settings, 'minDurationMs' | 'minGapMs' | 'floorDurationMs'>,
  text = '',
): { cues: Cue[]; id: string } | null {
  const sorted = sortCues(cues);
  let start = Math.max(0, Math.round(t));
  const cur = cueAt(sorted, start);
  if (cur >= 0) start = sorted[cur].end + s.minGapMs;
  // Make sure we do not start inside / right before the previous cue.
  const prevIdx = sorted.findLastIndex((c) => c.start <= start);
  if (prevIdx >= 0 && sorted[prevIdx].end + s.minGapMs > start) start = sorted[prevIdx].end + s.minGapMs;
  const next = sorted.find((c) => c.start >= start);
  const end = Math.min(start + s.minDurationMs, next ? next.start - s.minGapMs : Infinity);
  if (end - start < s.floorDurationMs) return null;
  const id = newId();
  return { cues: sortCues([...sorted, { id, start, end, text, ...(cues.some((c) => c.target !== undefined) ? { target: '' } : {}) }]), id };
}

/**
 * Spotting: a new empty subtitle from `start` to `end` (the key held while someone speaks). A tap
 * (shorter than the floor) gets the minimum duration. It's fitted between its neighbours with the
 * gap: a start inside a subtitle moves after it, an end past the next one's start is cut. Null when
 * there's no room left.
 */
export function placeSpotted(
  cues: Cue[],
  start: number,
  end: number,
  s: Pick<Settings, 'minDurationMs' | 'minGapMs' | 'floorDurationMs'>,
): { cues: Cue[]; id: string } | null {
  const sorted = sortCues(cues);
  let a = Math.max(0, Math.round(start));
  let b = Math.round(end);
  if (b - a < s.floorDurationMs) b = a + s.minDurationMs;
  const prev = sorted.findLast((c) => c.start <= a);
  if (prev && prev.end + s.minGapMs > a) a = prev.end + s.minGapMs;
  const next = sorted.find((c) => c.start > a);
  if (next && b > next.start - s.minGapMs) b = next.start - s.minGapMs;
  if (b - a < s.floorDurationMs) return null;
  const id = newId();
  return { cues: sortCues([...sorted, { id, start: a, end: b, text: '', ...(cues.some((c) => c.target !== undefined) ? { target: '' } : {}) }]), id };
}

/**
 * Split a cue at `t`. The text goes on the line break nearest to the middle, else the space nearest
 * to the middle; or, with `textAt`, exactly where the cursor was in that field (an index in the text
 * as the editor shows it, hidden position / italic tags kept on both halves).
 */
export function splitCue(
  cues: Cue[],
  id: string,
  t: number,
  s: Pick<Settings, 'minGapMs' | 'floorDurationMs'>,
  textAt?: { field: 'text' | 'target'; index: number },
): { cues: Cue[]; id: string } | null {
  const c = cues.find((x) => x.id === id);
  if (!c) return null;
  const at = Math.round(t);
  if (at - c.start < s.floorDurationMs || c.end - at < s.floorDurationMs) return null;
  // Where the playhead is in the subtitle (0…1): the text is cut about as far in.
  const ratio = (at - c.start) / (c.end - c.start);
  const cut = (raw: string, field: 'text' | 'target'): [string, string] => {
    const body = editableText(raw);
    const index = textAt && textAt.field === field && textAt.index > 0 && textAt.index < body.length ? textAt.index : splitPoint(body, ratio);
    if (index < 0) return [raw, withEditedText(raw, '')];
    return [withEditedText(raw, body.slice(0, index).trimEnd()), withEditedText(raw, body.slice(index).trimStart())];
  };
  const [a, b] = cut(c.text, 'text');
  const [ta, tb] = c.target !== undefined ? cut(c.target, 'target') : [undefined, undefined];
  const half = Math.floor(s.minGapMs / 2);
  const second: Cue = { ...c, id: newId(), start: at + (s.minGapMs - half), text: b, ...(tb !== undefined ? { target: tb } : {}) };
  delete second.vttId;
  const first: Cue = { ...c, end: at - half, text: a, ...(ta !== undefined ? { target: ta } : {}) };
  return { cues: sortCues(cues.map((x) => (x.id === id ? first : x)).concat(second)), id: second.id };
}

const SENTENCE_END = /[.?!…]["»”’)]*$/;
const CLAUSE_END = /[,;:]["»”’)]*$/;

/**
 * Where to cut a subtitle's text, `ratio` of the way in (the playhead's place in it), -1 when it
 * can't be cut. Several lines: the line break nearest that point. One line: a space near it, after
 * the end of a sentence first, else after a comma (within a fifth of the text either way), else
 * the nearest space; never before French spaced punctuation ("Bonjour ! Ça va" stays "Bonjour !").
 * A word at least on each side.
 */
export function splitPoint(text: string, ratio: number): number {
  const goal = Math.max(0, Math.min(1, ratio)) * text.length;
  const nearest = (at: number[]) => at.reduce((best, i) => (best < 0 || Math.abs(i - goal) < Math.abs(best - goal) ? i : best), -1);
  const breaks = [...text.matchAll(/\n/g)].map((m) => m.index!).filter((i) => text.slice(0, i).trim() && text.slice(i + 1).trim());
  if (breaks.length) return nearest(breaks);
  const spaces = [...text.matchAll(/ +/g)]
    .map((m) => m.index!)
    .filter((i) => text.slice(0, i).trim() && text.slice(i).trim() && !/^ +[!?;:»]/.test(text.slice(i)));
  if (!spaces.length) return -1;
  const near = spaces.filter((i) => Math.abs(i - goal) <= Math.max(6, text.length / 5));
  const after = (re: RegExp) => near.filter((i) => re.test(text.slice(0, i)));
  return nearest(after(SENTENCE_END)) >= 0 ? nearest(after(SENTENCE_END)) : nearest(after(CLAUSE_END)) >= 0 ? nearest(after(CLAUSE_END)) : nearest(spaces);
}

export function mergeWithNext(cues: Cue[], id: string): Cue[] {
  const sorted = sortCues(cues);
  const i = sorted.findIndex((c) => c.id === id);
  if (i < 0 || i === sorted.length - 1) return sorted;
  const a = sorted[i];
  const b = sorted[i + 1];
  // One sentence goes on with a space (no new line added); a dialogue line ("- …") keeps its own line.
  const join = (x?: string, y?: string) => {
    const parts = [x, y].filter((v): v is string => !!v && !!v.trim());
    if (parts.length < 2) return parts[0] ?? '';
    return /^\s*(?:<[^>]+>|\{\\[^}]*\})*\s*-/.test(parts[1]) ? `${parts[0]}\n${parts[1]}` : `${parts[0].trimEnd()} ${parts[1].trimStart()}`;
  };
  const merged: Cue = {
    ...a,
    end: Math.max(a.end, b.end),
    text: join(a.text, b.text),
    ...(a.target !== undefined || b.target !== undefined ? { target: join(a.target, b.target) } : {}),
  };
  return sorted.filter((_, k) => k !== i + 1).map((c, k) => (k === i ? merged : c));
}

export function deleteCues(cues: Cue[], ids: string[]): Cue[] {
  const set = new Set(ids);
  return cues.filter((c) => !set.has(c.id));
}

/* ------------------------------------------------------------------ */
/* Hearing-impaired cleanup                                            */
/* ------------------------------------------------------------------ */

export interface HiRules {
  brackets: boolean; // [door slams]
  parentheses: boolean; // (laughs)
  music: boolean; // ♪ ... ♪
  speakers: boolean; // JOHN: / MAN 1:
  allCapsLines: boolean; // DOOR SLAMS (off by default)
}

export const DEFAULT_HI_RULES: HiRules = {
  brackets: true,
  parentheses: true,
  music: true,
  speakers: true,
  allCapsLines: false,
};

/** Protect {\an8}-style tags and <i>/<b>/<font> tags while cleaning. */
function protect(text: string): { text: string; restore: (s: string) => string } {
  const saved: string[] = [];
  const out = text.replace(/\{\\[^}]*\}|<\/?[a-zA-Z][^>]*>/g, (m) => {
    saved.push(m);
    return `\u0000${saved.length - 1}\u0000`;
  });
  return { text: out, restore: (s) => s.replace(/\u0000(\d+)\u0000/g, (_, n) => saved[Number(n)]) };
}

const stripTags = (s: string) => s.replace(/\u0000\d+\u0000/g, '');

export function cleanHiText(input: string, rules: HiRules): string {
  const p = protect(input);
  let t = p.text;
  if (rules.brackets) t = t.replace(/\[[^\]]*\]/g, '');
  if (rules.parentheses) t = t.replace(/\([^)]*\)/g, '');
  const lines = t.split('\n').map((line) => {
    let l = line;
    if (rules.music) {
      if (/[♪♫#]/.test(stripTags(l).trim().charAt(0)) || /^[\s\u0000\d]*[♪♫]/.test(l)) l = '';
      l = l.replace(/[♪♫][^♪♫]*[♪♫]?/g, '');
    }
    if (rules.speakers) {
      // Speaker label at the start of a line, optionally after a dialogue dash: "- JOHN: Hi" / "MAN 1: Hi"
      l = l.replace(/^(\s*(?:\u0000\d+\u0000)*\s*-?\s*)[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9 .'’#-]{0,30}:\s*/, '$1');
    }
    if (rules.allCapsLines) {
      const visible = stripTags(l).replace(/^[\s-]+/, '');
      if (visible.length >= 3 && /[A-ZÀ-ÖØ-Þ]/.test(visible) && visible === visible.toUpperCase() && !/[a-zà-ÿ]/.test(visible)) l = '';
    }
    return l
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+((?:\u0000\d+\u0000)*)\s*$/g, '$1')
      .replace(/^(\s*(?:\u0000\d+\u0000)*)\s+/, '$1');
  });
  // Drop empty lines (but keep tags that were on them by attaching to the next line).
  let carried = '';
  const kept: string[] = [];
  for (const l of lines) {
    if (stripTags(l).replace(/^[\s-]*$/, '') === '') {
      carried += (l.match(/\u0000\d+\u0000/g) ?? []).join('');
      continue;
    }
    kept.push(carried + l);
    carried = '';
  }
  // Orphan dialogue dash: a single remaining line starting with "- ".
  if (kept.length === 1) kept[0] = kept[0].replace(/^((?:\u0000\d+\u0000)*)\s*-\s*/, '$1');
  const result = kept.join('\n');
  return p.restore(result);
}

export interface HiResult {
  cues: Cue[];
  changed: { id: string; before: string; after: string }[];
  removed: string[];
}

export function cleanHi(cues: Cue[], rules: HiRules, selected?: string[]): HiResult {
  const sel = selected && selected.length ? new Set(selected) : null;
  const changed: HiResult['changed'] = [];
  const removed: string[] = [];
  const out: Cue[] = [];
  for (const c of cues) {
    if (!inScope(sel, c.id)) {
      out.push(c);
      continue;
    }
    const after = cleanHiText(c.text, rules);
    if (after !== c.text) changed.push({ id: c.id, before: c.text, after });
    if (visibleText(after).trim() === '' && !(c.target && c.target.trim())) {
      removed.push(c.id);
      continue;
    }
    out.push(after === c.text ? c : { ...c, text: after });
  }
  return { cues: out, changed, removed };
}

/* ------------------------------------------------------------------ */
/* Quality checks                                                      */
/* ------------------------------------------------------------------ */

export type { IssueKind };

export const ISSUE_KINDS: IssueKind[] = ['overlap', 'cps', 'lineLength', 'tooManyLines', 'tooShort', 'tooLong', 'hi'];

export function cueIssues(c: Cue, next: Cue | undefined, s: Settings): IssueKind[] {
  const out: IssueKind[] = [];
  const d = c.end - c.start;
  if (next && next.start < c.end) out.push('overlap');
  const text = c.target !== undefined && c.target.trim() ? c.target : c.text;
  if (charCount(text) / Math.max(d / 1000, 0.001) > s.maxCps) out.push('cps');
  const lines = text.split('\n').map((l) => visibleText(l).trim());
  if (lines.some((l) => l.length > s.maxLineLength)) out.push('lineLength');
  if (lines.length > 2) out.push('tooManyLines');
  if (d < s.minDurationMs) out.push('tooShort');
  if (d > 7000) out.push('tooLong');
  if (/\[[^\]]*\]|♪/.test(c.text)) out.push('hi');
  return out;
}

/** Issues per cue id, without the kinds the user chose to ignore. Cues without issues are left out. */
/**
 * The next subtitle shown at the same place (top or bottom). A top subtitle over a bottom one is
 * fine (e.g. a sign while someone speaks), so overlaps are only checked within the same place.
 */
export function nextSamePlace(cues: Cue[], i: number): Cue | undefined {
  const top = isTop(cues[i]);
  for (let j = i + 1; j < cues.length; j++) if (isTop(cues[j]) === top) return cues[j];
  return undefined;
}

export function collectIssues(cues: Cue[], s: Settings): Map<string, IssueKind[]> {
  const hidden = new Set(s.hiddenIssueKinds);
  const m = new Map<string, IssueKind[]>();
  cues.forEach((c, i) => {
    const k = cueIssues(c, nextSamePlace(cues, i), s).filter((x) => !hidden.has(x));
    if (k.length) m.set(c.id, k);
  });
  return m;
}

/**
 * Selection follows the playhead: when the playhead leaves the one selected subtitle, the selection
 * moves to the subtitle it's in (none in a gap). Returns the new selection, or null to keep it.
 * Several selected subtitles are never touched.
 */
export function followSelection(cues: Cue[], selection: string[], t: number, endMs = Infinity): string[] | null {
  if (selection.length !== 1) return null;
  const sel = cues.find((c) => c.id === selection[0]);
  if (!sel || (t >= sel.start - 50 && t < sel.end + 50)) return null;
  // A subtitle after the end of the film: the playhead stops at the end, the subtitle stays chosen.
  if (t >= endMs - 50 && sel.start >= endMs - 50) return null;
  const i = cueAt(cues, t);
  return i >= 0 ? [cues[i].id] : [];
}
