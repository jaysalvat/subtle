/**
 * Read and decode the audio track of a film (MP4, MOV, MKV, WebM), block by block, through
 * Mediabunny. Only the audio is read: video data is never loaded. Runs in a worker (uses File,
 * WebCodecs). Timestamps are presentation times (edit lists, AAC priming applied).
 */
import { AudioSampleSink } from 'mediabunny';
import { openMedia } from './mediaFile';

export interface AudioTrackInfo {
  codec: string;
  sampleRate: number;
  channels: number;
  durationMs: number;
}

export interface ReadStats {
  totalMs: number;
  /** Opening the file and finding the track. */
  openMs: number;
  chunksDecoded: number;
}

export interface ReadCallbacks {
  /** Called once the track is known and decodable. */
  onInfo?: (info: AudioTrackInfo) => void;
  /** Planar float samples of one decoded block, placed at `startFrame` from the start of the track. */
  onAudio: (planes: Float32Array[], sampleRate: number, startFrame: number) => void;
  onProgress?: (done: number, total: number) => void;
  /** Awaited before each block: lets a slow consumer (e.g. a VAD) hold the reading back. */
  beforeRead?: () => Promise<void>;
}

/** Index of the dialogue (centre) channel, or -1 when there is none. */
export const centreChannel = (channels: number) => (channels >= 6 ? 2 : -1);

/** Progress steps reported (the track's length is known, not its number of blocks). */
const STEPS = 1000;

export async function readAudio(file: File, cb: ReadCallbacks): Promise<ReadStats> {
  const t0 = performance.now();
  const input = openMedia(file);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('This video has no audio track.');
    if (!(await track.canDecode())) throw new Error(`The browser cannot decode this audio (${track.codec ?? 'unknown codec'}).`);
    const first = await track.getFirstTimestamp();
    const end = await track.computeDuration();
    const durationS = end - first;
    if (!(durationS > 0)) throw new Error('The audio track is empty.');
    cb.onInfo?.({
      codec: (await track.getCodecParameterString()) ?? track.codec ?? '',
      sampleRate: track.sampleRate,
      channels: track.numberOfChannels,
      durationMs: end * 1000,
    });
    const openMs = performance.now() - t0;

    let chunksDecoded = 0;
    let step = 0;
    await cb.beforeRead?.();
    for await (const sample of new AudioSampleSink(track).samples()) {
      try {
        const planes: Float32Array[] = [];
        for (let c = 0; c < sample.numberOfChannels; c++) {
          const buf = new Float32Array(sample.numberOfFrames);
          sample.copyTo(buf, { planeIndex: c, format: 'f32-planar' });
          planes.push(buf);
        }
        // Presentation time, as the player counts it (AAC priming before 0 comes out negative).
        cb.onAudio(planes, sample.sampleRate, Math.round(sample.timestamp * sample.sampleRate));
        chunksDecoded++;
        const now = Math.min(STEPS, Math.floor(((sample.timestamp - first + sample.duration) / durationS) * STEPS));
        if (now > step) cb.onProgress?.((step = now), STEPS);
      } finally {
        sample.close();
      }
      await cb.beforeRead?.();
    }
    if (step < STEPS) cb.onProgress?.(STEPS, STEPS);
    return { totalMs: performance.now() - t0, openMs, chunksDecoded };
  } finally {
    input.dispose();
  }
}
