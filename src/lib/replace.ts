/**
 * Find and replace in subtitle text (a name, a misspelt word…), plain text or a regular expression.
 * Tags (<i>, {\an8}) are never matched nor changed. Pure: (cues, options) → cues + what changed.
 */
import type { Cue } from './types';

export interface ReplaceOptions {
  find: string;
  replace: string;
  /** Regular expression (JavaScript syntax; $1… in the replacement). */
  regex: boolean;
  matchCase: boolean;
  /** Only whole words ("Tom" not in "Tomato"). */
  wholeWord: boolean;
}

export const DEFAULT_REPLACE: ReplaceOptions = { find: '', replace: '', regex: false, matchCase: false, wholeWord: false };

export interface ReplaceResult {
  cues: Cue[];
  changed: { id: string; before: string; after: string }[];
  /** Matches replaced, in all. */
  count: number;
  /** The regular expression doesn't compile. */
  error: string | null;
}

const TAG = /\{\\[^}]*\}|<\/?[a-zA-Z][^>]*>/g;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The search as a RegExp, or an error message. Null when there's nothing to find. */
function buildPattern(o: ReplaceOptions): RegExp | string | null {
  if (!o.find) return null;
  let src = o.regex ? o.find : escape(o.find);
  // Letters of any language count as word characters (é, ç, ß…).
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(src, `gu${o.matchCase ? '' : 'i'}`);
  } catch (e) {
    return e instanceof Error ? e.message.replace(/^Invalid regular expression: (\/.*\/[a-z]*: )?/, '') : String(e);
  }
}

/** Replace in one text, leaving tags alone. Returns the new text and the number of matches. */
export function replaceText(text: string, re: RegExp, replacement: string, regex: boolean): { text: string; count: number } {
  let count = 0;
  const parts = text.split(new RegExp(`(${TAG.source})`, 'g'));
  const out = parts.map((part, i) => {
    if (i % 2 === 1) return part; // a tag
    return part.replace(re, (...args) => {
      // Empty matches (e.g. "^" or "x*") would add the text everywhere: skip them.
      if (args[0] === '') return '';
      count++;
      if (!regex) return replacement;
      const named = typeof args[args.length - 1] === 'object';
      const groups = args.slice(1, named ? -3 : -2) as (string | undefined)[];
      return replacement.replace(/\$(\$|&|\d{1,2})/g, (m, g: string) => (g === '$' ? '$' : g === '&' ? args[0] : (groups[Number(g) - 1] ?? m)));
    });
  });
  return { text: out.join(''), count };
}

export function findReplace(cues: Cue[], o: ReplaceOptions, field: 'text' | 'target' = 'text', selected?: string[]): ReplaceResult {
  const pattern = buildPattern(o);
  if (pattern === null || typeof pattern === 'string') return { cues, changed: [], count: 0, error: typeof pattern === 'string' ? pattern : null };
  const sel = selected && selected.length ? new Set(selected) : null;
  const changed: ReplaceResult['changed'] = [];
  let count = 0;
  const out = cues.map((c) => {
    const before = c[field];
    if (before === undefined || (sel && !sel.has(c.id))) return c;
    const r = replaceText(before, pattern, o.replace, o.regex);
    if (!r.count || r.text === before) return c;
    count += r.count;
    changed.push({ id: c.id, before, after: r.text });
    return { ...c, [field]: r.text };
  });
  return { cues: out, changed, count, error: null };
}
