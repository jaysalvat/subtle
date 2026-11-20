/**
 * Find text in the picture: pauses, reads the frame shown, runs OCR in a worker (model downloaded
 * once, ≈ 10 MB), then the player shows a box on each line found; picking lines creates a subtitle
 * at the playhead with their text.
 */
import { create } from 'zustand';
import { ocrText, type OcrLine } from '../lib/ocr';
import { insertCueAt } from '../lib/tools';
import { t } from '../i18n';
import { player, usePlayback } from './playback';
import { useApp } from './store';
import type { OcrMessage } from '../workers/ocr.worker';

interface OcrState {
  phase: 'idle' | 'reading' | 'picking';
  /** First time: model download, bytes. */
  download: { loaded: number; total: number } | null;
  lines: OcrLine[];
  /** Size of the frame read, to place the boxes. */
  size: { w: number; h: number } | null;
  /** Lines picked with ⇧-click, by index, in the order picked (= order in the subtitle). */
  picked: number[];
  /** The subtitle text proposed from the picked lines, editable before it's created. */
  draft: string;
}

export const useOcr = create<OcrState>(() => ({ phase: 'idle', download: null, lines: [], size: null, picked: [], draft: '' }));

let worker: Worker | null = null;

export async function findTextInPicture() {
  const v = player.el;
  if (!v || !v.videoWidth || useOcr.getState().phase === 'reading') return;
  v.pause();
  readAt = player.now();
  const frame = await createImageBitmap(v);
  const size = { w: frame.width, h: frame.height };
  useOcr.setState({ phase: 'reading', download: null, lines: [], size, picked: [], draft: '' });
  // Kept warm between uses: the models load once per session.
  worker ??= new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  w.onmessage = (e: MessageEvent<OcrMessage>) => {
    const m = e.data;
    if (m.type === 'download') useOcr.setState({ download: { loaded: m.loaded, total: m.total } });
    else if (m.type === 'lines') {
      if (!m.lines.length) {
        useOcr.setState({ phase: 'idle' });
        useApp.getState().notify(t.ocr.none);
      } else useOcr.setState({ phase: 'picking', lines: m.lines, download: null });
    } else {
      useOcr.setState({ phase: 'idle', download: null });
      useApp.getState().notify(t.ocr.error(m.message), { tone: 'warning' });
    }
  };
  w.postMessage({ frame }, [frame]);
}

// The boxes belong to the frame they were read on: moving away closes them.
let readAt = 0;
usePlayback.subscribe((s) => {
  if (useOcr.getState().phase !== 'idle' && Math.abs(s.time - readAt) > 20) closeOcr();
});

export function closeOcr() {
  useOcr.setState({ phase: 'idle', lines: [], picked: [], draft: '' });
}

/** ⇧-click: add a line (numbered in the order picked) or take it out; the proposed text follows. */
export function togglePicked(i: number) {
  const { picked, lines } = useOcr.getState();
  const next = picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i];
  useOcr.setState({ picked: next, draft: ocrText(next.map((k) => lines[k])) });
}

export function setDraft(draft: string) {
  useOcr.setState({ draft });
}

/** Click (nothing picked yet): a subtitle with this line at once. */
export function createFromLine(i: number) {
  createFromText(useOcr.getState().lines[i].text);
}

/** The subtitle at the playhead with this text. */
export function createFromText(text: string) {
  if (!text.trim()) return;
  const app = useApp.getState();
  const r = insertCueAt(app.doc?.cues ?? [], player.now(), app.settings, text.trim());
  closeOcr();
  if (!r) {
    app.notify(t.ocr.noRoom, { tone: 'warning' });
    return;
  }
  app.commit(r.cues, t.ocr.undo, [r.id]);
  app.notify(t.ocr.created, { undo: true, tone: 'success' });
}
