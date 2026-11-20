/// <reference lib="webworker" />
/** Filmstrip (media.worker.ts, instance 'thumbs'): keyframe thumbnails of a film, sent one by one. */
import { readThumbs } from '../../media/thumbs';

export type ThumbsRequest = { file: File; height: number };
export type ThumbsMessage =
  | { type: 'thumb'; timeMs: number; jpeg: Blob }
  | { type: 'progress'; done: number; total: number }
  | { type: 'info'; fps: number | null }
  | { type: 'done' }
  | { type: 'error'; message: string };

const post = (m: ThumbsMessage, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

/** This instance's messages (media.worker.ts runs it when the worker is named 'thumbs'). */
export const onThumbsMessage = (e: MessageEvent<ThumbsRequest>) => {
  readThumbs(e.data.file, e.data.height, {
    onThumb: (timeMs, jpeg) => post({ type: 'thumb', timeMs, jpeg }),
    onProgress: (done, total) => post({ type: 'progress', done, total }),
    onInfo: (fps) => post({ type: 'info', fps }),
  })
    .then(() => post({ type: 'done' }))
    .catch((err: unknown) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
};
