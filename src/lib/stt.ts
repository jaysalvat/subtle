/**
 * Speech to text, pure parts: which stretches of audio go to Whisper (built from the speech spans of
 * the dialogue waveform) and how its timed words become subtitles.
 */
import type { Span } from './audio/speech';
import { newId, type Cue } from './types';

/** One timed word from Whisper, in ms from the start of the film. */
export interface Word {
  text: string;
  start: number;
  end: number;
}

export type SttModelId = 'fast' | 'accurate';

/**
 * Whisper models offered (ONNX, word timestamps). Sizes and speeds measured on a Mac with WebGPU.
 * `gpu`: precision per part on WebGPU (whisper-base gives "!!!!" with an fp16 encoder).
 */
/** `revision`: a fixed Hugging Face commit (never `main`): what's downloaded can't change under us. */
export const STT_MODELS: Record<SttModelId, { repo: string; revision: string; mb: number; speed: number; gpu: Record<string, string> }> = {
  fast: {
    repo: 'onnx-community/whisper-base_timestamped',
    revision: '608c49e61301901684bc36cac8f74b95ff6b5a8e',
    mb: 150,
    speed: 20,
    gpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  },
  accurate: {
    repo: 'onnx-community/whisper-large-v3-turbo_timestamped',
    revision: 'b3f77bf9a8c4d5ea3415827033d1ffea7955fd9a',
    mb: 1500,
    speed: 10,
    gpu: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
  },
};

/**
 * Whisper's word times are estimates: now and then it stamps a whole sentence seconds too late in
 * its window, leaving a hole where it was said and landing over the next subtitles. Two guards, per
 * window (Whisper gives the words in the order they are said):
 * - every word stays inside its window;
 * - words timed after a later word are out of place: that run goes back into the gap between its
 *   neighbours, starting at the speech found there (dialogue detector), its own pace kept when it
 *   fits, squeezed when it doesn't.
 */
export function placeWords(words: Word[], [a, b]: Span, spans: Span[] | null, toleranceMs = 300): Word[] {
  const out = words.map((w) => {
    const start = Math.min(Math.max(w.start, a), b);
    return { ...w, start, end: Math.min(Math.max(w.end, start), b) };
  });
  // Earliest start among the words after each one.
  const minAfter: number[] = Array.from({ length: out.length }, () => 0);
  let min = Infinity;
  for (let i = out.length - 1; i >= 0; i--) {
    minAfter[i] = min;
    min = Math.min(min, out[i].start);
  }
  const late = out.map((w, i) => w.start > minAfter[i] + toleranceMs);
  for (let i = 0; i < out.length; i++) {
    if (!late[i]) continue;
    let j = i;
    while (j + 1 < out.length && late[j + 1]) j++;
    // The gap: after the word before the run, before the word after it.
    const from = i > 0 ? out[i - 1].end : a;
    const to = j + 1 < out.length ? out[j + 1].start : b;
    if (to > from) {
      const speech = spans?.find(([s, e]) => e > from && s < to);
      const start = speech ? Math.max(from, Math.min(speech[0], to)) : from;
      const runStart = out[i].start;
      const runLen = Math.max(1, out[j].end - runStart);
      const room = Math.max(1, to - start);
      const k = Math.min(1, room / runLen);
      for (let n = i; n <= j; n++) {
        out[n] = { ...out[n], start: start + (out[n].start - runStart) * k, end: start + (out[n].end - runStart) * k };
      }
    }
    i = j;
  }
  return out;
}

/** Whisper takes at most 30 s at a time. */
export const WINDOW_MS = 28000;

/**
 * Stretches of audio to transcribe: speech spans joined when close (a sentence across a breath),
 * never longer than `maxMs` (long speech is cut into equal parts). No spans (the speech detector
 * failed): the whole film in `maxMs` pieces.
 */
export function sttWindows(spans: Span[] | null, durationMs: number, maxMs = WINDOW_MS, joinMs = 1500): Span[] {
  const src: Span[] = spans ?? [[0, durationMs]];
  const joined: Span[] = [];
  for (const [a, b] of src) {
    const last = joined[joined.length - 1];
    if (last && a - last[1] <= joinMs && b - last[0] <= maxMs) last[1] = Math.max(last[1], b);
    else joined.push([a, b]);
  }
  const out: Span[] = [];
  for (const [a, b] of joined) {
    const parts = Math.ceil((b - a) / maxMs);
    const len = (b - a) / parts;
    for (let i = 0; i < parts; i++) out.push([Math.round(a + i * len), Math.round(i === parts - 1 ? b : a + (i + 1) * len)]);
  }
  return out;
}

export interface CueRules {
  maxLineLength: number;
  minDurationMs: number;
  minGapMs: number;
}

const MAX_MS = 6000;
const PAUSE_MS = 700;
/** Shortest subtitle made: less than this before the next one, its words join the next one. */
const MIN_ROOM_MS = 300;

/** Timed words → subtitles: ≤ 2 lines, ≤ 6 s, cut at pauses and sentence ends, minimum duration, no overlap. */
export function wordsToCues(words: Word[], rules: CueRules): Cue[] {
  const maxChars = 2 * rules.maxLineLength;
  const groups: Word[][] = [];
  let cur: Word[] = [];
  const text = (ws: Word[]) =>
    ws
      .map((w) => w.text)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  for (const w of words) {
    if (!w.text.trim()) continue;
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const t = text(cur);
      const breakHere =
        w.start - prev.end >= PAUSE_MS ||
        text([...cur, w]).length > maxChars ||
        w.end - cur[0].start > MAX_MS ||
        (/[.?!…]["»]?$/.test(t) && t.length >= 12) ||
        (/[,;:]$/.test(t) && t.length >= 50);
      if (breakHere) {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);

  const cues: Cue[] = groups.map((g) => ({
    id: newId(),
    start: Math.round(g[0].start),
    end: Math.round(g[g.length - 1].end),
    text: twoLines(text(g), rules.maxLineLength),
  }));
  // A subtitle with (almost) no room before the next one — Whisper sometimes gives several words the
  // same time — would last a millisecond: its words go to the start of the next one instead.
  const kept: Cue[] = [];
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    if (next && next.start - rules.minGapMs - cues[i].start < MIN_ROOM_MS) {
      next.start = cues[i].start;
      next.text = twoLines(`${cues[i].text.replace(/\n/g, ' ')} ${next.text.replace(/\n/g, ' ')}`, rules.maxLineLength);
      continue;
    }
    kept.push(cues[i]);
  }
  for (let i = 0; i < kept.length; i++) {
    const limit = i + 1 < kept.length ? kept[i + 1].start - rules.minGapMs : Infinity;
    if (kept[i].end - kept[i].start < rules.minDurationMs) kept[i].end = kept[i].start + rules.minDurationMs;
    kept[i].end = Math.max(kept[i].start + MIN_ROOM_MS, Math.min(kept[i].end, limit));
  }
  return kept;
}

/**
 * Whisper often times a subtitle's first word a little late; the speech detector knows when the
 * voice really starts. A subtitle starting shortly after a speech onset moves back to it (never onto
 * the previous subtitle). One starting mid-speech (a sentence cut in two) is left alone.
 */
export function startOnSpeech(cues: Cue[], spans: Span[] | null, gapMs: number, maxPullMs = 800, aheadMs = 150): Cue[] {
  if (!spans?.length) return cues;
  return cues.map((c, i) => {
    const onset = spans.find(([s]) => s >= c.start - maxPullMs && s <= c.start + aheadMs)?.[0];
    if (onset === undefined || onset >= c.start) return c;
    const floor = i > 0 ? cues[i - 1].end + gapMs : 0;
    const start = Math.round(Math.max(onset, floor));
    return start < c.start ? { ...c, start } : c;
  });
}

/** Split at the space closest to the middle, preferring after punctuation. */
function twoLines(t: string, line: number): string {
  if (t.length <= line) return t;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== ' ') continue;
    const score = Math.abs(i - t.length / 2) - (/[,.;:?!]/.test(t[i - 1]) ? 8 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best < 0 ? t : t.slice(0, best) + '\n' + t.slice(best + 1);
}

/** Time of [a, b] covered by subtitles, ms. */
function covered(a: number, b: number, cues: Cue[]): number {
  return cues.reduce((s, c) => s + Math.max(0, Math.min(b, c.end) - Math.max(a, c.start)), 0);
}

/**
 * Continue where subtitles are missing (after an interruption, or a file with gaps): the windows
 * already mostly covered by subtitles are left out.
 */
export function uncoveredWindows(windows: Span[], cues: Cue[], share = 0.5): Span[] {
  return windows.filter(([a, b]) => covered(a, b, cues) < (b - a) * share);
}

/** New subtitles that land on existing ones are dropped (the existing ones win). */
export function keepClear(fresh: Cue[], existing: Cue[], gapMs: number): Cue[] {
  return fresh.filter((c) => !existing.some((e) => c.start < e.end + gapMs && c.end > e.start - gapMs));
}

/** Whisper's language token ("<|es|>") → "es"; other special tokens (<|transcribe|>, <|0.00|>…) → null. */
export function whisperLang(token: string): string | null {
  const m = /^<\|([a-z]{2,3})\|>$/.exec(token);
  return m ? m[1] : null;
}

/** The language with the most weight (ms heard, or summed probabilities), else null. */
export function mainLanguage(heard: Map<string, number>): string | null {
  let best: string | null = null;
  for (const [lang, ms] of heard) if (best === null || ms > heard.get(best)!) best = lang;
  return best;
}
