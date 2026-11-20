/**
 * More subtitle formats, simplified on purpose: text, times, italics and top / bottom only.
 * Colours, fonts, exact positions and karaoke are not kept (they'd need a styling editor).
 * Inside Subtle the text uses SRT-style markup: <i>…</i> and a leading {\an8} for "top".
 * - SBV (YouTube): "0:00:01.000,0:00:03.000" then the text.
 * - ASS / SSA (Aegisub, anime): the [Events] section; {\i1}…{\i0}, {\an8}, \N.
 * - TTML / IMSC / DFXP (broadcast, Netflix delivery): <p begin end>, <br/>, italic spans, top region.
 */
import { isTop } from './position';
import { assColourToHex, hexToAss, normColour } from './colour';
import { newId, type Cue, type SubtitleDoc } from './types';

const sortCues = (cues: Cue[]) => [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
const normalize = (s: string) => s.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const textOf = (c: Cue, useTarget: boolean) => (useTarget ? (c.target ?? '') : c.text);
const hasText = (c: Cue, useTarget: boolean) => textOf(c, useTarget).trim() !== '';
const AN_ANY = /\{\\an\d\}/g;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/* ---------------- SBV ---------------- */

const SBV_TIME = /^(\d+):(\d{1,2}):(\d{1,2})\.(\d{1,3})$/;

function sbvTime(s: string): number {
  const m = SBV_TIME.exec(s.trim());
  if (!m) return NaN;
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + Math.round(+m[4].padEnd(3, '0'));
}

const fmtSbv = (ms: number) => {
  const t = Math.max(0, Math.round(ms));
  return `${Math.floor(t / 3600000)}:${pad(Math.floor(t / 60000) % 60)}:${pad(Math.floor(t / 1000) % 60)}.${pad(t % 1000, 3)}`;
};

export const looksLikeSbv = (text: string) =>
  /^\s*\d+:\d{1,2}:\d{1,2}\.\d{1,3},\d+:\d{1,2}:\d{1,2}\.\d{1,3}\s*$/m.test(
    normalize(text)
      .split('\n')
      .find((l) => l.trim()) ?? '',
  );

export function parseSbv(input: string): SubtitleDoc {
  const cues: Cue[] = [];
  for (const block of normalize(input).split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((l, i) => i > 0 || l.trim());
    if (!lines.length) continue;
    const [a, b] = lines[0].split(',');
    const start = sbvTime(a ?? '');
    const end = sbvTime(b ?? '');
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    cues.push({ id: newId(), start, end: Math.max(end, start), text: lines.slice(1).join('\n').trim() });
  }
  return { format: 'sbv', cues: sortCues(cues) };
}

/** SBV has no markup: tags are dropped. */
export function serializeSbv(cues: Cue[], useTarget = false): string {
  return (
    sortCues(cues)
      .filter((c) => hasText(c, useTarget))
      .map(
        (c) =>
          `${fmtSbv(c.start)},${fmtSbv(c.end)}\n${textOf(c, useTarget)
            .replace(AN_ANY, '')
            .replace(/<[^>]+>/g, '')}`,
      )
      .join('\n\n') + '\n'
  );
}

/* ---------------- ASS / SSA ---------------- */

function assTime(s: string): number {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/.exec(s.trim());
  if (!m) return NaN;
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + Math.round(+`0.${m[4]}` * 1000);
}

const fmtAss = (ms: number) => {
  const cs = Math.max(0, Math.round(ms / 10));
  return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
};

export const looksLikeAss = (text: string) => /^\s*\[Script Info\]/im.test(text) || /^\s*\[Events\]/im.test(text);

/** What a line takes from its style: bold, italic, at the top, a colour (null: white, the default). */
export interface AssStyle {
  bold?: boolean;
  italic: boolean;
  top: boolean;
  colour?: string | null;
}
const PLAIN: AssStyle = { italic: false, top: false };

/**
 * ASS text → Subtle markup: \N line breaks, bold (\b1, \b700), italics, colours (\c, \1c → <font color>), a top
 * alignment, starting from the line's style (`\r` back to it); every other override dropped.
 * Tags always nest: a colour changing inside italics closes and reopens what's around it.
 */
export function assToText(raw: string, style: AssStyle = PLAIN): string {
  let top = style.top;
  let out = '';
  /** What's open, outermost first: 'b', 'i' or a colour. */
  const open: string[] = [];
  const isTag = (x: string) => x === 'i' || x === 'b';
  const openTag = (x: string) => (isTag(x) ? `<${x}>` : `<font color="${x}">`);
  const closeTag = (x: string) => (isTag(x) ? `</${x}>` : '</font>');
  const is = (kind: 'i' | 'b' | 'colour') => (x: string) => (kind === 'colour' ? !isTag(x) : x === kind);
  const has = (kind: 'i' | 'b' | 'colour') => open.some(is(kind));
  const close = (kind: 'i' | 'b' | 'colour') => {
    const at = open.findIndex(is(kind));
    if (at < 0) return;
    const reopen = open.slice(at + 1);
    for (const x of open.slice(at).reverse()) out += closeTag(x);
    open.splice(at);
    for (const x of reopen) {
      out += openTag(x);
      open.push(x);
    }
  };
  const setColour = (c: string | null | undefined) => {
    const current = open.find((x) => !isTag(x)) ?? null;
    if ((c ?? null) === current) return;
    close('colour');
    if (c) {
      out += openTag(c);
      open.push(c);
    }
  };
  const setTag = (tag: 'i' | 'b', on: boolean) => {
    if (on === has(tag)) return;
    if (on) {
      out += `<${tag}>`;
      open.push(tag);
    } else close(tag);
  };
  setColour(style.colour);
  setTag('b', !!style.bold);
  setTag('i', style.italic);
  for (const part of raw.split(/(\{[^}]*\})/)) {
    if (!part.startsWith('{')) {
      out += part;
      continue;
    }
    const block = part.slice(1, -1);
    if (/\\an[789]/.test(block) || /\\a(5|6|7|9|10|11)(?!\d)/.test(block)) top = true;
    else if (/\\an[1-6]/.test(block) || /\\a(1|2|3)(?!\d)/.test(block)) top = false;
    for (const m of block.matchAll(/\\(?:i([01])|b(\d+)|r(?![a-z])|1?c(&H[0-9a-f]+&?)?(?![a-z\d]))/gi)) {
      if (m[1] !== undefined) setTag('i', m[1] === '1');
      else if (m[2] !== undefined) setTag('b', m[2] === '1' || Number(m[2]) > 400);
      else if (m[0] === '\\r') {
        setColour(style.colour);
        setTag('b', !!style.bold);
        setTag('i', style.italic);
      } else setColour(m[3] ? assColourToHex(m[3]) : style.colour);
    }
  }
  for (const x of [...open].reverse()) out += closeTag(x);
  // Empty pairs left by a change of colour or style (removing one can empty the one around it).
  for (let before = ''; before !== out;) {
    before = out;
    out = out.replace(/<i><\/i>|<b><\/b>|<font color="[^"]*"><\/font>/g, '');
  }
  out = out.replace(/\\N|\\n/g, '\n').replace(/\\h/g, ' ');
  return (top ? '{\\an8}' : '') + out.replace(/[ \t]+\n/g, '\n').trim();
}

/** "-1" / "1" on, else off (ASS writes -1 for true). */
const assBool = (v: string | undefined) => v !== undefined && v.trim() !== '' && v.trim() !== '0';
/** Style names compared the way players do: case and SSA's leading "*" ignored. */
const styleKey = (name: string) => name.trim().replace(/^\*/, '').toLowerCase();

/** The styles' italic and top alignment ([V4+ Styles], or SSA's [V4 Styles] with its old alignment numbers). */
export function assStyles(input: string): Map<string, AssStyle> {
  const out = new Map<string, AssStyle>();
  let section = '';
  let fields: string[] = [];
  for (const line of normalize(input).split('\n')) {
    const sec = /^\s*\[(.+)\]\s*$/.exec(line);
    if (sec) {
      section = sec[1].toLowerCase();
      fields = [];
      continue;
    }
    if (!/^v4\+? styles\+?$/.test(section)) continue;
    const fm = /^Format:\s*(.*)$/i.exec(line);
    if (fm) {
      fields = fm[1].split(',').map((f) => f.trim().toLowerCase());
      continue;
    }
    const sm = /^Style:\s*(.*)$/i.exec(line);
    if (!sm || !fields.length) continue;
    const v = sm[1].split(',');
    const get = (name: string) => v[fields.indexOf(name)];
    const align = Number(get('alignment'));
    // ASS: numpad (7-9 top); SSA: 1-3 bottom, 5-7 top, 9-11 middle.
    const top = section.includes('+') ? align >= 7 && align <= 9 : align >= 5 && align <= 7;
    const colour = assColourToHex(get('primarycolour'));
    out.set(styleKey(get('name') ?? ''), { bold: assBool(get('bold')), italic: assBool(get('italic')), top, colour: colour === '#FFFFFF' ? null : colour });
  }
  return out;
}

/** What Subtle doesn't keep from an ASS file: counted, for the warning on opening. */
export interface AssLosses {
  /** Styles beyond the first (all lines become one "Default"). */
  styles: number;
  /** Outline, shadow, karaoke colours and transparency (the text colour is kept). */
  colours: number;
  karaoke: number;
  positions: number;
  /** Other looks: underline, strike-out, fonts, sizes, borders, fades, animations… (bold is kept) */
  effects: number;
  drawings: number;
  comments: number;
  /** Fonts or pictures inside the file. */
  attachments: boolean;
}

export function assLosses(input: string): AssLosses {
  const text = normalize(input);
  const lines = text.split('\n');
  const dialogue = lines.filter((l) => /^Dialogue:/i.test(l));
  const count = (re: RegExp) => dialogue.filter((l) => re.test(l)).length;
  return {
    styles: Math.max(0, assStyles(text).size - 1),
    // Text colours (\c, \1c) are kept; outline / shadow colours and transparency aren't.
    colours: count(/\\(?:[2-4]c&|[1-4]a&|alpha)/i),
    karaoke: count(/\\(?:k[fo]?\d|K\d)/),
    positions: count(/\\(?:pos|move|org|i?clip)\(/),
    effects: count(/\\(?:u\d|s\d|fn|fs\d|bord|shad|blur|be\d|fsc[xy]?|fsp|fr[xyz]?|fa[xy]|fade?\(|t\()/),
    drawings: count(/\\p[1-9]/),
    comments: lines.filter((l) => /^Comment:/i.test(l)).length,
    attachments: /^\s*\[(fonts|graphics)\]\s*$/im.test(text),
  };
}

export function parseAss(input: string): SubtitleDoc {
  const lines = normalize(input).split('\n');
  const styles = assStyles(input);
  let inEvents = false;
  let fields = ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'];
  const cues: Cue[] = [];
  for (const line of lines) {
    const section = /^\s*\[(.+)\]\s*$/.exec(line);
    if (section) {
      inEvents = section[1].toLowerCase() === 'events';
      continue;
    }
    if (!inEvents) continue;
    const fm = /^Format:\s*(.*)$/i.exec(line);
    if (fm) {
      fields = fm[1].split(',').map((f) => f.trim());
      continue;
    }
    const dm = /^Dialogue:\s*(.*)$/i.exec(line);
    if (!dm) continue;
    // The text is the last field and may hold commas.
    const parts = dm[1].split(',');
    const values = [...parts.slice(0, fields.length - 1), parts.slice(fields.length - 1).join(',')];
    const get = (name: string) => values[fields.findIndex((f) => f.toLowerCase() === name.toLowerCase())] ?? '';
    const start = assTime(get('Start'));
    const end = assTime(get('End'));
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const text = assToText(get('Text'), styles.get(styleKey(get('Style'))));
    if (!text.replace(AN_ANY, '').trim()) continue; // drawings, empty karaoke lines
    cues.push({ id: newId(), start, end: Math.max(end, start), text });
  }
  return { format: 'ass', cues: sortCues(cues) };
}

const ASS_HEADER = `[Script Info]
; Written by Subtle
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,96,96,64,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

/** Subtle markup → ASS text: italics, top alignment, \N line breaks; other tags dropped. */
function textToAss(c: Cue, text: string): string {
  // Colours: <font color> → {\c&HBBGGRR&}, its end back to the colour around it (or the style's).
  const colours: string[] = [];
  const body = text
    .replace(AN_ANY, '')
    .replace(/<i>/gi, '{\\i1}')
    .replace(/<\/i>/gi, '{\\i0}')
    .replace(/<b>/gi, '{\\b1}')
    .replace(/<\/b>/gi, '{\\b0}')
    .replace(/<font\b[^>]*>|<\/font>/gi, (tag) => {
      if (tag.startsWith('</')) {
        colours.pop();
        const outer = colours[colours.length - 1];
        return outer ? `{\\c${hexToAss(outer)}}` : '{\\c}';
      }
      const hex = normColour(/color\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]) ?? colours[colours.length - 1] ?? '#FFFFFF';
      colours.push(hex);
      return `{\\c${hexToAss(hex)}}`;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/\n/g, '\\N');
  return (isTop(c) ? '{\\an8}' : '') + body;
}

export function serializeAss(cues: Cue[], useTarget = false): string {
  const events = sortCues(cues)
    .filter((c) => hasText(c, useTarget))
    .map((c) => `Dialogue: 0,${fmtAss(c.start)},${fmtAss(c.end)},Default,,0,0,0,,${textToAss(c, textOf(c, useTarget))}`);
  return [ASS_HEADER, ...events].join('\n') + '\n';
}

/* ---------------- TTML / IMSC / DFXP ---------------- */

export const looksLikeTtml = (text: string) => /<tt[\s>]/.test(text.slice(0, 2000));

/** A character from its number, or null when there's none (a file with &#99999999; still opens). */
const codePoint = (n: number) => (Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : null);
const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => codePoint(+n) ?? m)
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => codePoint(parseInt(n, 16)) ?? m)
    .replace(/&amp;/g, '&');
const encode = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1] ?? new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`).exec(tag)?.[1];

/** TTML times: "00:00:01.500", "00:00:01:12" (frames), "1.5s", "1500ms", "36000000t" (ticks). */
function ttmlTime(s: string | undefined, frameRate: number, tickRate: number): number {
  if (!s) return NaN;
  const v = s.trim();
  let m = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(v);
  if (m) return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + (m[4] ? Math.round(+`0.${m[4]}` * 1000) : 0);
  m = /^(\d+):(\d{2}):(\d{2}):(\d+(?:\.\d+)?)$/.exec(v);
  if (m) return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + Math.round((+m[4] / frameRate) * 1000);
  m = /^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/.exec(v);
  if (m) {
    const n = +m[1];
    const k = { h: 3600000, m: 60000, s: 1000, ms: 1, f: 1000 / frameRate, t: 1000 / tickRate }[m[2] as 'h'];
    return Math.round(n * k);
  }
  return NaN;
}

/** <p> content → Subtle markup: <br/> line breaks, italic spans, other tags dropped. */
function ttmlToText(inner: string): string {
  let out = '';
  const stack: string[] = [];
  for (const part of inner.split(/(<[^>]+>)/)) {
    if (!part.startsWith('<')) {
      out += decode(part.replace(/\s+/g, ' '));
      continue;
    }
    if (/^<br\b/i.test(part)) out += '\n';
    else if (/^<span\b/i.test(part)) {
      const it = /fontStyle\s*=\s*["']italic["']/i.test(part);
      const bold = /fontWeight\s*=\s*["']bold["']/i.test(part);
      const colour = normColour(/tts:color\s*=\s*["']([^"']+)["']/i.exec(part)?.[1]);
      const keep = colour && colour !== '#FFFFFF' ? colour : null;
      stack.push((keep ? '</font>' : '') + (bold ? '</b>' : '') + (it ? '</i>' : ''));
      out += (it ? '<i>' : '') + (bold ? '<b>' : '') + (keep ? `<font color="${keep}">` : '');
    } else if (/^<\/span/i.test(part)) out += stack.pop() ?? '';
  }
  return out.replace(/ *\n */g, '\n').trim();
}

export function parseTtml(input: string): SubtitleDoc {
  const text = normalize(input);
  const root = /<tt[^>]*>/.exec(text)?.[0] ?? '';
  const [num, den] = (attr(root, 'ttp:frameRateMultiplier') ?? '1 1').split(/\s+/).map(Number);
  const frameRate = (Number(attr(root, 'ttp:frameRate')) || 30) * ((num || 1) / (den || 1));
  const tickRate = Number(attr(root, 'ttp:tickRate')) || 10_000_000;
  // Regions shown at the top (displayAlign="before", or an id/origin that says so).
  const topRegions = new Set(
    [...text.matchAll(/<region\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((r) => /displayAlign\s*=\s*["']before["']/.test(r) || /xml:id\s*=\s*["'][^"']*top/i.test(r))
      .map((r) => attr(r, 'xml:id'))
      .filter((id): id is string => !!id),
  );
  const cues: Cue[] = [];
  for (const m of text.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const tag = `<p ${m[1]}>`;
    const start = ttmlTime(attr(tag, 'begin'), frameRate, tickRate);
    let end = ttmlTime(attr(tag, 'end'), frameRate, tickRate);
    if (!Number.isFinite(end)) end = start + ttmlTime(attr(tag, 'dur'), frameRate, tickRate);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const body = ttmlToText(m[2]);
    if (!body.trim()) continue;
    const region = attr(tag, 'region');
    const top = !!region && topRegions.has(region);
    cues.push({ id: newId(), start, end: Math.max(end, start), text: (top ? '{\\an8}' : '') + body });
  }
  return { format: 'ttml', cues: sortCues(cues) };
}

const fmtTtml = (ms: number) => {
  const t = Math.max(0, Math.round(ms));
  return `${pad(Math.floor(t / 3600000))}:${pad(Math.floor(t / 60000) % 60)}:${pad(Math.floor(t / 1000) % 60)}.${pad(t % 1000, 3)}`;
};

/** Subtle markup → TTML <p> content. */
function textToTtml(text: string): string {
  return text
    .replace(AN_ANY, '')
    .split(/(<\/?[ib]>|<font\b[^>]*>|<\/font>)/i)
    .map((part) => {
      if (/^<i>$/i.test(part)) return '<span tts:fontStyle="italic">';
      if (/^<b>$/i.test(part)) return '<span tts:fontWeight="bold">';
      if (/^<\/(i|b|font)>$/i.test(part)) return '</span>';
      if (/^<font\b/i.test(part)) return `<span tts:color="${normColour(/color\s*=\s*["']?([^"'\s>]+)/i.exec(part)?.[1]) ?? '#FFFFFF'}">`;
      return encode(part.replace(/<[^>]+>/g, ''));
    })
    .join('')
    .replace(/\n/g, '<br/>');
}

/** IMSC 1.1 text profile (what Netflix asks for), two regions: bottom and top. */
export function serializeTtml(cues: Cue[], lang = 'en', useTarget = false): string {
  const ps = sortCues(cues)
    .filter((c) => hasText(c, useTarget))
    .map((c) => `      <p begin="${fmtTtml(c.start)}" end="${fmtTtml(c.end)}" region="${isTop(c) ? 'top' : 'bottom'}">${textToTtml(textOf(c, useTarget))}</p>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:ittp="http://www.w3.org/ns/ttml/profile/imsc1#parameter" ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:timeBase="media" xml:lang="${encode(lang)}">
  <head>
    <styling>
      <style xml:id="default" tts:color="white" tts:fontFamily="proportionalSansSerif" tts:fontSize="100%" tts:textAlign="center" tts:textOutline="black 5%"/>
    </styling>
    <layout>
      <region xml:id="bottom" tts:origin="10% 10%" tts:extent="80% 80%" tts:displayAlign="after"/>
      <region xml:id="top" tts:origin="10% 10%" tts:extent="80% 80%" tts:displayAlign="before"/>
    </layout>
  </head>
  <body style="default">
    <div>
${ps.join('\n')}
    </div>
  </body>
</tt>
`;
}
