/// <reference lib="webworker" />
/**
 * Exact frames for the timeline thumbnails. Stays open for the current video. The main thread
 * sends the frames it wants (the visible slots); a new request replaces the waiting ones.
 */
import { FrameReader } from '../../media/frames';

export type FramesRequest = { type: 'open'; file: File; height: number } | { type: 'want'; items: { key: number; t: number }[] };
export type FramesMessage = { type: 'ready' } | { type: 'frame'; key: number; jpeg: Blob | null } | { type: 'error'; message: string };

const post = (m: FramesMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

let reader: Promise<FrameReader> | null = null;
let queue: { key: number; t: number }[] = [];
let busy = false;

async function pump() {
  if (busy || !reader) return;
  busy = true;
  try {
    const r = await reader;
    while (queue.length) {
      const { key, t } = queue.shift()!;
      post({ type: 'frame', key, jpeg: await r.frameAt(t) });
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    queue = [];
  } finally {
    busy = false;
  }
}

/** This instance's messages (media.worker.ts runs it when the worker is named 'frames'). */
export const onFramesMessage = (e: MessageEvent<FramesRequest>) => {
  const m = e.data;
  if (m.type === 'open') {
    reader = FrameReader.open(m.file, m.height);
    reader.then(() => post({ type: 'ready' })).catch((err: unknown) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
  } else {
    queue = m.items; // the visible slots now; older requests are dropped
    void pump();
  }
};
