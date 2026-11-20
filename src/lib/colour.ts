/**
 * Text colours. Inside Subtle a colour is SRT's <font color="#RRGGBB">…</font> (what SRT players
 * already read); each format converts it on the way in and out: ASS {\c&HBBGGRR&} / a style's
 * primary colour, VTT's colour classes <c.yellow>, TTML tts:color; SBV has none.
 */
import type { Cue } from './types';

/** "#RRGGBB" in capitals, or null: #rgb, #rrggbb and the usual names accepted. */
export function normColour(value: string | undefined | null): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const named = NAMED[v];
  if (named) return named;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  return /^#[0-9a-f]{6}$/.test(v) ? v.toUpperCase() : null;
}

/** WebVTT's colour classes (the ones every browser knows). */
export const VTT_COLOURS: Record<string, string> = {
  white: '#FFFFFF',
  lime: '#00FF00',
  cyan: '#00FFFF',
  red: '#FF0000',
  yellow: '#FFFF00',
  magenta: '#FF00FF',
  blue: '#0000FF',
  black: '#000000',
};

const NAMED: Record<string, string> = {
  ...VTT_COLOURS,
  green: '#008000',
  aqua: '#00FFFF',
  fuchsia: '#FF00FF',
  orange: '#FFA500',
  gray: '#808080',
  grey: '#808080',
  silver: '#C0C0C0',
};

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** The VTT colour class nearest to a colour. */
export function nearestVttClass(hex: string): string {
  const [r, g, b] = rgb(hex);
  let best = 'white';
  let bestD = Infinity;
  for (const [name, h] of Object.entries(VTT_COLOURS)) {
    const [r2, g2, b2] = rgb(h);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestD) [best, bestD] = [name, d];
  }
  return best;
}

/**
 * An ASS colour → "#RRGGBB": "&H00FFFF&", "&H0000FFFF" (alpha first, then blue, green, red) or SSA's
 * decimal number (BGR). Null when it can't be read.
 */
export function assColourToHex(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  let n: number;
  const hex = /^&H([0-9a-f]{1,8})&?$/i.exec(v);
  if (hex) n = parseInt(hex[1], 16);
  else if (/^-?\d+$/.test(v)) n = Number(v);
  else return null;
  n &= 0xffffff; // alpha dropped
  const b = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const r = n & 0xff;
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** "#RRGGBB" → ASS "&HBBGGRR&". */
export function hexToAss(hex: string): string {
  const [r, g, b] = rgb(hex);
  return `&H${[b, g, r]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}&`;
}

/** Subtle markup → VTT: <font color> as the nearest colour class. */
export function fontToVtt(text: string): string {
  return text.replace(/<font\b[^>]*>|<\/font>/gi, (tag) => {
    if (tag.startsWith('</')) return '</c>';
    const c = normColour(/color\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]);
    return c ? `<c.${nearestVttClass(c)}>` : '<c>';
  });
}

/** VTT → Subtle markup: a <c.…> naming a colour class becomes <font color>; other <c> tags stay. */
export function vttToFont(text: string): string {
  const stack: boolean[] = [];
  return text.replace(/<c((?:\.[\w-]+)*)>|<\/c>/g, (tag, classes: string | undefined) => {
    if (tag === '</c>') return stack.pop() ? '</font>' : tag;
    const colour = (classes ?? '').split('.').find((c) => c in VTT_COLOURS);
    stack.push(!!colour);
    return colour ? `<font color="${VTT_COLOURS[colour]}">` : tag;
  });
}

/**
 * The colours a document already uses (in <font color>, whole or part of a subtitle), most used
 * first, without `except` (the palette), at most `max`: picked again in one click.
 */
export function usedColours(texts: Iterable<string>, except: Iterable<string> = [], max = 12): string[] {
  const skip = new Set([...except].map((c) => normColour(c)));
  const count = new Map<string, number>();
  for (const text of texts) {
    for (const m of text.matchAll(/<font\b[^>]*color\s*=\s*["']?([^"'\s>]+)/gi)) {
      const c = normColour(m[1]);
      if (c && !skip.has(c)) count.set(c, (count.get(c) ?? 0) + 1);
    }
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([c]) => c);
}

/** Every <font color> of `from` in a text becomes `to` (whole subtitle or a word): a colour changed everywhere. */
export function replaceColour(text: string, from: string, to: string): string {
  const a = normColour(from);
  const b = normColour(to);
  if (!a || !b) return text;
  return text.replace(/<font\b([^>]*)>/gi, (tag, attrs: string) => {
    const m = /color\s*=\s*["']?([^"'\s>]+)["']?/i.exec(attrs);
    return m && normColour(m[1]) === a ? `<font color="${b}">` : tag;
  });
}

/** Coloured text: a <font color> other than white (Netflix and Prime Video ask for white only). */
export const hasColour = (text: string) => [...text.matchAll(/<font\b[^>]*color\s*=\s*["']?([^"'\s>]+)/gi)].some((m) => normColour(m[1]) !== '#FFFFFF');

/** Every <font> tag taken out: the words, italics, bold and position stay. */
export const removeColours = (text: string) => text.replace(/<\/?font\b[^>]*>/gi, '');

/** Tools › Remove colours and the quality fix: both languages, only the subtitles that have some. */
export function withoutColours(cues: Cue[]): Cue[] {
  return cues.map((c) =>
    hasColour(c.text) || (c.target !== undefined && hasColour(c.target))
      ? { ...c, text: removeColours(c.text), ...(c.target !== undefined ? { target: removeColours(c.target) } : {}) }
      : c,
  );
}
