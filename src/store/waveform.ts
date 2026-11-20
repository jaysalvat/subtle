/**
 * Audio waveform of the current video: analysed in a worker, cached in IndexedDB per film.
 * A nice-to-have: any failure just means no waveform.
 * Also holds the dialogue waveform (speech only, Silero VAD), which arrives with the finished peaks.
 */
import { create } from 'zustand';
import { del as idbDel, get as idbGet, keys as idbKeys, set as idbSet } from 'idb-keyval';
import { videoFingerprint } from '../lib/fingerprint';
import { touchRecent, type Waveform } from '../lib/audio/peaks';
import { speechMask, type Span } from '../lib/audio/speech';
import type { Dialogue, WaveformMessage } from '../workers/media/waveform';

type Status = 'none' | 'reading' | 'ready' | 'unavailable';

interface WaveformState {
  status: Status;
  /** 0…1 while reading. */
  progress: number;
  /** When reading started (ms): gives the time left. */
  startedAt: number;
  waveform: Waveform | null;
  /** Peaks scaled on speech + one byte per bucket (1 = speech). Null until ready, or when the VAD failed. */
  dialogue: (Dialogue & { mask: Uint8Array }) | null;
}

export const useWaveform = create<WaveformState>(() => ({ status: 'none', progress: 0, startedAt: 0, waveform: null, dialogue: null }));

/**
 * What is cached per film: one set of peaks (scaled on speech when the VAD worked, which is all the
 * app draws) and the speech spans. About 1.4 MB for a 2 h film.
 */
interface Cached {
  waveform: Waveform;
  spans: Span[] | null;
}
const withMask = (d: Dialogue | null, w: Waveform) => (d ? { ...d, mask: speechMask(d.spans, w.bucketsPerSecond, w.min.length) } : null);
const fromCache = (c: Cached) => ({ waveform: c.waveform, dialogue: c.spans ? withMask({ waveform: c.waveform, spans: c.spans }, c.waveform) : null });

const CACHE_VERSION = 3; // bump when the analysis changes, to ignore old cached peaks (2: + dialogue, 3: one set of peaks)
const PREFIX = 'subtle.waveform.v';
const RECENT_KEY = 'subtle.waveform.recent';
const MAX_CACHED = 10;
let worker: Worker | null = null;
let current = '';

/** Keyed by the film's fingerprint: a renamed film keeps its analysis. */
const cacheKey = async (file: File) => `${PREFIX}${CACHE_VERSION}.fp.${await videoFingerprint(file)}`;
/** The key before fingerprints: still read once, then moved to the new key. */
const nameKey = (file: File) => `${PREFIX}${CACHE_VERSION}.${file.name}.${file.size}`;

async function remember(key: string, w: Cached) {
  try {
    await idbSet(key, w);
    const { list, evicted } = touchRecent(((await idbGet(RECENT_KEY)) as string[] | undefined) ?? [], key, MAX_CACHED);
    await idbSet(RECENT_KEY, list);
    await Promise.all(evicted.map((k) => idbDel(k)));
    await dropOldVersions();
  } catch {
    /* storage full or unavailable: the waveform still works for this session */
  }
}

export function stopWaveform() {
  worker?.terminate();
  worker = null;
  current = '';
  useWaveform.setState({ status: 'none', progress: 0, waveform: null, dialogue: null });
}

export async function analyseWaveform(file: File) {
  stopWaveform();
  const token = `${file.name}.${file.size}.${Date.now()}`;
  current = token;
  useWaveform.setState({ status: 'reading', progress: 0, startedAt: Date.now() });

  const key = await cacheKey(file);
  let cached = (await idbGet(key).catch(() => undefined)) as Cached | undefined;
  // Analysed before fingerprints: moved to the new key (the old one deleted once that's written).
  const moved = !cached ? ((await idbGet(nameKey(file)).catch(() => undefined)) as Cached | undefined) : undefined;
  cached ??= moved;
  if (current !== token) return; // another video was loaded meanwhile
  if (cached?.waveform?.min instanceof Int8Array) {
    useWaveform.setState({ status: 'ready', progress: 1, ...fromCache(cached) });
    void remember(key, cached).then(() => moved && idbDel(nameKey(file)).catch(() => {}));
    return;
  }

  const w = new Worker(new URL('../workers/media.worker.ts', import.meta.url), { type: 'module', name: 'waveform' });
  worker = w;
  w.onmessage = (e: MessageEvent<WaveformMessage>) => {
    if (worker !== w) return;
    const m = e.data;
    if (m.type === 'progress') {
      useWaveform.setState({ progress: m.done / m.total, ...(m.waveform ? { waveform: m.waveform } : {}) });
    } else if (m.type === 'done') {
      const cache: Cached = m.dialogue ? { waveform: m.dialogue.waveform, spans: m.dialogue.spans } : { waveform: m.waveform, spans: null };
      useWaveform.setState({ status: 'ready', progress: 1, ...fromCache(cache) });
      void remember(key, cache);
      w.terminate();
      worker = null;
    } else {
      console.info(`No waveform: ${m.message}`);
      useWaveform.setState({ status: 'unavailable', waveform: null, dialogue: null });
      w.terminate();
      worker = null;
    }
  };
  w.onerror = () => {
    if (worker !== w) return;
    useWaveform.setState({ status: 'unavailable', waveform: null, dialogue: null });
    w.terminate();
    worker = null;
  };
  w.postMessage({ file });
}

/** Entries from an older analysis (another CACHE_VERSION): never read again, so deleted. */
async function dropOldVersions() {
  const current = `${PREFIX}${CACHE_VERSION}.`;
  const old = (await idbKeys()).filter((k) => typeof k === 'string' && k.startsWith(PREFIX) && !k.startsWith(current));
  await Promise.all(old.map((k) => idbDel(k)));
}

/** Films whose audio analysis is kept in this browser, and their total size. */
export async function waveformCacheInfo(): Promise<{ films: number; bytes: number }> {
  let films = 0;
  let bytes = 0;
  for (const k of await idbKeys()) {
    if (typeof k !== 'string' || !k.startsWith(PREFIX)) continue;
    const c = (await idbGet(k)) as Partial<Cached> & { dialogue?: { waveform?: Waveform } | null };
    films++;
    for (const w of [c?.waveform, c?.dialogue?.waveform]) if (w) bytes += w.min.byteLength + w.max.byteLength;
  }
  return { films, bytes };
}

/** Forget every film's audio analysis (each is analysed again when opened). */
export async function clearWaveformCache() {
  const all = (await idbKeys()).filter((k) => typeof k === 'string' && (k.startsWith(PREFIX) || k === RECENT_KEY));
  await Promise.all(all.map((k) => idbDel(k)));
}
