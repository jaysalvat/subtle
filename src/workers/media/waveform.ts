/// <reference lib="webworker" />
/**
 * Waveform (media.worker.ts, instance 'waveform'): reads the audio of a film and computes the waveform peaks
 * (centre channel + voice band for 5.1, all channels + voice band otherwise), and, at the same time,
 * where the speech is (Silero VAD) → the dialogue waveform.
 * A VAD failure (model not downloadable…) only means no dialogue waveform.
 */
import { centreChannel, readAudio } from '../../media/audio';
import { createVad } from '../../media/sileroVad';
import { VoiceBandFilter } from '../../lib/audio/filter';
import { addAudio, createPeaks, toWaveform, type PeakData, type Waveform } from '../../lib/audio/peaks';
import { speechMask, speechSpans, speechWaveform, type Span } from '../../lib/audio/speech';

export type WaveformRequest = { file: File };
/** Dialogue waveform: the peaks scaled on speech, and the speech spans (ms). */
export interface Dialogue {
  waveform: Waveform;
  spans: Span[];
}
export type WaveformMessage =
  | { type: 'progress'; done: number; total: number; waveform?: Waveform }
  | { type: 'done'; waveform: Waveform; dialogue: Dialogue | null }
  | { type: 'error'; message: string };

const post = (m: WaveformMessage, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

/** This instance's messages (media.worker.ts runs it when the worker is named 'waveform'). */
export const onWaveformMessage = (e: MessageEvent<WaveformRequest>) => {
  analyse(e.data.file).catch((err: unknown) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
};

type Vad = Awaited<ReturnType<typeof createVad>>;

async function analyse(file: File) {
  let peaks: PeakData | null = null;
  let centre = -1;
  let filter: VoiceBandFilter | null = null;
  let lastReport = 0;
  let vad: Vad | null = null;
  let vadReady: Promise<void> = Promise.resolve();
  const noVad = (err: unknown) => {
    console.info(`No dialogue waveform: ${err instanceof Error ? err.message : String(err)}`);
    vad = null;
  };

  await readAudio(file, {
    onInfo: (info) => {
      peaks = createPeaks(info.durationMs);
      centre = centreChannel(info.channels);
      vadReady = createVad(info.durationMs).then((v) => void (vad = v), noVad);
    },
    onAudio: (planes, sr, start) => {
      let mono: Float32Array;
      if (centre >= 0 && planes[centre]) mono = planes[centre];
      else {
        mono = new Float32Array(planes[0].length);
        for (const pl of planes) for (let i = 0; i < mono.length; i++) mono[i] += pl[i] / planes.length;
      }
      filter ??= new VoiceBandFilter(sr);
      addAudio(peaks!, [filter.process(mono)], sr, start);
      vad?.push(mono, sr, start);
    },
    onProgress: (done, total) => {
      if (done - lastReport < total / 20) return;
      lastReport = done;
      const w = toWaveform(peaks!);
      post({ type: 'progress', done, total, waveform: w }, [w.min.buffer, w.max.buffer]);
    },
    // The VAD runs in this thread too: reading waits when it lags, so audio blocks don't pile up.
    beforeRead: async () => {
      await vadReady;
      await (vad as Vad | null)?.beforeRead().catch(noVad);
    },
  });

  const waveform = toWaveform(peaks!);
  let dialogue: Dialogue | null = null;
  const v = vad as Vad | null;
  if (v) {
    try {
      const spans = speechSpans(await v.finish());
      dialogue = { waveform: speechWaveform(peaks!, speechMask(spans, peaks!.bucketsPerSecond, peaks!.min.length)), spans };
    } catch (err) {
      noVad(err);
    }
  }
  const transfer = [waveform.min.buffer, waveform.max.buffer, ...(dialogue ? [dialogue.waveform.min.buffer, dialogue.waveform.max.buffer] : [])];
  post({ type: 'done', waveform, dialogue }, transfer);
}
