/**
 * Hidden markup: the leading position tags ({\an8}…), a whole-subtitle colour (<font color>…</font>),
 * bold (<b>…</b>) and italic (<i>…</i>) are kept in the file but never shown in the text editor, in
 * that order, outermost first. Partial tags (one italic word, one coloured word) stay visible.
 */
import { normColour } from './colour';

interface Decor {
  /** Leading override tags, e.g. "{\an8}". */
  prefix: string;
  /** The whole subtitle is in bold (Pro mode). */
  bold: boolean;
  /** The whole subtitle is in italics. */
  italic: boolean;
  /** The whole subtitle's colour ("#RRGGBB"), or null. */
  colour: string | null;
  /** What the person edits. */
  body: string;
}

const LEADING_TAGS = /^(?:\{\\[^}]*\})+/;

function split(text: string): Decor {
  const prefix = LEADING_TAGS.exec(text)?.[0] ?? '';
  let rest = text.slice(prefix.length);
  // A colour around everything (outside the italics), with no other colour inside.
  let colour: string | null = null;
  const f = /^<font\s+color\s*=\s*["']?([^"'\s>]+)["']?\s*>([\s\S]*)<\/font>$/i.exec(rest);
  if (f && !/<\/?font\b/i.test(f[2]) && normColour(f[1])) [colour, rest] = [normColour(f[1]), f[2]];
  let bold = false;
  const b = /^<b>([\s\S]*)<\/b>$/.exec(rest);
  if (b && !/<\/?b>/.test(b[1])) [bold, rest] = [true, b[1]];
  const m = /^<i>([\s\S]*)<\/i>$/.exec(rest);
  if (m && !/<\/?i>/.test(m[1])) return { prefix, colour, bold, italic: true, body: m[1] };
  return { prefix, colour, bold, italic: false, body: rest };
}

function join(d: Decor): string {
  if (!d.body) return d.prefix;
  const italic = d.italic ? `<i>${d.body}</i>` : d.body;
  const inner = d.bold ? `<b>${italic}</b>` : italic;
  return d.prefix + (d.colour ? `<font color="${d.colour}">${inner}</font>` : inner);
}

/** The text shown in the editor. */
export const editableText = (text: string) => split(text).body;

/** Put an edited text back, with the original's hidden position tag and italics. */
export function withEditedText(original: string, body: string): string {
  return join({ ...split(original), body });
}

export const isItalic = (text: string) => split(text).italic;

/** Whole subtitle in italics (inner <i> tags merged) or not. */
export function setItalic(text: string, on: boolean): string {
  const d = split(text);
  return join({ ...d, italic: on, body: on ? d.body.replace(/<\/?i>/g, '') : d.body });
}

export const isBold = (text: string) => split(text).bold;

/** Whole subtitle in bold (inner <b> tags merged) or not. */
export function setBold(text: string, on: boolean): string {
  const d = split(text);
  return join({ ...d, bold: on, body: on ? d.body.replace(/<\/?b>/g, '') : d.body });
}

/** The whole subtitle's colour ("#RRGGBB"), or null. */
export const colourOf = (text: string) => split(text).colour;

/** The whole subtitle in a colour (inner colours dropped), or back to none (null). */
export function setColour(text: string, colour: string | null): string {
  const d = split(text);
  return join({ ...d, colour: normColour(colour), body: d.body.replace(/<\/?font\b[^>]*>/gi, '') });
}

/** Leading override tags of a text (e.g. "{\\an8}"), or "". */
export const leadingTags = (text: string) => LEADING_TAGS.exec(text)?.[0] ?? '';

/** Same text once spaces and line breaks are put aside (an AI answer that changed nothing). */
export const sameWords = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
