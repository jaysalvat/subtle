/**
 * Waveform peaks: one min/max pair per bucket (default 10 ms), mono mix of the channels given.
 * Built in floats (-1…1), then normalised and packed as Int8 (-127…127): a 2 h film fits in about 1.4 MB.
 */

/** Raw peaks while analysing. Buckets never filled stay at 0. */
export interface PeakData {
  bucketsPerSecond: number;
  min: Float32Array;
  max: Float32Array;
}

/** Normalised peaks, ready to draw and to cache. */
export interface Waveform {
  bucketsPerSecond: number;
  min: Int8Array;
  max: Int8Array;
}

export function createPeaks(durationMs: number, bucketsPerSecond = 100): PeakData {
  const n = Math.max(1, Math.ceil((durationMs / 1000) * bucketsPerSecond));
  return { bucketsPerSecond, min: new Float32Array(n), max: new Float32Array(n) };
}

/**
 * Add decoded audio to the peaks. `channels` are planar float samples (-1…1) of equal length,
 * mixed to mono; `startFrame` is the index of their first frame from the start of the track.
 */
export function addAudio(p: PeakData, channels: Float32Array[], sampleRate: number, startFrame: number): void {
  const frames = channels[0]?.length ?? 0;
  const nc = channels.length;
  const framesPerBucket = sampleRate / p.bucketsPerSecond;
  let bucket = -1;
  let lo = 0;
  let hi = 0;
  const flush = () => {
    if (bucket < 0 || bucket >= p.min.length) return;
    if (lo < p.min[bucket]) p.min[bucket] = lo;
    if (hi > p.max[bucket]) p.max[bucket] = hi;
  };
  for (let i = 0; i < frames; i++) {
    const b = Math.floor((startFrame + i) / framesPerBucket);
    if (b !== bucket) {
      flush();
      bucket = b;
      lo = Infinity;
      hi = -Infinity;
    }
    let v = 0;
    for (let c = 0; c < nc; c++) v += channels[c][i];
    v /= nc;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  flush();
}

/**
 * Normalise and pack. The loudness reference is a high percentile of the bucket amplitudes
 * (not the absolute max), so one explosion doesn't flatten the whole film. It maps to 90 % of
 * the height; louder buckets are clipped. Silent audio stays flat.
 */
export function toWaveform(p: PeakData, percentile = 0.995): Waveform {
  const n = p.min.length;
  const amp = new Float32Array(n);
  for (let i = 0; i < n; i++) amp[i] = Math.max(-p.min[i], p.max[i]);
  const sorted = amp.slice().sort();
  return packPeaks(p, sorted[Math.min(n - 1, Math.floor(percentile * n))]);
}

/** Pack float peaks as Int8, `ref` (an amplitude) mapping to 90 % of the height; louder is clipped. */
export function packPeaks(p: PeakData, ref: number): Waveform {
  const n = p.min.length;
  const scale = ref > 1e-4 ? (0.9 * 127) / ref : 127;
  const q = (v: number) => Math.max(-127, Math.min(127, Math.round(v * scale)));
  const min = new Int8Array(n);
  const max = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    min[i] = q(p.min[i]);
    max[i] = q(p.max[i]);
  }
  return { bucketsPerSecond: p.bucketsPerSecond, min, max };
}

/** Most-recent-first list of cache keys, capped: returns the new list and the keys to delete. */
export function touchRecent(list: string[], key: string, max: number): { list: string[]; evicted: string[] } {
  const next = [key, ...list.filter((k) => k !== key)];
  return { list: next.slice(0, max), evicted: next.slice(max) };
}
