import { srtText, vttCue } from './position';
import { formatSrtTime, formatTimecode, parseTimestamp } from './time';
import { fontToVtt, vttToFont } from './colour';
import { newId, type Cue, type SubtitleDoc, type SubtitleFormat } from './types';
import { looksLikeAss, looksLikeSbv, looksLikeTtml, parseAss, parseSbv, parseTtml, serializeAss, serializeSbv, serializeTtml } from './formatsMore';

const ARROW_RE = /^\s*(\S+)\s*-->\s*(\S+)(.*)$/;

function normalize(input: string): string {
  return input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

function sortCues(cues: Cue[]): Cue[] {
  return [...cues].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Tolerant SRT parser: broken numbering, extra blank lines, CRLF, "." or "," decimals. */
export function parseSrt(input: string): SubtitleDoc {
  const lines = normalize(input).split('\n');
  const cues: Cue[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = ARROW_RE.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const start = parseTimestamp(m[1]);
    const end = parseTimestamp(m[2]);
    i++;
    const text: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      // A missing blank line before the next cue: "12\n00:00:01,000 --> ..."
      if (ARROW_RE.test(lines[i])) break;
      if (/^\d+$/.test(lines[i].trim()) && i + 1 < lines.length && ARROW_RE.test(lines[i + 1])) break;
      text.push(lines[i]);
      i++;
    }
    if (Number.isFinite(start) && Number.isFinite(end)) {
      cues.push({ id: newId(), start, end: Math.max(end, start), text: text.join('\n') });
    }
  }
  return { format: 'srt', cues: sortCues(cues) };
}

/** Cues with no text (untranslated, freshly inserted) are left out: an empty cue breaks many players. */
const hasText = (c: Cue, useTarget: boolean) => ((useTarget ? c.target : c.text) ?? '').trim() !== '';

export function serializeSrt(cues: Cue[], useTarget = false): string {
  return (
    sortCues(cues)
      .filter((c) => hasText(c, useTarget))
      .map((c, idx) => `${idx + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${srtText(c, useTarget ? (c.target ?? '') : c.text)}`)
      .join('\n\n') + '\n'
  );
}

/** VTT parser keeping identifiers, cue settings, header and NOTE / STYLE / REGION blocks. */
export function parseVtt(input: string): SubtitleDoc {
  const blocks = normalize(input).split(/\n{2,}/);
  const first = blocks.shift() ?? '';
  if (!first.trim().startsWith('WEBVTT')) {
    // Not a real VTT: let the SRT parser have a go (it accepts "." decimals).
    const doc = parseSrt(input);
    return { ...doc, format: 'vtt' };
  }
  const header = first.trim();
  const cues: Cue[] = [];
  const extra: string[] = [];
  for (const block of blocks) {
    const trimmed = block.replace(/^\n+|\n+$/g, '');
    if (!trimmed) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(trimmed)) {
      extra.push(trimmed);
      continue;
    }
    const lines = trimmed.split('\n');
    let idx = 0;
    let vttId: string | undefined;
    if (!ARROW_RE.test(lines[0])) {
      vttId = lines[0];
      idx = 1;
    }
    const m = ARROW_RE.exec(lines[idx] ?? '');
    if (!m) continue;
    const start = parseTimestamp(m[1]);
    const end = parseTimestamp(m[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const settings = m[3].trim();
    cues.push({
      id: newId(),
      start,
      end: Math.max(end, start),
      text: vttToFont(lines.slice(idx + 1).join('\n')),
      ...(vttId ? { vttId } : {}),
      ...(settings ? { vttSettings: settings } : {}),
    });
  }
  return { format: 'vtt', cues: sortCues(cues), vttHeader: header, vttBlocks: extra };
}

export function serializeVtt(doc: Pick<SubtitleDoc, 'cues' | 'vttHeader' | 'vttBlocks'>, useTarget = false): string {
  const parts: string[] = [doc.vttHeader?.startsWith('WEBVTT') ? doc.vttHeader : 'WEBVTT'];
  for (const b of doc.vttBlocks ?? []) parts.push(b);
  for (const c of sortCues(doc.cues).filter((x) => hasText(x, useTarget))) {
    const out = vttCue(c, fontToVtt(useTarget ? (c.target ?? '') : c.text));
    const timing = `${formatTimecode(c.start)} --> ${formatTimecode(c.end)}${out.settings ? ' ' + out.settings : ''}`;
    parts.push([c.vttId, timing, out.text].filter((x) => x !== undefined).join('\n'));
  }
  return parts.join('\n\n') + '\n';
}

function detectFormat(fileName: string, text: string): SubtitleFormat {
  if (/\.vtt$/i.test(fileName) || /^﻿?WEBVTT/.test(text)) return 'vtt';
  if (/\.(ass|ssa)$/i.test(fileName) || looksLikeAss(text)) return 'ass';
  if (/\.(ttml|dfxp|xml)$/i.test(fileName) || looksLikeTtml(text)) return 'ttml';
  if (/\.sbv$/i.test(fileName) || looksLikeSbv(text)) return 'sbv';
  return 'srt';
}

export function parseSubtitles(fileName: string, text: string): SubtitleDoc {
  const f = detectFormat(fileName, text);
  return f === 'vtt' ? parseVtt(text) : f === 'ass' ? parseAss(text) : f === 'ttml' ? parseTtml(text) : f === 'sbv' ? parseSbv(text) : parseSrt(text);
}

export function serialize(doc: SubtitleDoc, format: SubtitleFormat, useTarget = false, lang?: string): string {
  if (format === 'vtt') return serializeVtt(doc, useTarget);
  if (format === 'ass') return serializeAss(doc.cues, useTarget);
  if (format === 'ttml') return serializeTtml(doc.cues, lang ?? doc.lang ?? 'en', useTarget);
  if (format === 'sbv') return serializeSbv(doc.cues, useTarget);
  return serializeSrt(doc.cues, useTarget);
}

/** Formats with less than SRT / VTT can hold: what's lost on export, for the Export window. */
export const FORMAT_INFO: Record<SubtitleFormat, { label: string; ext: string }> = {
  srt: { label: 'SRT', ext: 'srt' },
  vtt: { label: 'WebVTT', ext: 'vtt' },
  ass: { label: 'ASS', ext: 'ass' },
  ttml: { label: 'TTML (IMSC)', ext: 'ttml' },
  sbv: { label: 'SBV', ext: 'sbv' },
};

/** The format a file name says (for Save into it). */
export const formatOfName = (name: string): SubtitleFormat => detectFormat(name, '');
