/**
 * Dialogue waveform helpers: voice activity (Silero VAD probabilities) → speech spans → a waveform
 * scaled on speech peaks only, with a per-bucket speech mask to fade the rest. Pure, no DOM.
 */
import { packPeaks, type PeakData, type Waveform } from './peaks';

/** Silero VAD works on 16 kHz mono, 512-sample frames (32 ms). */
export const VAD_SR = 16000;
export const VAD_FRAME = 512;
export const VAD_FRAME_MS = (VAD_FRAME / VAD_SR) * 1000;

/** [start, end] in ms. */
export type Span = [number, number];

export interface SpanOptions {
  /** Speech starts at this probability… */
  threshold: number;
  /** …and ends after `minSilenceMs` below this one (hysteresis). */
  negThreshold: number;
  minSpeechMs: number;
  minSilenceMs: number;
  /** Added on both sides, so word starts and ends aren't cut. */
  padMs: number;
}
export const DEFAULT_SPANS: SpanOptions = { threshold: 0.5, negThreshold: 0.35, minSpeechMs: 200, minSilenceMs: 250, padMs: 100 };

/** Speech spans from per-frame speech probabilities (Silero's own post-processing, simplified). */
export function speechSpans(probs: ArrayLike<number>, frameMs = VAD_FRAME_MS, o: SpanOptions = DEFAULT_SPANS): Span[] {
  const raw: Span[] = [];
  let start = -1;
  let silentSince = -1;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i];
    if (start < 0) {
      if (p >= o.threshold) start = i;
      continue;
    }
    if (p >= o.negThreshold) silentSince = -1;
    else if (silentSince < 0) silentSince = i;
    if (silentSince >= 0 && (i + 1 - silentSince) * frameMs >= o.minSilenceMs) {
      raw.push([start * frameMs, silentSince * frameMs]);
      start = silentSince = -1;
    }
  }
  if (start >= 0) raw.push([start * frameMs, (silentSince >= 0 ? silentSince : probs.length) * frameMs]);
  const out: Span[] = [];
  for (const [a, b] of raw) {
    if (b - a < o.minSpeechMs) continue;
    const s: Span = [Math.max(0, a - o.padMs), b + o.padMs];
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push(s);
  }
  return out;
}

/** 1 for every waveform bucket touched by speech, 0 elsewhere. */
export function speechMask(spans: Span[], bucketsPerSecond: number, n: number): Uint8Array {
  const m = new Uint8Array(n);
  for (const [a, b] of spans) m.fill(1, Math.max(0, Math.floor((a / 1000) * bucketsPerSecond)), Math.min(n, Math.ceil((b / 1000) * bucketsPerSecond)));
  return m;
}

/**
 * Pack the peaks with the loudness reference taken from speech buckets only (99th percentile),
 * so loud music or effects between lines don't flatten the dialogue. No speech: whole-film reference.
 */
export function speechWaveform(p: PeakData, mask: Uint8Array, percentile = 0.99): Waveform {
  const amp: number[] = [];
  for (let i = 0; i < p.min.length; i++) if (mask[i]) amp.push(Math.max(-p.min[i], p.max[i]));
  if (!amp.length) {
    let ref = 0;
    for (let i = 0; i < p.min.length; i++) ref = Math.max(ref, -p.min[i], p.max[i]);
    return packPeaks(p, ref);
  }
  amp.sort((x, y) => x - y);
  return packPeaks(p, amp[Math.min(amp.length - 1, Math.floor(percentile * amp.length))]);
}

/**
 * Streaming box-filter downsampler to `outSr` (good enough for a VAD). `startFrame` is the index of
 * `mono[0]` at `sr`; `emit(i, v)` gets each output sample with its index at `outSr`.
 */
export function downsample(mono: Float32Array, sr: number, startFrame: number, outSr: number, emit: (i: number, v: number) => void): void {
  const ratio = sr / outSr;
  const n = mono.length;
  for (let o = Math.ceil(startFrame / ratio); ; o++) {
    const pos = o * ratio - startFrame;
    if (pos >= n) break;
    const a = Math.max(0, Math.ceil(pos - ratio / 2));
    const b = Math.min(n, Math.max(a + 1, Math.ceil(pos + ratio / 2)));
    let s = 0;
    for (let i = a; i < b; i++) s += mono[i];
    emit(o, s / (b - a));
  }
}
