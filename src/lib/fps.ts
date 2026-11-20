/**
 * Frame-rate conversion and automatic guess.
 * Subtitles made for one release of a film drift on another release at a different frame rate
 * (e.g. 23.976 fps film vs 25 fps PAL video: 4 % faster, so 2 min off after 1 h).
 */
import type { Cue } from './types';
import type { Waveform } from './audio/peaks';
import { applyLinear } from './tools';

export interface FpsConversion {
  id: string;
  /** Frame rate the subtitles were made for. */
  from: number;
  /** Frame rate of the video. */
  to: number;
  /** Time multiplier: subtitles at `from` fps, video at `to` fps → times × from / to. */
  scale: number;
}

const NTSC = 24000 / 1001; // 23.976…
const conv = (id: string, from: number, to: number): FpsConversion => ({ id, from, to, scale: from / to });

/** Common conversions, most frequent first. */
export const FPS_CONVERSIONS: FpsConversion[] = [
  conv('23.976>25', NTSC, 25),
  conv('25>23.976', 25, NTSC),
  conv('24>25', 24, 25),
  conv('25>24', 25, 24),
  conv('23.976>24', NTSC, 24),
  conv('24>23.976', 24, NTSC),
];
export const NO_CONVERSION: FpsConversion = conv('none', 1, 1);

export const fpsLabel = (f: number) => {
  for (const [v, label] of [
    [NTSC, '23.976'],
    [30000 / 1001, '29.97'],
    [60000 / 1001, '59.94'],
  ] as const)
    if (Math.abs(f - v) < 0.001) return label;
  return String(Math.round(f * 1000) / 1000);
};

const COMMON_FPS = [NTSC, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60];

/** Frame rate from a frame count and a duration, snapped to the usual value when within 0.05 fps. */
export function videoFrameRate(frames: number, durationMs: number): number | null {
  if (frames < 2 || durationMs <= 0) return null;
  const fps = (frames * 1000) / durationMs;
  const near = COMMON_FPS.find((f) => Math.abs(f - fps) < 0.05);
  return near ?? Math.round(fps * 1000) / 1000;
}

/**
 * The film's own frame rate in a video: 29.97 / 59.94 (NTSC video) carry a 23.976 film, 30 / 60 a
 * 24 one, 50 a 25 one — same running time (frames repeated), so subtitles timed for that film fit.
 */
export function filmRate(videoFps: number): number {
  const near = (f: number) => Math.abs(videoFps - f) < 0.001;
  if (near(30000 / 1001) || near(60000 / 1001)) return NTSC;
  if (near(30) || near(60)) return 24;
  if (near(50)) return 25;
  return videoFps;
}

/** Conversions that end at the video's (film) frame rate (the only possible ones); all of them when unknown or none match. */
export function conversionsFor(videoFps: number | null): FpsConversion[] {
  const film = videoFps && filmRate(videoFps);
  const fit = film ? FPS_CONVERSIONS.filter((c) => Math.abs(c.to - film) < 0.001) : [];
  return fit.length ? fit : FPS_CONVERSIONS;
}

export function convertFps(cues: Cue[], c: FpsConversion): Cue[] {
  return c.scale === 1 ? cues : applyLinear(cues, c.scale, 0);
}

/**
 * Speech activity per bin (default 100 ms) from the waveform: mean amplitude 0…127.
 * The waveform is already the dialogue source (centre channel / voice band).
 */
export function speechActivity(w: Waveform, binMs = 100): Float32Array {
  const per = Math.max(1, Math.round((w.bucketsPerSecond * binMs) / 1000));
  const n = Math.ceil(w.min.length / per);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let k = 0;
    for (let j = i * per; j < Math.min(w.min.length, (i + 1) * per); j++, k++) sum += Math.max(-w.min[j], w.max[j]);
    out[i] = k ? sum / k : 0;
  }
  return out;
}

/**
 * How well subtitles fall on speech: mean activity while a subtitle is shown, minus mean activity
 * the rest of the time. Higher is better. Subtitles pushed past the end of the audio count as silence.
 */
export function syncScore(cues: Cue[], activity: Float32Array, binMs = 100): number {
  const n = activity.length;
  if (!n || !cues.length) return 0;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + activity[i];
  let inSum = 0;
  let inBins = 0;
  let inRange = 0;
  for (const c of cues) {
    const a = Math.floor(c.start / binMs);
    const b = Math.max(a + 1, Math.ceil(c.end / binMs));
    inBins += b - a;
    const s = Math.min(n, Math.max(0, a));
    const e = Math.min(n, Math.max(0, b));
    if (e > s) {
      inSum += prefix[e] - prefix[s];
      inRange += e - s;
    }
  }
  const outBins = n - inRange;
  const inMean = inSum / inBins;
  const outMean = outBins > 0 ? (prefix[n] - inSum) / outBins : 0;
  return inMean - outMean;
}

/** All candidates (no conversion included), best match with the audio first. */
export function rankConversions(cues: Cue[], activity: Float32Array | null, videoFps: number | null = null): FpsConversion[] {
  const all = [NO_CONVERSION, ...conversionsFor(videoFps)];
  if (!activity) return all;
  return all
    .map((c) => ({ c, score: syncScore(convertFps(cues, c), activity) }))
    .sort((x, y) => y.score - x.score)
    .map((x) => x.c);
}
