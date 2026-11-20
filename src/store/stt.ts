/**
 * Create subtitles from the audio (Whisper in a worker). Two phases: the model loads (downloaded
 * the first time) while the Create subtitles window shows its progress; then the transcription runs
 * in the background, subtitles appearing in the list as they come, every edit refused until it ends
 * or is stopped (`creatingSubs` in the app store). One undo step at the end.
 */
import { create } from 'zustand';
import { playSound } from './sounds';
import {
  STT_MODELS,
  placeWords,
  startOnSpeech,
  sttWindows,
  wordsToCues,
  type SttModelId,
  type Word,
  keepClear,
  mainLanguage,
  uncoveredWindows,
} from '../lib/stt';
import type { Cue } from '../lib/types';
import { isLangCode } from '../lib/languages';
import { t } from '../i18n';
import { useApp } from './store';
import { usePlayback } from './playback';
import { useWaveform } from './waveform';
import type { SttMessage, SttRequest } from '../workers/stt.worker';

type Phase = 'idle' | 'loading' | 'running';

interface SttState {
  phase: Phase;
  /** Model download, bytes (total 0 while unknown). */
  download: { loaded: number; total: number } | null;
  /** Speech transcribed so far / in all, ms of audio. */
  doneMs: number;
  totalMs: number;
  /** When transcription started (after the model loaded), for the time estimate. */
  startedAt: number;
  error: string | null;
}

export const useStt = create<SttState>(() => ({ phase: 'idle', download: null, doneMs: 0, totalMs: 0, startedAt: 0, error: null }));

let worker: Worker | null = null;
/** After a run that finished, the worker stays with its model loaded, ready for the next run. */
let warm: { w: Worker; model: SttModelId } | null = null;
let runModel: SttModelId = 'fast';
let base: Cue[] = [];
let words: Word[] = [];
let shown: Cue[] = [];
/** Detecting: how long each language was heard (ms); the main one names the subtitles. */
let heard: Map<string, number> | null = null;

/** Is this model already downloaded? (transformers.js keeps files in Cache Storage "transformers-cache".) */
export async function isModelCached(id: SttModelId): Promise<boolean> {
  if (typeof caches === 'undefined' || !(await caches.has('transformers-cache'))) return false;
  const cache = await caches.open('transformers-cache');
  const keys = await cache.keys();
  const { repo, revision } = STT_MODELS[id];
  return keys.some((r) => r.url.includes(`${repo}/resolve/${revision}/`) && /\.onnx/.test(r.url));
}

/** Room left for the browser's storage, in bytes (null when the browser doesn't say). */
export async function spaceLeft(): Promise<number | null> {
  const e = await navigator.storage?.estimate?.().catch(() => null);
  return e?.quota != null && e.usage != null ? e.quota - e.usage : null;
}

/** The open video as a File again (the store keeps its object URL). */
async function videoFile(): Promise<File | null> {
  const { videoUrl, video } = useApp.getState();
  if (!videoUrl || !video) return null;
  const blob = await fetch(videoUrl).then((r) => r.blob());
  return new File([blob], video.name, { type: blob.type });
}

export async function startStt(model: SttModelId, language: string) {
  stopWorker();
  const file = await videoFile();
  if (!file) return;
  const durationMs = usePlayback.getState().duration || useApp.getState().video?.durationMs || 0;
  // Subtitles already there (an earlier run, a file with gaps): only what's missing is transcribed.
  const windows = uncoveredWindows(sttWindows(useWaveform.getState().dialogue?.spans ?? null, durationMs), useApp.getState().doc?.cues ?? []);
  if (!windows.length) {
    useStt.setState({ phase: 'idle', error: t.stt.nothingLeft });
    return;
  }
  useStt.setState({ phase: 'loading', download: null, doneMs: 0, totalMs: 0, startedAt: 0, error: null });
  // Same model as the last finished run: its worker still has it loaded.
  const reuse = warm?.model === model ? warm.w : null;
  if (!reuse) warm?.w.terminate();
  warm = null;
  runModel = model;
  const w = reuse ?? new Worker(new URL('../workers/stt.worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  w.onmessage = (e: MessageEvent<SttMessage>) => {
    if (worker !== w) return;
    const m = e.data;
    if (m.type === 'download') useStt.setState({ download: { loaded: m.loaded, total: m.total } });
    else if (m.type === 'ready') begin(language);
    else if (m.type === 'words') {
      // Whisper's misplaced sentences put back where they were said (lib/stt placeWords).
      words.push(...placeWords(m.words, m.window, useWaveform.getState().dialogue?.spans ?? null));
      if (heard && m.lang && m.words.length) heard.set(m.lang, (heard.get(m.lang) ?? 0) + m.window[1] - m.window[0]);
      useStt.setState({ doneMs: m.doneMs, totalMs: m.totalMs });
      show();
    } else if (m.type === 'done') finish(false);
    else fail(m.message);
  };
  w.onerror = (e) => worker === w && fail(e.message || t.stt.failed);
  w.postMessage({
    file,
    model: STT_MODELS[model].repo,
    revision: STT_MODELS[model].revision,
    gpuDtype: STT_MODELS[model].gpu,
    language,
    windows,
  } satisfies SttRequest);
}

/** Model ready: the window closes, subtitles start coming in. */
function begin(language: string) {
  const app = useApp.getState();
  const doc = app.doc ?? { format: 'srt' as const, cues: [] };
  base = doc.cues;
  words = [];
  shown = [];
  // "Detect" on subtitles without a language: the language heard most names them (export, translation).
  heard = !language && !doc.lang ? new Map() : null;
  useApp.setState({ doc: { ...doc, lang: doc.lang ?? (language || undefined) }, creatingSubs: true, dialog: null, selection: [] });
  useStt.setState({ phase: 'running', startedAt: Date.now() });
}

function show() {
  const { doc, settings } = useApp.getState();
  if (!doc) return;
  // Same start → same subtitle as last time: keep its id, so the list doesn't redraw every row.
  const prev = new Map(shown.map((c) => [c.start, c.id]));
  const spans = useWaveform.getState().dialogue?.spans ?? null;
  shown = keepClear(startOnSpeech(wordsToCues(words, settings), spans, settings.minGapMs), base, settings.minGapMs).map((c) => ({
    ...c,
    id: prev.get(c.start) ?? c.id,
  }));
  const lang = heard ? mainLanguage(heard) : null;
  useApp.setState({ doc: { ...doc, ...(lang && isLangCode(lang) ? { lang } : {}), cues: [...base, ...shown].sort((a, b) => a.start - b.start) } });
}

function finish(stopped: boolean) {
  // Finished: keep the worker and its model for next time. Stopped mid-way: it's still working, end it.
  if (!stopped && worker) {
    warm = { w: worker, model: runModel };
    worker.onmessage = null;
    worker = null;
  } else stopWorker();
  const running = useStt.getState().phase === 'running';
  useStt.setState({ phase: 'idle', download: null });
  if (!running) return;
  useApp.setState({ creatingSubs: false });
  const app = useApp.getState();
  const n = (app.doc?.cues.length ?? 0) - base.length;
  app.endGesture(base, t.stt.undo(n));
  if (n && !stopped) playSound('done');
  if (n) app.notify(stopped ? t.stt.stopped(n) : t.stt.done(n), { undo: true, tone: stopped ? undefined : 'success' });
  else app.notify(t.stt.none, { tone: 'warning' });
}

function fail(message: string) {
  const running = useStt.getState().phase === 'running';
  if (running) {
    finish(true);
    useApp.getState().notify(t.stt.error(message), { tone: 'warning' });
  } else {
    stopWorker();
    useStt.setState({ phase: 'idle', download: null, error: message });
  }
}

/** Stop: while loading, cancel; while transcribing, keep what's done. */
export function stopStt() {
  if (useStt.getState().phase === 'running') finish(true);
  else {
    stopWorker();
    useStt.setState({ phase: 'idle', download: null });
  }
}

function stopWorker() {
  worker?.terminate();
  worker = null;
}

// Another video, or the project closed: the run is for the old one.
useApp.subscribe((s, prev) => {
  if (s.videoUrl !== prev.videoUrl && useStt.getState().phase !== 'idle') stopStt();
});

// Leaving or reloading the page stops the transcription: ask first.
window.addEventListener('beforeunload', (e) => {
  if (useStt.getState().phase === 'idle') return;
  e.preventDefault();
  e.returnValue = '';
});
