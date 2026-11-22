/**
 * Saved selections (Selections menu in the top bar): a group of subtitles kept with the project, to
 * select again in one click (a scene, a character's lines, the ones to check with the client).
 */
import { sortCues } from './tools';
import type { Cue, SavedSelection } from './types';

/** The saved subtitles that still exist, in film order. */
export function liveIds(saved: Pick<SavedSelection, 'ids'>, cues: Cue[]): string[] {
  const keep = new Set(saved.ids);
  return sortCues(cues)
    .filter((c) => keep.has(c.id))
    .map((c) => c.id);
}

/** Their numbers as the list shows them: "#12", "#3–#14" when they follow each other, else "#3 … #14". */
export function selectionRange(ids: string[], cues: Cue[]): string {
  const keep = new Set(ids);
  const n = sortCues(cues).flatMap((c, i) => (keep.has(c.id) ? [i + 1] : []));
  if (!n.length) return '';
  if (n.length === 1) return `#${n[0]}`;
  const together = n[n.length - 1] - n[0] === n.length - 1;
  return `#${n[0]}${together ? '–' : ' … '}#${n[n.length - 1]}`;
}
