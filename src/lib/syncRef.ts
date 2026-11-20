/**
 * Sync from a reference file: subtitles of the same film, well timed (another language, another
 * release). Step 1, the whole file: the offset and the speed (a frame rate conversion, or none) that
 * put the subtitles most on the reference's. Step 2, each subtitle: its start and end go to the
 * reference's edges they touch (`alignToSpeech`, the reference's subtitles standing for the voices).
 * Title cards and lines the reference doesn't have stay where step 1 put them. Pure.
 */
import { alignToSpeech, type AlignOptions } from './align';
import type { Span } from './audio/speech';
import { FPS_CONVERSIONS, NO_CONVERSION, type FpsConversion } from './fps';
import { guessOffset } from './sync';
import { applyLinear, sortCues } from './tools';
import type { Cue } from './types';

/** The reference's subtitles as sorted spans, overlapping ones merged (two at once, top and bottom). */
export function refSpans(ref: Cue[]): Span[] {
  const out: Span[] = [];
  for (const c of sortCues(ref)) {
    if (c.end <= c.start || !c.text.trim()) continue;
    const last = out[out.length - 1];
    if (last && c.start < last[1]) last[1] = Math.max(last[1], c.end);
    else out.push([c.start, c.end]);
  }
  return out;
}

export interface WholeFit {
  /** times × scale + offset */
  scale: number;
  offset: number;
  fps: FpsConversion;
  /** How much of the subtitles' time then falls on the reference's (0…1). */
  share: number;
}

/** Below this share, no clear match. */
export const MIN_SHARE = 0.3;

/**
 * The offset (within ±`rangeMs`) and speed (none, or one of the frame rate conversions) that put
 * `cues` most on `spans`. Null when nothing matches well enough.
 */
export function fitWhole(cues: Cue[], spans: Span[], rangeMs = 120000): WholeFit | null {
  let best: WholeFit | null = null;
  for (const fps of [NO_CONVERSION, ...FPS_CONVERSIONS]) {
    const scaled = fps.scale === 1 ? cues : applyLinear(cues, fps.scale, 0);
    const g = guessOffset(scaled, spans, rangeMs);
    // A speed must do clearly better than none.
    if (g && (!best || g.share > best.share + (fps.scale === 1 ? 0 : 0.02))) best = { scale: fps.scale, offset: g.offset, fps, share: g.share };
  }
  return best && best.share >= MIN_SHARE ? best : null;
}

export interface RefOptions extends AlignOptions {
  /** Step 1: offset and speed of the whole file. */
  whole: boolean;
  /** Step 2: each subtitle on the reference's edges. */
  each: boolean;
}

export interface RefResult {
  cues: Cue[];
  fit: WholeFit | null;
  /** Subtitles whose times changed. */
  moved: string[];
}

/**
 * Both steps on the subtitles in `ids` (all when absent); the others don't move. `known`: step 1
 * already worked out (`fitWhole` on the same subtitles), so changing step 2's options stays quick.
 */
export function syncToReference(cues: Cue[], ref: Cue[], o: RefOptions, ids?: string[], known?: { fit: WholeFit | null }): RefResult {
  const spans = refSpans(ref);
  const set = ids?.length ? new Set(ids) : null;
  const inScope = (c: Cue) => !set || set.has(c.id);
  let out = sortCues(cues);
  let fit: WholeFit | null = null;
  if (o.whole) {
    fit = known ? known.fit : fitWhole(out.filter(inScope), spans);
    if (fit && (fit.scale !== 1 || fit.offset)) {
      const moved = new Map(applyLinear(out.filter(inScope), fit.scale, fit.offset).map((c) => [c.id, c]));
      out = sortCues(out.map((c) => moved.get(c.id) ?? c));
    }
  }
  if (o.each) out = alignToSpeech(out, spans, o, set ? [...set] : undefined).cues;
  const before = new Map(cues.map((c) => [c.id, c]));
  const moved = out.filter((c) => {
    const b = before.get(c.id)!;
    return b.start !== c.start || b.end !== c.end;
  });
  return { cues: out, fit, moved: moved.map((c) => c.id) };
}
