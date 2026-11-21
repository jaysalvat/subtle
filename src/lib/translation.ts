/** Translation mode helpers. */
import { leadingTags } from './markup';
import type { Cue } from './types';

/**
 * "Keep only French" (Use the translation): the translation becomes the subtitle text. Untranslated subtitles keep
 * their original. The original's position tag ({\\an8}) is kept; italics follow the translation.
 */
export function adoptTranslation(c: Cue): Cue {
  const { target, ...rest } = c;
  if (!target?.trim()) return rest;
  return { ...rest, text: leadingTags(c.text) + target.slice(leadingTags(target).length) };
}

export const untranslatedCount = (cues: Cue[]) => cues.filter((c) => !c.target?.trim()).length;

/**
 * The original is the same in both lists (times, text, VTT settings; the translations aside):
 * while translating, its file only needs writing when this is false.
 */
export function sameSource(a: Cue[] | null, b: Cue[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((c, i) => {
    const d = b[i];
    return c.id === d.id && c.start === d.start && c.end === d.end && c.text === d.text && c.vttSettings === d.vttSettings;
  });
}

/** While translating, the language being edited: the translation (default) or the original. */
export type EditSide = 'source' | 'target';

/** The field of a cue the edited side means. */
export const sideField = (side: EditSide): 'text' | 'target' => (side === 'source' ? 'text' : 'target');

/**
 * The subtitles as the tools and checks should see them: editing the original, without the
 * translations (every tool then works on the original, as outside translation mode).
 */
export function viewOf(cues: Cue[], side: EditSide): Cue[] {
  if (side === 'target') return cues;
  return cues.map((c) => {
    if (c.target === undefined) return c;
    const { target: _t, ...rest } = c;
    void _t;
    return rest;
  });
}

/** A subtitle's text in the language edited (the translation while editing it, the original when it's empty). */
export const shownText = (c: Cue, side: EditSide) => (side === 'target' && c.target?.trim() ? c.target : c.text);

/** The subtitles to pick from (Sync by ear, Sync from two times…) showing the language edited. */
export const shownCues = (cues: Cue[], side: EditSide): Cue[] =>
  cues.some((c) => c.target !== undefined) ? cues.map((c) => ({ ...c, text: shownText(c, side) })) : cues;

/** After a tool ran on `viewOf(…, 'source')`: the translations put back (by id). */
export function restoreTargets(out: Cue[], original: Cue[]): Cue[] {
  const byId = new Map(original.map((c) => [c.id, c.target]));
  return out.map((c) => (c.target === undefined && byId.get(c.id) !== undefined ? { ...c, target: byId.get(c.id) } : c));
}

/** The language translated from: the one picked, else the file's (when it isn't the target), else English. */
export const sourceLang = (docLang: string | undefined, translation: { sourceLang?: string; targetLang: string }) =>
  translation.sourceLang ?? (docLang && docLang !== translation.targetLang ? docLang : 'en');

/**
 * A translation file of the same film, lined up on the original by time: each of its lines goes to
 * the original subtitle it overlaps most (several on one are joined, in time order). Its own position
 * tags are dropped (the original's place is kept). `unmatched`: its lines that overlap none.
 */
export function matchTranslation(source: Cue[], other: Cue[]): { targets: Map<string, string>; matched: number; unmatched: number } {
  const lines = new Map<string, string[]>();
  let unmatched = 0;
  for (const o of [...other].sort((a, b) => a.start - b.start)) {
    const text = o.text.slice(leadingTags(o.text).length).trim();
    if (!text) continue;
    let best: Cue | null = null;
    let most = 0;
    for (const s of source) {
      const overlap = Math.min(s.end, o.end) - Math.max(s.start, o.start);
      if (overlap > most) [best, most] = [s, overlap];
    }
    if (!best) {
      unmatched++;
      continue;
    }
    lines.set(best.id, [...(lines.get(best.id) ?? []), text]);
  }
  const targets = new Map([...lines].map(([id, l]) => [id, l.join('\n')] as const));
  return { targets, matched: targets.size, unmatched };
}
