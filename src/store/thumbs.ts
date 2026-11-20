/**
 * Filmstrip thumbnails of the current video (keyframes), extracted in a worker.
 * Kept in memory only (no cache yet). Any failure just means no filmstrip.
 */
import { create } from 'zustand';
import type { ThumbsMessage } from '../workers/media/thumbs';

/** Thumbnail bitmap height in device pixels (drawn 48 CSS px high). */
export const THUMB_PX = 96;
/** Height of the colour column used to average each thumbnail. */
const COLUMN_PX = 24;

interface ThumbsState {
  status: 'none' | 'reading' | 'ready' | 'unavailable';
  progress: number;
  /** When reading started (ms): gives the time left. */
  startedAt: number;
  /** Sorted by time; mutated in place, `count` changes when it grows. */
  times: number[];
  bitmaps: ImageBitmap[];
  /** Average colour of each thumbnail, [r, g, b] 0…255. */
  colors: [number, number, number][];
  count: number;
  /** Frame rate of the video, from its headers (null when unknown). */
  fps: number | null;
}

export const useThumbs = create<ThumbsState>(() => ({ status: 'none', progress: 0, startedAt: 0, times: [], bitmaps: [], colors: [], count: 0, fps: null }));

let worker: Worker | null = null;

export function stopThumbs() {
  worker?.terminate();
  worker = null;
  const s = useThumbs.getState();
  for (const b of s.bitmaps) b.close();
  useThumbs.setState({ status: 'none', progress: 0, times: [], bitmaps: [], colors: [], count: 0, fps: null });
}

export function extractThumbs(file: File) {
  stopThumbs();
  const w = new Worker(new URL('../workers/media.worker.ts', import.meta.url), { type: 'module', name: 'thumbs' });
  worker = w;
  const times: number[] = [];
  const bitmaps: ImageBitmap[] = [];
  const colors: [number, number, number][] = [];
  useThumbs.setState({ status: 'reading', progress: 0, startedAt: Date.now(), times, bitmaps, colors, count: 0 });
  let raf = 0;
  const bump = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (worker === w) useThumbs.setState({ count: times.length });
    });
  };
  const end = (status: 'ready' | 'unavailable') => {
    if (worker !== w) return;
    useThumbs.setState({ status, progress: 1, count: times.length });
    w.terminate();
    worker = null;
  };
  let decoding = Promise.resolve();
  w.onmessage = (e: MessageEvent<ThumbsMessage>) => {
    if (worker !== w) return;
    const m = e.data;
    if (m.type === 'thumb') {
      // Decode in arrival order (time order); insert in place just in case.
      decoding = decoding.then(async () => {
        const bmp = await createImageBitmap(m.jpeg).catch(() => null);
        // 'high' quality averages the pixels instead of sampling a single column.
        const col = await createImageBitmap(m.jpeg, { resizeWidth: 1, resizeHeight: COLUMN_PX, resizeQuality: 'high' }).catch(() => null);
        if (!bmp || !col || useThumbs.getState().bitmaps !== bitmaps) {
          bmp?.close();
          col?.close();
          return;
        }
        let i = times.length;
        while (i > 0 && times[i - 1] > m.timeMs) i--;
        times.splice(i, 0, m.timeMs);
        bitmaps.splice(i, 0, bmp);
        colors.splice(i, 0, averageColor(col));
        col.close();
        bump();
      });
    } else if (m.type === 'info') useThumbs.setState({ fps: m.fps });
    else if (m.type === 'progress') useThumbs.setState({ progress: m.done / m.total });
    else if (m.type === 'done') void decoding.then(() => end('ready'));
    else {
      console.info(`No filmstrip: ${m.message}`);
      void decoding.then(() => end(times.length ? 'ready' : 'unavailable'));
    }
  };
  w.onerror = () => worker === w && end(times.length ? 'ready' : 'unavailable');
  w.postMessage({ file, height: THUMB_PX });
}

const px = new OffscreenCanvas(1, COLUMN_PX).getContext('2d', { willReadFrequently: true })!;

/** Average colour of a 1-pixel-wide column (the thumbnail averaged by createImageBitmap). */
function averageColor(col: ImageBitmap): [number, number, number] {
  px.clearRect(0, 0, 1, COLUMN_PX);
  px.drawImage(col, 0, 0);
  const d = px.getImageData(0, 0, 1, COLUMN_PX).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
  }
  const n = d.length / 4;
  return [r / n, g / n, b / n];
}
