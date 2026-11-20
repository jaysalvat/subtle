/**
 * Add the subtitles of another file to the current ones, typically a "forced" file (text shown on
 * screen: signs, letters, songs) missing from subtitles translated from another language.
 */
import { setPosition } from './position';
import { sortCues } from './tools';
import { newId, type Cue, type SubtitleFormat } from './types';

export interface MergeOptions {
  /** Show the added subtitles at the top of the screen (usual for on-screen text). */
  top: boolean;
  /** Shift them, when the file comes from another release of the film. */
  offsetMs: number;
  /** Format of the current subtitles: the position is written the way it expects. */
  format: SubtitleFormat;
}

/** A file name that says "forced" (movie.fr.forced.srt, Movie FORCED.srt…): its subtitles go to the top by default. */
export const looksForced = (name: string) => /(^|[^a-z])forced([^a-z]|$)/i.test(name);

/** The incoming subtitles, ready to add: new ids, shifted, positioned. */
export function prepareIncoming(incoming: Cue[], o: MergeOptions): Cue[] {
  return incoming.map((c) => {
    const start = Math.max(0, c.start + o.offsetMs);
    let out: Cue = { ...c, id: newId(), start, end: Math.max(start, c.end + o.offsetMs) };
    delete out.target;
    if (o.top) out = setPosition(out, true, o.format);
    return out;
  });
}

export const mergeCues = (base: Cue[], added: Cue[]) => sortCues([...base, ...added]);

/** How many added subtitles are on screen at the same time as an existing one. */
export function countOverlaps(base: Cue[], added: Cue[]): number {
  const sorted = sortCues(base);
  let n = 0;
  for (const a of added) if (sorted.some((b) => b.start < a.end && a.start < b.end)) n++;
  return n;
}
