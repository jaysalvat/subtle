/**
 * What Subtle keeps in this browser, for Settings › Storage: audio analysis per film (IndexedDB),
 * downloaded models (Cache Storage: the speech detector, and Whisper from the speech-to-text POC),
 * and the total the browser counts for the site.
 */
import { clearWaveformCache, waveformCacheInfo } from './waveform';

/** Caches holding downloaded models: ours (Silero VAD) and transformers.js (Whisper, POC). */
const MODEL_CACHES = ['subtle-models', 'transformers-cache'];

/** The models Subtle downloads, told apart by their address. `other`: anything else (e.g. the STT POC's). */
export type ModelId = 'vad' | 'ocr' | 'whisperFast' | 'whisperAccurate' | 'runtime' | 'other';
const MODEL_OF: [ModelId, (url: string) => boolean][] = [
  ['vad', (u) => u.includes('silero-vad')],
  ['ocr', (u) => u.includes('paddleocr')],
  ['whisperFast', (u) => u.includes('whisper-base')],
  ['whisperAccurate', (u) => u.includes('whisper-large-v3-turbo')],
  ['runtime', (u) => u.includes('onnxruntime-web')],
  ['other', () => true],
];
const modelOf = (url: string): ModelId => MODEL_OF.find(([, m]) => m(url))![0];

export interface StorageInfo {
  films: number;
  filmBytes: number;
  /** Each model downloaded, with its size (left out when not there). */
  models: { id: ModelId; bytes: number }[];
  /** Everything the browser counts for this site (project, settings, caches…), when it says. */
  totalBytes: number | null;
}

async function modelSizes(): Promise<StorageInfo['models']> {
  if (typeof caches === 'undefined') return [];
  const bytes = new Map<ModelId, number>();
  for (const name of MODEL_CACHES) {
    if (!(await caches.has(name))) continue;
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      const len = Number(res?.headers.get('content-length'));
      const n = len > 0 ? len : ((await res?.blob())?.size ?? 0);
      const id = modelOf(req.url);
      bytes.set(id, (bytes.get(id) ?? 0) + n);
    }
  }
  return MODEL_OF.map(([id]) => ({ id, bytes: bytes.get(id) ?? 0 })).filter((m) => m.bytes > 0);
}

export async function storageInfo(): Promise<StorageInfo> {
  const [{ films, bytes }, models, estimate] = await Promise.all([
    waveformCacheInfo().catch(() => ({ films: 0, bytes: 0 })),
    modelSizes().catch(() => []),
    navigator.storage?.estimate?.().catch(() => null) ?? null,
  ]);
  return { films, filmBytes: bytes, models, totalBytes: estimate?.usage ?? null };
}

export { clearWaveformCache };

/** Delete one downloaded model (downloaded again when needed). */
export async function clearModel(id: ModelId) {
  if (typeof caches === 'undefined') return;
  for (const name of MODEL_CACHES) {
    if (!(await caches.has(name))) continue;
    const cache = await caches.open(name);
    for (const req of await cache.keys()) if (modelOf(req.url) === id) await cache.delete(req);
  }
}

// Moved to lib/bytes (pure, tested); kept here for the places that import it from storage.
export { formatBytes } from '../lib/bytes';
