/**
 * Subtitle position: bottom (default) or top, e.g. to keep text burnt into the picture readable.
 * SRT: an "{\an8}" tag at the start of the text (understood by most players).
 * WebVTT: a "line:" cue setting (line:0 = top line). Both are read; each format writes its own.
 */
import type { Cue, SubtitleFormat } from './types';

const AN_TOP = /\{\\an[789]\}/;
const AN_ANY = /\{\\an\d\}/g;

function vttLineIsTop(settings?: string): boolean {
  const m = /(?:^|\s)line:(-?\d+(?:\.\d+)?)(%)?/.exec(settings ?? '');
  if (!m) return false;
  const v = Number(m[1]);
  return m[2] ? v < 50 : v >= 0; // percent from the top, or line number (negative counts from the bottom)
}

export function isTop(c: Pick<Cue, 'text' | 'vttSettings'>): boolean {
  return AN_TOP.test(c.text) || vttLineIsTop(c.vttSettings);
}

const withoutLine = (settings?: string) => (settings ?? '').replace(/(?:^|\s)line:\S+/g, '').trim();

/** Put a subtitle at the top or the bottom, the way its file format expects. */
export function setPosition(c: Cue, top: boolean, format: SubtitleFormat): Cue {
  const text = c.text.replace(AN_ANY, '');
  const target = c.target?.replace(AN_ANY, '');
  const rest = withoutLine(c.vttSettings);
  const out: Cue = { ...c, text, ...(c.target !== undefined ? { target } : {}) };
  delete out.vttSettings;
  // Every format but VTT keeps the top position as a leading {\an8} (SRT style) inside Subtle.
  if (format !== 'vtt') {
    if (top) out.text = `{\\an8}${text}`;
    if (rest) out.vttSettings = rest;
  } else {
    const settings = [top ? 'line:0' : '', rest].filter(Boolean).join(' ');
    if (settings) out.vttSettings = settings;
  }
  return out;
}

/** SRT export: the text, with "{\an8}" when the subtitle is at the top (also for a translation). */
export function srtText(c: Cue, text: string): string {
  return isTop(c) && !AN_TOP.test(text) ? `{\\an8}${text}` : text;
}

/** VTT export: tags VTT doesn't know are dropped; a top position becomes "line:0". */
export function vttCue(c: Cue, text: string): { text: string; settings?: string } {
  const clean = text.replace(AN_ANY, '');
  const settings = isTop(c) && !vttLineIsTop(c.vttSettings) ? ['line:0', withoutLine(c.vttSettings)].filter(Boolean).join(' ') : c.vttSettings;
  return { text: clean, ...(settings ? { settings } : {}) };
}
