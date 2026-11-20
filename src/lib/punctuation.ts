/**
 * Fix punctuation: spaces before ! ? ; : and quotes by language convention, plus safe cleanups.
 * Tags ({\an8}, <i>…) are protected and never changed. Running it twice changes nothing more.
 */
import type { Cue } from './types';

/**
 * fr: French of France / Belgium (narrow no-break space before ; ! ?, no-break space before : and inside « »).
 * none: every other language, Québec and Switzerland included (kept simple): no space before ! ? ; :.
 */
export type PunctStyle = 'keep' | 'fr' | 'none';
export type QuoteStyle = 'keep' | 'guillemets' | 'curly' | 'straight';
export type EllipsisStyle = 'keep' | 'char' | 'dots';
/** Dialogue dash at the start of a line: leave it, "- Hi" (space after), or "-Hi" (Netflix English). */
export type DashStyle = 'keep' | 'space' | 'tight';

export interface PunctOptions {
  style: PunctStyle;
  quotes: QuoteStyle;
  ellipsis: EllipsisStyle;
  /** Double spaces, spaces before a comma or a period, spaces at the start / end of a line. */
  spaces: boolean;
  dashes: DashStyle;
  /** Semicolons become commas (Netflix doesn't use them). */
  semicolons: boolean;
}

export const NNBSP = ' ';
export const NBSP = ' ';

export const DEFAULT_PUNCT: PunctOptions = { style: 'keep', quotes: 'keep', ellipsis: 'keep', spaces: true, dashes: 'space', semicolons: false };

/**
 * Netflix's punctuation for the language: English and most languages: straight quotes with no
 * spaces inside, the ellipsis character, "-Hi" for two speakers, no semicolons. French (France,
 * Belgium) keeps French typography: « » with no-break spaces, "- Hi", semicolons allowed.
 */
export function netflixPunct(lang: string | undefined | null): PunctOptions {
  return punctStyleFor(lang) === 'fr'
    ? { style: 'fr', quotes: 'guillemets', ellipsis: 'char', spaces: true, dashes: 'space', semicolons: false }
    : { style: 'none', quotes: 'straight', ellipsis: 'char', spaces: true, dashes: 'tight', semicolons: true };
}

export const samePunct = (a: PunctOptions, b: PunctOptions) => (Object.keys(a) as (keyof PunctOptions)[]).every((k) => a[k] === b[k]);

/** Convention guessed from a language code: "fr", "fr-FR", "fr-BE" → French spacing; any other language → none. */
export function punctStyleFor(lang: string | undefined | null): PunctStyle {
  if (!lang) return 'keep';
  return /^fr(?:[-_](?:fr|be))?$/i.test(lang) ? 'fr' : 'none';
}

const TAG = /\{\\[^}]*\}|<\/?[a-zA-Z][^>]*>/g;
const SP = '[ \\u00a0\\u202f]';
/** Right after visible text (a char that isn't a space or a mark), maybe followed by tags. */
const AFTER_TEXT = '(?<=[^\\s!?;:\\u0000](?:\\u0000\\d+\\u0000)*)';
const re = (s: string) => new RegExp(s, 'g');

/** Rebuild double quotes in a text whose tags are replaced by tokens. Unpaired quotes: unchanged. */
function convertQuotes(t: string, to: QuoteStyle): string {
  const roles: ('open' | 'close')[] = [];
  let open = false;
  for (const ch of t.match(/["“”«»]/g) ?? []) {
    const role: 'open' | 'close' = ch === '«' || ch === '“' ? 'open' : ch === '»' || ch === '”' ? 'close' : open ? 'close' : 'open';
    if ((role === 'open') === open) return t; // two opens or two closes in a row: leave the text alone
    open = role === 'open';
    roles.push(role);
  }
  if (open) return t;
  const [o, c] = to === 'guillemets' ? ['«', '»'] : to === 'curly' ? ['“', '”'] : ['"', '"'];
  let i = 0;
  return t.replace(re(`(${SP}*)(["“”«»])(${SP}*)`), (_m, before: string, _q: string, after: string, at: number, all: string) => {
    const end = at + _m.length;
    if (roles[i++] === 'open') {
      const inner = to === 'guillemets' && end < all.length && all[end] !== '\n' ? NBSP : '';
      return before + o + inner;
    }
    const inner = to === 'guillemets' && at > 0 && all[at - 1] !== '\n' ? NBSP : '';
    return inner + c + after;
  });
}

export function fixPunctuationText(input: string, o: PunctOptions): string {
  const saved: string[] = [];
  let t = input.replace(TAG, (m) => {
    saved.push(m);
    return `\u0000${saved.length - 1}\u0000`;
  });

  if (o.ellipsis === 'char') t = t.replace(/(?<!\.)\.\.\.(?!\.)/g, '…');
  if (o.ellipsis === 'dots') t = t.replace(/…/g, '...');

  if (o.spaces) {
    t = t.replace(/ {2,}/g, ' ');
    // "Hello , you ." → "Hello, you." (not ".5", not "...")
    t = t.replace(re(`${AFTER_TEXT}${SP}+([,.])(?![\\d.])`), '$1');
    t = t.replace(re(`${AFTER_TEXT}${SP}+(\\.\\.\\.|…)`), '$1');
  }

  // Dialogue dash at the start of a line (after tags): "-Hi" → "- Hi". Not "-5", not "--".
  if (o.dashes === 'space') t = t.replace(/^((?:\u0000\d+\u0000)*)-(?=[^\s\-\d])/gm, '$1- ');
  // "- Hi" → "-Hi" (a dash then spaces, then text: not "- 5", which may be a minus).
  if (o.dashes === 'tight') t = t.replace(/^((?:\u0000\d+\u0000)*)-[ \u00a0\u202f]+(?=[^\s\-\d])/gm, '$1-');

  // "Yes; no" → "Yes, no" (only a semicolon followed by a space or the end: not "&amp;").
  if (o.semicolons) t = t.replace(re(`(?<!&#?\\w+)${SP}*;(?=[\\s\\u0000]|$)`), ',');

  if (o.quotes !== 'keep') t = convertQuotes(t, o.quotes);

  // A colon only counts when followed by a space or the end ("10:30", "http://" are left alone).
  const COLON = `:(?=[\\s\\u0000]|$)`;
  if (o.style === 'fr') {
    t = t.replace(re(`${AFTER_TEXT}${SP}*([!?;]+)`), `${NNBSP}$1`);
    t = t.replace(re(`${AFTER_TEXT}${SP}*${COLON}`), `${NBSP}:`);
  } else if (o.style === 'none') {
    t = t.replace(re(`${AFTER_TEXT}${SP}+([!?;]+)`), '$1');
    t = t.replace(re(`${AFTER_TEXT}${SP}+${COLON}`), ':');
  }
  if (o.style === 'fr') {
    // Inside « » (not at a line break: a quote can run over two lines).
    t = t.replace(re(`«${SP}*(?=[^\\s])`), `«${NBSP}`);
    t = t.replace(re(`(?<=[^\\s«])${SP}*»`), `${NBSP}»`);
  }

  if (o.spaces) {
    // Spaces at the start / end of a line, tags kept in place.
    t = t
      .split('\n')
      .map((l) => l.replace(/^((?:\u0000\d+\u0000)*)[   ]+/, '$1').replace(/[   ]+((?:\u0000\d+\u0000)*)$/, '$1'))
      .join('\n');
  }

  return t.replace(/\u0000(\d+)\u0000/g, (_, n) => saved[Number(n)]);
}

export interface PunctResult {
  cues: Cue[];
  changed: { id: string; before: string; after: string }[];
}

/** Fix the source text, or the translation (`field: 'target'`). Times and VTT settings are never touched. */
export function fixPunctuation(cues: Cue[], o: PunctOptions, field: 'text' | 'target' = 'text', selected?: string[]): PunctResult {
  const sel = selected && selected.length ? new Set(selected) : null;
  const changed: PunctResult['changed'] = [];
  const out = cues.map((c) => {
    const before = c[field];
    if (before === undefined || (sel && !sel.has(c.id))) return c;
    const after = fixPunctuationText(before, o);
    if (after === before) return c;
    changed.push({ id: c.id, before, after });
    return { ...c, [field]: after };
  });
  return { cues: out, changed };
}
