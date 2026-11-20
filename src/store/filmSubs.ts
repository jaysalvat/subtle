/**
 * Subtitle tracks inside the open film (MKV / WebM): read when the video is loaded, offered then
 * (window when no subtitles are open, else a message), and from Tools › File. Reader: src/lib/mkv.ts.
 * A chosen track becomes an SRT file opened like a dropped one (offerSubtitleFile: add or replace).
 */
import { create } from 'zustand';
import { readMkvInfo, type MkvInfo, type MkvSubTrack } from '../lib/mkv';
import type { Cue } from '../lib/types';
import type { MkvSubsMessage, MkvSubsRequest } from '../workers/mkvSubs.worker';
import { isMkvFile } from '../lib/files';
import { langFromTrack } from '../lib/languages';
import { serializeSrt } from '../lib/formats';
import { t } from '../i18n';
import { useApp } from './store';

interface FilmSubs {
  file: File | null;
  info: MkvInfo | null;
  /** Reading a track: its progress (subtitles, or bytes when the file is walked). */
  reading: { done: number; total: number; startedAt: number } | null;
  /** Read: being opened in the app. */
  opening: boolean;
}

export const useFilmSubs = create<FilmSubs>(() => ({ file: null, info: null, reading: null, opening: false }));

const readAt = (file: File) => async (o: number, n: number) => new Uint8Array(await file.slice(o, o + n).arrayBuffer());

export async function scanFilmSubs(file: File) {
  stopFilmSubs();
  if (!isMkvFile(file)) return;
  let info: MkvInfo;
  try {
    info = await readMkvInfo(readAt(file), file.size);
  } catch {
    return; // not readable as Matroska: no tracks to offer
  }
  if (useApp.getState().video?.name !== file.name) return; // another video meanwhile
  useFilmSubs.setState({ file, info });
  const n = info.tracks.filter((tr) => tr.text).length;
  if (!n) return;
  warmWorker();
  const st = useApp.getState();
  if (!st.doc && !st.dialog) st.openDialog('filmSubs');
  else st.notify(t.filmSubs.found(n), { action: { label: t.filmSubs.choose, onClick: () => useApp.getState().openDialog('filmSubs') } });
}

export function stopFilmSubs() {
  dropWorker();
  useFilmSubs.setState({ file: null, info: null, reading: null });
}

/**
 * The reading worker, started as soon as the film shows text tracks: starting one takes a moment
 * (seconds in dev, its code is compiled then), which would otherwise follow the click on Open.
 */
let worker: Worker | null = null;
const warmWorker = () => (worker ??= new Worker(new URL('../workers/mkvSubs.worker.ts', import.meta.url), { type: 'module' }));
function dropWorker() {
  worker?.terminate();
  worker = null;
}

/** Reads a track in the worker, the page stays free. */
function readTrack(file: File, info: MkvInfo, track: MkvSubTrack, onProgress: (done: number, total: number) => void): Promise<Cue[]> {
  const w = warmWorker();
  return new Promise<Cue[]>((resolve, reject) => {
    w.onmessage = (e: MessageEvent<MkvSubsMessage>) => {
      const m = e.data;
      if (m.type === 'progress') return onProgress(m.done, m.total);
      if (m.type === 'done') resolve(m.cues);
      else reject(new Error(m.message));
    };
    w.onerror = (e) => {
      dropWorker();
      reject(new Error(e.message));
    };
    w.postMessage({ file, info, track } satisfies MkvSubsRequest);
  });
}

/** Reads a track and opens it like a .srt named after the film ("Film.fr.srt"). */
export async function openFilmTrack(track: MkvSubTrack) {
  const { file, info } = useFilmSubs.getState();
  if (!file || !info) return;
  const startedAt = Date.now();
  useFilmSubs.setState({ reading: { done: 0, total: 100, startedAt } });
  try {
    const cues = await readTrack(file, info, track, (done, total) => useFilmSubs.setState({ reading: { done, total, startedAt } }));
    if (!cues.length) return useApp.getState().notify(t.filmSubs.empty, { tone: 'warning' });
    const lang = langFromTrack(track.language);
    const name = `${file.name.replace(/\.[^.]+$/, '')}${lang ? `.${lang}` : ''}.srt`;
    // The window stays, at 100 % "Opening…", until the subtitles (or the Add window) are there:
    // drawing thousands of subtitles takes a moment. Let it paint first.
    useFilmSubs.setState({ reading: { done: 100, total: 100, startedAt }, opening: true });
    await new Promise((r) => setTimeout(r, 30));
    await useApp.getState().offerSubtitleFile(new File([serializeSrt(cues)], name, { type: 'application/x-subrip' }));
    if (useApp.getState().dialog === 'filmSubs') useApp.getState().openDialog(null);
  } catch (err) {
    useApp.getState().notify(t.filmSubs.failed(err instanceof Error ? err.message : String(err)), { tone: 'warning' });
  } finally {
    useFilmSubs.setState({ reading: null, opening: false });
  }
}
