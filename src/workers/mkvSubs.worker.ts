/// <reference lib="webworker" />
/**
 * Reads one subtitle track of an MKV (src/lib/mkv.ts) off the main thread: a long film's index
 * holds tens of thousands of entries, decoding it would freeze the page and its progress bar.
 */
import { mkvCues, readMkvSubs, type MkvInfo, type MkvSubTrack } from '../lib/mkv';
import type { Cue } from '../lib/types';

export type MkvSubsRequest = { file: File; info: MkvInfo; track: MkvSubTrack };
export type MkvSubsMessage = { type: 'progress'; done: number; total: number } | { type: 'done'; cues: Cue[] } | { type: 'error'; message: string };

const post = (m: MkvSubsMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<MkvSubsRequest>) => {
  const { file, info, track } = e.data;
  const read = async (o: number, n: number) => new Uint8Array(await file.slice(o, o + n).arrayBuffer());
  try {
    let shown = -1;
    const { blocks } = await readMkvSubs(read, info, [track.number], (done, total) => {
      // One message per percent.
      const pct = Math.floor((done / total) * 100);
      if (pct !== shown) post({ type: 'progress', done: (shown = pct), total: 100 });
    });
    post({ type: 'done', cues: await mkvCues(blocks, track) });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
