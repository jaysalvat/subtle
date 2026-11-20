/**
 * Silero VAD v5 (speech probability per 32 ms frame) on ONNX Runtime Web, CPU / WASM, in a worker.
 * Fed while the audio is decoded: `push` the mono samples, `beforeRead` holds the reading back
 * when inference lags, `finish` returns the probabilities.
 * Speed trick: the audio is cut into blocks of `lanes` × ~10 s run as one batch (Silero's state has a
 * batch axis); each lane is primed with the 0.5 s before it, outputs discarded, so cuts don't show.
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { downsample, VAD_FRAME, VAD_FRAME_MS, VAD_SR } from '../lib/audio/speech';

/** A fixed version (a commit), not `main`: what's downloaded can't change under us. */
export const VAD_MODEL_URL = 'https://huggingface.co/onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec/onnx/model.onnx';
const LANE = VAD_FRAME * 312; // ≈ 10 s
const PRIME = VAD_FRAME * 16; // 0.5 s
const CTX = 64; // Silero v5 wants the last 64 samples of the previous frame in front of each frame

export interface VadStats {
  vadMs: number;
  runs: number;
  modelBytes: number;
  modelMs: number;
  modelCached: boolean;
}

async function loadModel() {
  const t = performance.now();
  const cache = await caches.open('subtle-models');
  let res = await cache.match(VAD_MODEL_URL);
  const cached = !!res;
  if (!res) {
    const r = await fetch(VAD_MODEL_URL);
    if (!r.ok) throw new Error(`Speech model download failed (${r.status}).`);
    await cache.put(VAD_MODEL_URL, r.clone());
    res = r;
    // Any other copy of the model (one taken from `main` before versions were fixed, a version tried): no longer used.
    for (const k of await cache.keys()) if (k.url.includes('silero-vad') && k.url !== VAD_MODEL_URL) await cache.delete(k);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  ort.env.wasm.wasmPaths = { wasm: wasmUrl };
  ort.env.wasm.numThreads = 1; // not cross-origin isolated
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  return { session, bytes: bytes.byteLength, ms: performance.now() - t, cached };
}

export async function createVad(durationMs: number, lanes = 32) {
  const model = await loadModel();
  const BLOCK = lanes * LANE;
  const SR_T = new ort.Tensor('int64', BigInt64Array.from([BigInt(VAD_SR)]), []);
  const probs = new Float32Array(Math.ceil(durationMs / VAD_FRAME_MS));
  const stats: VadStats = { vadMs: 0, runs: 0, modelBytes: model.bytes, modelMs: model.ms, modelCached: model.cached };

  // buf[k] = 16 kHz sample (blockStart - PRIME - CTX + k).
  let blockStart = 0;
  let buf = new Float32Array(PRIME + CTX + BLOCK);
  let written = 0;
  const queue: { start: number; data: Float32Array; end: number }[] = [];
  let busy: Promise<void> = Promise.resolve();

  async function runBlock(start: number, data: Float32Array, end: number) {
    const L = Math.min(lanes, Math.ceil((end - start) / LANE));
    if (L <= 0) return;
    const W = CTX + VAD_FRAME;
    let state: ort.Tensor = new ort.Tensor('float32', new Float32Array(2 * L * 128), [2, L, 128]);
    const steps = (PRIME + LANE) / VAD_FRAME;
    for (let s = 0; s < steps; s++) {
      const input = new Float32Array(L * W);
      for (let k = 0; k < L; k++) input.set(data.subarray(k * LANE + s * VAD_FRAME, k * LANE + s * VAD_FRAME + W), k * W);
      const t = performance.now();
      const out = await model.session.run({ input: new ort.Tensor('float32', input, [L, W]), state, sr: SR_T });
      stats.vadMs += performance.now() - t;
      stats.runs++;
      state = out.stateN;
      if (s * VAD_FRAME < PRIME) continue;
      const p = out.output.data as Float32Array;
      for (let k = 0; k < L; k++) {
        const f = (start + k * LANE - PRIME) / VAD_FRAME + s;
        if (f < probs.length) probs[f] = p[k];
      }
    }
  }
  const pump = () => {
    busy = busy.then(async () => {
      while (queue.length) {
        const b = queue.shift()!;
        await runBlock(b.start, b.data, b.end);
      }
    });
  };
  const write = (i: number, v: number) => {
    let k = i - (blockStart - PRIME - CTX);
    if (k >= buf.length) {
      queue.push({ start: blockStart, data: buf, end: blockStart + BLOCK });
      pump();
      const next = new Float32Array(buf.length);
      next.set(buf.subarray(BLOCK)); // the next block's prime + context
      buf = next;
      blockStart += BLOCK;
      k -= BLOCK;
    }
    if (k >= 0) buf[k] = v;
    if (i + 1 > written) written = i + 1;
  };

  return {
    stats,
    /** Mono samples at `sr`, `startFrame` = index of mono[0] from the start of the track. */
    push: (mono: Float32Array, sr: number, startFrame: number) => downsample(mono, sr, startFrame, VAD_SR, write),
    /** Seconds of audio checked so far. */
    checkedS: () => Math.max(0, blockStart - queue.length * BLOCK) / VAD_SR,
    beforeRead: async () => {
      while (queue.length > 1) await busy;
    },
    finish: async () => {
      queue.push({ start: blockStart, data: buf, end: written });
      pump();
      await busy;
      return probs;
    },
  };
}
