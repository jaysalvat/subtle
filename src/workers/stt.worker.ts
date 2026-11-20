/// <reference lib="webworker" />
/**
 * Speech to text: Whisper in the browser (transformers.js, WebGPU, else WASM). Loads the model
 * first (downloaded once, kept in Cache Storage), then reads the film's audio once and transcribes
 * only the speech windows it is given, as they are read: memory stays small (one window at a time)
 * and words come back window by window.
 */
import { env, pipeline, Tensor, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { centreChannel, readAudio } from '../media/audio';
import { downsample, type Span } from '../lib/audio/speech';
import { mainLanguage, whisperLang, type Word } from '../lib/stt';

declare const __ORT_VERSION__: string;
// ONNX Runtime (WebGPU build, 25.6 MB) from jsDelivr, at the exact installed version (vite.config.ts):
// some static hosts (Cloudflare Pages…) refuse files over 25 MB. Kept by the browser's cache, not the
// app's offline cache. To serve the app's own copy instead: import
// 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.{mjs,wasm}?url', pass those here, and drop `ortFromCdn`.
const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${__ORT_VERSION__}/dist/`;
(env.backends.onnx as { wasm: { wasmPaths: unknown } }).wasm.wasmPaths = {
  mjs: `${ORT_CDN}ort-wasm-simd-threaded.asyncify.mjs`,
  wasm: `${ORT_CDN}ort-wasm-simd-threaded.asyncify.wasm`,
};

export interface SttRequest {
  file: File;
  /** Model repo on Hugging Face, and its precision on WebGPU (STT_MODELS). */
  model: string;
  /** The model's fixed version (a commit). */
  revision: string;
  gpuDtype: Record<string, string>;
  /** '' = detect. */
  language: string;
  windows: Span[];
}
export type SttMessage =
  | { type: 'download'; loaded: number; total: number }
  | { type: 'ready' }
  | {
      type: 'words';
      words: Word[];
      window: Span;
      doneMs: number;
      totalMs: number;
      /** Detecting: the language this window was transcribed in. */ lang?: string;
    }
  | { type: 'done' }
  | { type: 'error'; message: string };

const post = (m: SttMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
const SR = 16000;
/** Speech windows (≤ 28 s each) Whisper's language guess is summed over. */
const DETECT_WINDOWS = 3;

self.onmessage = (e: MessageEvent<SttRequest>) => {
  run(e.data).catch((err: unknown) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
};

async function loadModel(model: string, revision: string, gpuDtype: Record<string, string>): Promise<AutomaticSpeechRecognitionPipeline> {
  const files = new Map<string, { loaded: number; total: number }>();
  const gpu = !!(navigator as Navigator & { gpu?: unknown }).gpu;
  const options = {
    revision,
    device: gpu ? 'webgpu' : 'wasm',
    dtype: gpu ? gpuDtype : 'q8',
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      post({ type: 'download', loaded, total });
    },
  } as const;
  let asr: AutomaticSpeechRecognitionPipeline;
  try {
    asr = (await pipeline('automatic-speech-recognition', model, options as never)) as AutomaticSpeechRecognitionPipeline;
  } catch (err) {
    if (!gpu) throw err;
    // Some GPUs can't run the fp16 model: fall back to the CPU.
    asr = (await pipeline('automatic-speech-recognition', model, { ...options, device: 'wasm', dtype: 'q8' } as never)) as AutomaticSpeechRecognitionPipeline;
  }
  void dropOldCopies(model, revision);
  return asr;
}

/** The copies taken before versions were fixed (another revision, `main`): no longer used. */
async function dropOldCopies(model: string, revision: string) {
  try {
    const cache = await caches.open('transformers-cache');
    for (const k of await cache.keys()) if (k.url.includes(`${model}/resolve/`) && !k.url.includes(`/resolve/${revision}/`)) await cache.delete(k);
  } catch {
    /* no cache here */
  }
}

/**
 * The language spoken in `pcm`: Whisper's own guess (its decoder, one step after the start token,
 * scores every language token). transformers.js doesn't do it: without a language it transcribes
 * as English. Returns each language's probability.
 */
async function languageScores(asr: AutomaticSpeechRecognitionPipeline, pcm: Float32Array): Promise<Map<string, number>> {
  const a = asr as unknown as {
    processor: (x: Float32Array) => Promise<{ input_features: unknown }>;
    model: ((x: unknown) => Promise<{ logits: { data: Float32Array; dims: number[] } }>) & {
      generation_config: { decoder_start_token_id: number; lang_to_id?: Record<string, number> };
    };
  };
  const gc = a.model.generation_config;
  const scores = new Map<string, number>();
  if (!gc.lang_to_id) return scores;
  const { input_features } = await a.processor(pcm);
  const { logits } = await a.model({ input_features, decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(gc.decoder_start_token_id)]), [1, 1]) });
  const vocab = logits.dims.at(-1)!;
  const row = logits.data.subarray(logits.data.length - vocab);
  const langs = Object.entries(gc.lang_to_id).flatMap(([tok, id]) => {
    const lang = whisperLang(tok);
    return lang ? [[lang, row[id]] as const] : [];
  });
  const top = Math.max(...langs.map(([, x]) => x));
  const sum = langs.reduce((s, [, x]) => s + Math.exp(x - top), 0);
  for (const [lang, x] of langs) scores.set(lang, Math.exp(x - top) / sum);
  return scores;
}

/** Kept between runs: the next one with the same model starts at once. */
let loaded: { model: string; asr: AutomaticSpeechRecognitionPipeline } | null = null;

async function run(req: SttRequest) {
  if (loaded?.model !== req.model) {
    await loaded?.asr.dispose();
    loaded = { model: req.model, asr: await loadModel(req.model, req.revision, req.gpuDtype) };
  }
  const asr = loaded.asr;
  post({ type: 'ready' });
  // "Detect": Whisper's guess summed over the first speech windows, then kept for the rest.
  let language = req.language;
  const guess = new Map<string, number>();
  let guessed = 0;

  const { windows } = req;
  const totalMs = windows.reduce((s, [a, b]) => s + b - a, 0);
  let doneMs = 0;
  const buffers = new Map<number, Float32Array>();
  const queue: number[] = [];
  let next = 0; // first window not yet complete

  const transcribe = async () => {
    while (queue.length) {
      const k = queue.shift()!;
      const pcm = buffers.get(k);
      buffers.delete(k);
      const [a, b] = windows[k];
      let words: Word[] = [];
      if (pcm && !req.language && guessed < DETECT_WINDOWS) {
        try {
          for (const [lang, p] of await languageScores(asr, pcm)) guess.set(lang, (guess.get(lang) ?? 0) + p);
          guessed++;
          language = mainLanguage(guess) ?? '';
        } catch {
          /* left to Whisper (English) */
        }
      }
      if (pcm) {
        const out = (await asr(pcm, {
          return_timestamps: 'word',
          task: 'transcribe',
          ...(language ? { language } : {}),
        } as never)) as { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };
        words = (out.chunks ?? []).map((c) => ({
          text: c.text,
          start: a + c.timestamp[0] * 1000,
          end: a + (c.timestamp[1] ?? (b - a) / 1000) * 1000,
        }));
      }
      doneMs += b - a;
      post({ type: 'words', words, window: [a, b], doneMs, totalMs, ...(!req.language && language ? { lang: language } : {}) });
    }
  };

  let centre = -1;
  await readAudio(req.file, {
    onInfo: (info) => (centre = centreChannel(info.channels)),
    onAudio: (planes, sr, start) => {
      const mono = centre >= 0 && planes[centre] ? planes[centre] : mix(planes);
      downsample(mono, sr, start, SR, (i, v) => {
        const ms = (i / SR) * 1000;
        while (next < windows.length && ms >= windows[next][1]) queue.push(next++);
        if (next >= windows.length || ms < windows[next][0]) return;
        let buf = buffers.get(next);
        if (!buf) buffers.set(next, (buf = new Float32Array(Math.ceil(((windows[next][1] - windows[next][0]) / 1000) * SR))));
        const j = Math.floor(((ms - windows[next][0]) / 1000) * SR);
        // A few decoded samples can be NaN (edges of a block): Whisper only outputs "!!!!" then.
        if (j < buf.length && Number.isFinite(v)) buf[j] = v;
      });
    },
    // Reading waits while Whisper works: one window in memory at a time.
    beforeRead: transcribe,
  });
  while (next < windows.length) queue.push(next++);
  await transcribe();
  post({ type: 'done' });
}

function mix(planes: Float32Array[]): Float32Array {
  const m = new Float32Array(planes[0].length);
  for (const p of planes) for (let i = 0; i < m.length; i++) m[i] += p[i] / planes.length;
  return m;
}
