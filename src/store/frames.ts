/**
 * Exact frames for the timeline thumbnails, decoded on demand in a worker and kept in a small
 * cache. Keyframe thumbnails (store/thumbs) are shown, dimmed, until the exact frame arrives.
 * Any failure just means the approximate thumbnails stay.
 */
import { create } from 'zustand';
import type { FramesMessage } from '../workers/media/frames';
import { THUMB_PX } from './thumbs';

const MAX_CACHED = 300;

/** Bumped when a frame arrives, so the strip redraws. */
export const useFrames = create<{ version: number; available: boolean }>(() => ({ version: 0, available: false }));

let worker: Worker | null = null;
const cache = new Map<number, ImageBitmap>(); // key → frame, oldest first
const pending = new Set<number>();
let raf = 0;

/** Cache key for a time: 10 ms resolution. */
export const frameKey = (t: number) => Math.round(t / 10);

export function getFrame(key: number): ImageBitmap | undefined {
  const b = cache.get(key);
  if (b) {
    cache.delete(key); // refresh: most recently used last
    cache.set(key, b);
  }
  return b;
}

export function stopFrames() {
  worker?.terminate();
  worker = null;
  for (const b of cache.values()) b.close();
  cache.clear();
  pending.clear();
  useFrames.setState({ version: 0, available: false });
}

export function startFrames(file: File) {
  stopFrames();
  const w = new Worker(new URL('../workers/media.worker.ts', import.meta.url), { type: 'module', name: 'frames' });
  worker = w;
  w.onmessage = async (e: MessageEvent<FramesMessage>) => {
    if (worker !== w) return;
    const m = e.data;
    if (m.type === 'ready') useFrames.setState({ available: true });
    else if (m.type === 'error') {
      console.info(`No exact frames: ${m.message}`);
      useFrames.setState({ available: false });
    } else {
      pending.delete(m.key);
      if (!m.jpeg) return;
      const bmp = await createImageBitmap(m.jpeg).catch(() => null);
      if (!bmp || worker !== w) return bmp?.close();
      cache.set(m.key, bmp);
      while (cache.size > MAX_CACHED) {
        const [oldest, b] = cache.entries().next().value!;
        cache.delete(oldest);
        b.close();
      }
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), useFrames.setState((s) => ({ version: s.version + 1 }))));
    }
  };
  w.postMessage({ type: 'open', file, height: THUMB_PX });
}

/** Ask for these frames (the visible slots). Replaces any earlier request still waiting. */
export function wantFrames(items: { key: number; t: number }[]) {
  if (!worker || !useFrames.getState().available) return;
  const missing = items.filter((it) => !cache.has(it.key));
  if (!missing.length) return;
  pending.clear();
  for (const it of missing) pending.add(it.key);
  worker.postMessage({ type: 'want', items: missing });
}
