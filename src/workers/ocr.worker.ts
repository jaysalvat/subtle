/// <reference lib="webworker" />
/**
 * Text on the picture: PaddleOCR (PP-OCRv3 mobile detection + PP-OCRv5 Latin recognition, ONNX,
 * ≈ 10 MB, downloaded once into Cache Storage "subtle-models") on ONNX Runtime Web (WASM).
 * Gets one frame, returns the text lines found with their boxes.
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { boxesFromMap, ctcDecode, type OcrBox, type OcrLine } from '../lib/ocr';

/** A fixed version (a commit), not `main`: what's downloaded can't change under us. */
const BASE = 'https://huggingface.co/monkt/paddleocr-onnx/resolve/7b02d0a30a07ba2b92ad1ff5a8941ae2c633de65/';
export const OCR_FILES = { det: BASE + 'detection/v3/det.onnx', rec: BASE + 'languages/latin/rec.onnx', dict: BASE + 'languages/latin/dict.txt' };

export type OcrRequest = { frame: ImageBitmap };
export type OcrMessage =
  { type: 'download'; loaded: number; total: number } | { type: 'lines'; lines: OcrLine[]; ms: number } | { type: 'error'; message: string };

const post = (m: OcrMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

/** Longest side given to the detector (PaddleOCR's default), multiple of 32. */
const DET_SIDE = 960;
/** Line height for the recogniser (PP-OCRv5). */
const REC_H = 48;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let models: Promise<{ det: ort.InferenceSession; rec: ort.InferenceSession; dict: string[] }> | null = null;

async function cached(url: string, onBytes: (n: number) => void): Promise<Response> {
  const cache = await caches.open('subtle-models');
  const hit = await cache.match(url);
  if (hit) return hit;
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`Text recognition model download failed (${r.status}).`);
  // Count bytes as they arrive, for the progress bar; store the whole file once done.
  const reader = r.body.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    onBytes(value.byteLength);
  }
  const res = new Response(new Blob(parts as BlobPart[]), { headers: { 'content-type': r.headers.get('content-type') ?? 'application/octet-stream' } });
  await cache.put(url, res.clone());
  // The copies taken from `main` before versions were fixed: no longer used.
  for (const k of await cache.keys()) if (k.url.includes('paddleocr-onnx/resolve/main/')) await cache.delete(k);
  return res;
}

function load() {
  models ??= (async () => {
    ort.env.wasm.wasmPaths = { wasm: wasmUrl };
    ort.env.wasm.numThreads = 1;
    let loaded = 0;
    const total = 2_429_873 + 7_862_832; // det + rec, for the progress bar
    const tick = (n: number) => post({ type: 'download', loaded: (loaded += n), total });
    const [det, rec, dict] = await Promise.all([
      cached(OCR_FILES.det, tick).then((r) => r.arrayBuffer()),
      cached(OCR_FILES.rec, tick).then((r) => r.arrayBuffer()),
      cached(OCR_FILES.dict, () => {}).then((r) => r.text()),
    ]);
    const opts = { executionProviders: ['wasm'] };
    return {
      det: await ort.InferenceSession.create(new Uint8Array(det), opts),
      rec: await ort.InferenceSession.create(new Uint8Array(rec), opts),
      dict: dict.split('\n').filter((l, i, all) => l !== '' || i < all.length - 1),
    };
  })();
  models.catch(() => (models = null));
  return models;
}

/** Image → normalised CHW float tensor, BGR (PaddleOCR reads images with OpenCV). */
function toTensor(data: Uint8ClampedArray, w: number, h: number, mean: number[], std: number[]): ort.Tensor {
  const out = new Float32Array(3 * w * h);
  const plane = w * h;
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      const v = data[i * 4 + (2 - c)] / 255; // B, G, R
      out[c * plane + i] = (v - mean[c]) / std[c];
    }
  }
  return new ort.Tensor('float32', out, [1, 3, h, w]);
}

function draw(frame: ImageBitmap, sx: number, sy: number, sw: number, sh: number, w: number, h: number): Uint8ClampedArray {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/** The line's rectangle, turned level, scaled to `w` × `h`. */
function crop(frame: ImageBitmap, b: OcrBox, w: number, h: number): Uint8ClampedArray {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(w / b.w, h / b.h);
  ctx.translate(b.w / 2, b.h / 2);
  ctx.rotate(-b.angle);
  ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
  ctx.drawImage(frame, 0, 0);
  return ctx.getImageData(0, 0, w, h).data;
}

async function run(frame: ImageBitmap) {
  const t0 = performance.now();
  const { det, rec, dict } = await load();
  const W = frame.width;
  const H = frame.height;

  // 1. Where is text?
  const scale = Math.min(1, DET_SIDE / Math.max(W, H));
  const dw = Math.max(32, Math.round((W * scale) / 32) * 32);
  const dh = Math.max(32, Math.round((H * scale) / 32) * 32);
  const detOut = await det.run({ [det.inputNames[0]]: toTensor(draw(frame, 0, 0, W, H, dw, dh), dw, dh, MEAN, STD) });
  const map = detOut[det.outputNames[0]].data as Float32Array;
  // Back to the frame's pixels (same scale on both axes, up to the rounding to 32).
  const k = W / dw;
  const boxes = boxesFromMap(map, dw, dh).map((b) => ({ x: b.x * k, y: (b.y * H) / dh, w: b.w * k, h: (b.h * H) / dh, angle: b.angle }));

  // 2. What does each line say?
  const lines: OcrLine[] = [];
  for (const b of boxes) {
    const rw = Math.max(REC_H, Math.min(2400, Math.round((REC_H * b.w) / b.h)));
    const input = toTensor(crop(frame, b, rw, REC_H), rw, REC_H, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
    const out = (await rec.run({ [rec.inputNames[0]]: input }))[rec.outputNames[0]];
    const [, T, C] = out.dims as number[];
    const { text, score } = ctcDecode(out.data as Float32Array, T, C, dict);
    if (text && score > 0.5) lines.push({ ...b, text, score });
  }
  frame.close();
  post({ type: 'lines', lines, ms: performance.now() - t0 });
}

self.onmessage = (e: MessageEvent<OcrRequest>) => {
  run(e.data.frame).catch((err: unknown) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
};
