/**
 * Save straight into the subtitle file (Chrome's File System Access): opened with the file picker
 * or dropped, the file's handle is kept; ⌘S writes into it (asking Chrome's permission the first
 * time), Save as… for new subtitles, Export (⇧⌘S) still makes copies. Before overwriting, a file
 * changed elsewhere since it was read is noticed.
 */
import { t } from '../i18n';
import { encodeUtf8 } from '../lib/encoding';
import { defaultExportName } from '../lib/filename';
import { formatOfName, serialize } from '../lib/formats';
import { ask } from '../components/Confirm';
import { sameSource } from '../lib/translation';
import { useApp } from './store';

type PickerWindow = Window & {
  showOpenFilePicker?: (o: object) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle>;
};
type PermissionHandle = FileSystemFileHandle & {
  queryPermission?: (o: object) => Promise<PermissionState>;
  requestPermission?: (o: object) => Promise<PermissionState>;
};

/** Chrome / Edge: files can be written in place. Elsewhere, Export only. */
export const canSaveInPlace = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

const SUBTITLE_TYPES = [
  {
    description: 'Subtitles',
    accept: {
      'application/x-subrip': ['.srt'],
      'text/vtt': ['.vtt'],
      'text/x-ssa': ['.ass', '.ssa'],
      'text/plain': ['.sbv'],
      'application/ttml+xml': ['.ttml', '.dfxp'],
    },
  },
];

/**
 * Unsaved changes compared with the file: while translating, either language's file (the
 * original's counts once its text or times differ), else the subtitle file (none when there is no
 * file yet and nothing to save).
 */
export const isDirty = (s: ReturnType<typeof useApp.getState>) =>
  !!s.doc && (s.translation ? s.savedTargetCues !== s.doc.cues || !sameSource(s.savedCues, s.doc.cues) : s.savedCues !== s.doc.cues);

/** Open subtitles with the system picker, keeping the file's handle (falls back to `fallback`). */
export async function pickSubtitleFile(fallback: () => void) {
  const w = window as PickerWindow;
  if (!w.showOpenFilePicker) return fallback();
  try {
    const [handle] = await w.showOpenFilePicker({
      types: [...SUBTITLE_TYPES, { description: 'Zip', accept: { 'application/zip': ['.zip'] } }],
      multiple: false,
    });
    void useApp.getState().offerSubtitleFile(await handle.getFile(), handle);
  } catch {
    /* cancelled */
  }
}

const VIDEO_TYPES = [
  { description: 'Videos', accept: { 'video/mp4': ['.mp4', '.m4v'], 'video/quicktime': ['.mov'], 'video/x-matroska': ['.mkv'], 'video/webm': ['.webm'] } },
];

/** Open a video with the system picker, keeping the file's handle (falls back to `fallback`). */
export async function pickVideoFile(fallback: () => void) {
  const w = window as PickerWindow;
  if (!w.showOpenFilePicker) return fallback();
  try {
    const [handle] = await w.showOpenFilePicker({ types: VIDEO_TYPES, multiple: false });
    useApp.getState().loadVideoFile(await handle.getFile(), handle);
  } catch {
    /* cancelled */
  }
}

/**
 * After a reload: the project's video again, from its kept file (Chrome asks to allow reading it
 * once; that needs this click). Moved or deleted: say so, the picker opens.
 */
export async function reopenVideo(fallback: () => void) {
  const st = useApp.getState();
  const handle = st.videoHandle as PermissionHandle | null;
  if (!handle) return pickVideoFile(fallback);
  try {
    const ok =
      !handle.queryPermission ||
      (await handle.queryPermission({ mode: 'read' })) === 'granted' ||
      (await handle.requestPermission?.({ mode: 'read' })) === 'granted';
    if (!ok) return;
    st.loadVideoFile(await handle.getFile(), handle);
  } catch {
    st.notify(t.files.videoGone(handle.name), { tone: 'warning' });
    useApp.setState({ videoHandle: null });
    void pickVideoFile(fallback);
  }
}

/** Handles of dropped files, read during the drop event (they can't be asked for later). */
export function droppedHandles(e: { dataTransfer: DataTransfer | null }): Promise<(FileSystemFileHandle | null)[]> {
  const items = Array.from(e.dataTransfer?.items ?? []).filter((it) => it.kind === 'file');
  return Promise.all(
    items.map((it) => {
      const get = (it as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle;
      return get
        ? get.call(it).then(
            (h) => (h?.kind === 'file' ? (h as FileSystemFileHandle) : null),
            () => null,
          )
        : Promise.resolve(null);
    }),
  );
}

async function allowed(handle: PermissionHandle): Promise<boolean> {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await handle.requestPermission?.({ mode: 'readwrite' })) === 'granted';
}

type Which = 'source' | 'target';

/** Name of a file just converted to UTF-8 by a save, for the message. */
let converted: string | null = null;

/** Write the original or the translation into a file; returns its name. */
async function write(handle: FileSystemFileHandle, which: Which): Promise<string> {
  const st = useApp.getState();
  const doc = st.doc!;
  const target = which === 'target';
  const text = serialize(doc, formatOfName(handle.name), target, target ? st.translation?.targetLang : doc.lang);
  const out = await handle.createWritable();
  await out.write(encodeUtf8(text, st.settings.exportBom));
  await out.close();
  const modified = (await handle.getFile()).lastModified;
  // A file read in an older encoding is now UTF-8: said once, when it's written.
  if (!target && st.encoding && st.encoding !== 'utf-8' && st.savedCues !== null) converted = handle.name;
  if (target) useApp.setState({ targetHandle: handle, targetModified: modified, savedTargetCues: doc.cues });
  else useApp.setState({ fileHandle: handle, subtitleName: handle.name, fileModified: modified, savedCues: doc.cues, encoding: 'utf-8' });
  return handle.name;
}

/** Into a known file: permission, and a file changed elsewhere is noticed first. False: not written. */
async function writeInto(handle: PermissionHandle, modified: number | null, which: Which): Promise<string | null> {
  const st = useApp.getState();
  if (!(await allowed(handle))) {
    st.notify(t.save.denied, { tone: 'warning' });
    return null;
  }
  const onDisk = await handle.getFile();
  if (modified !== null && onDisk.lastModified !== modified) {
    const ok = await ask({ ...t.save.changedOnDisk(handle.name), danger: true });
    if (!ok) return null;
  }
  return write(handle, which);
}

/** Pick a new file (suggested name, next to the original, or the translation, when there is one). */
async function pickAndWrite(which: Which): Promise<string | null> {
  const st = useApp.getState();
  const w = window as PickerWindow;
  if (!st.doc || !w.showSaveFilePicker) return null;
  const lang = which === 'target' ? st.translation?.targetLang : st.doc.lang;
  const suggested =
    which === 'source' && st.subtitleName
      ? st.subtitleName
      : defaultExportName({ video: st.video?.name ?? st.expectedVideo?.name ?? null, subtitles: st.subtitleName, lang: lang ?? null }) + '.' + st.doc.format;
  try {
    const handle = await w.showSaveFilePicker({
      suggestedName: suggested,
      types: SUBTITLE_TYPES,
      ...(st.fileHandle || st.targetHandle ? { startIn: st.fileHandle ?? st.targetHandle } : {}),
    });
    return await write(handle, which);
  } catch {
    return null; // cancelled
  }
}

/**
 * ⌘S: into the file it came from; Save as… when there's none; Export where saving in place isn't
 * possible. While translating: the translation into its own file (my-film.fr.srt, asked for the
 * first time), and the original into its file too when it changed (times are shared).
 */
export async function saveFile() {
  const st = useApp.getState();
  if (!st.doc) return;
  if (!canSaveInPlace) return st.openDialog('export');
  if (st.translation) return saveTranslation();
  const handle = st.fileHandle as PermissionHandle | null;
  if (!handle) return saveFileAs();
  try {
    const name = await writeInto(handle, st.fileModified, 'source');
    if (name) notifySaved([name]);
  } catch (e) {
    // Moved, deleted, or on a disk that's gone: offer a new place.
    st.notify(t.save.failed(e instanceof Error ? e.message : String(e)), { tone: 'warning' });
    await saveFileAs();
  }
}

async function saveTranslation() {
  const st = useApp.getState();
  const names: string[] = [];
  const handle = st.targetHandle as PermissionHandle | null;
  const needOriginal = !!st.doc && !sameSource(st.savedCues, st.doc.cues);
  // After a reload Chrome asks to allow each file, and only while the key press still counts: both
  // asked at once, before anything is written (asked one after the other, the second was refused).
  await Promise.allSettled(
    [handle, needOriginal ? (st.fileHandle as PermissionHandle | null) : null].map((h) => h?.requestPermission?.({ mode: 'readwrite' })),
  );
  let name: string | null = null;
  try {
    name = handle ? await writeInto(handle, st.targetModified, 'target') : await pickAndWrite('target');
  } catch (e) {
    st.notify(t.save.failed(e instanceof Error ? e.message : String(e)), { tone: 'warning' });
    name = await pickAndWrite('target');
  }
  if (!name) return;
  names.push(name);
  // The original too, when its times or text changed since it was written (or it was never saved:
  // subtitles from the audio, translated straight away): into its file, or a new one picked now.
  const now = useApp.getState();
  let originalLeft = false;
  if (now.doc && !sameSource(now.savedCues, now.doc.cues)) {
    let src: string | null = null;
    try {
      const h = now.fileHandle as PermissionHandle | null;
      if (!h) src = await pickAndWrite('source');
      else if (!h.queryPermission || (await h.queryPermission({ mode: 'readwrite' })) === 'granted') src = await writeInto(h, now.fileModified, 'source');
    } catch {
      /* refused or not allowed now: offered below */
    }
    if (src) names.push(src);
    else originalLeft = true;
  }
  notifySaved(names);
  // Chrome wouldn't ask again in the same key press (or the picker was closed): one click finishes it.
  if (originalLeft) {
    const n = useApp.getState().fileHandle?.name ?? null;
    st.notify(t.save.originalLeft(n), { tone: 'warning', stay: true, action: { label: t.save.saveOriginalNow, onClick: () => void saveOriginal() } });
  }
}

/** "Saved:" and each file on its own line. */
function notifySaved(names: string[]) {
  const st = useApp.getState();
  const files = names.map((n) => t.save.fileLine(n)).join('\n');
  st.notify(t.save.savedTitle, { tone: 'success', description: converted ? `${files}\n${t.save.nowUtf8(converted)}` : files });
  converted = null;
}

/** Write the original into its file (asking where when it has none). Its name, or null if not written. */
export async function saveOriginal(): Promise<string | null> {
  const st = useApp.getState();
  if (!st.doc) return null;
  try {
    const name = st.fileHandle ? await writeInto(st.fileHandle as PermissionHandle, st.fileModified, 'source') : await pickAndWrite('source');
    if (name) notifySaved([name]);
    return name;
  } catch (e) {
    st.notify(t.save.failed(e instanceof Error ? e.message : String(e)), { tone: 'warning' });
    const name = await pickAndWrite('source');
    if (name) notifySaved([name]);
    return name;
  }
}

/** Save as…: pick a file (new subtitles, or a new place); it becomes the file ⌘S writes into. */
async function saveFileAs() {
  const st = useApp.getState();
  if (!st.doc || !(window as PickerWindow).showSaveFilePicker) return st.openDialog('export');
  const name = await pickAndWrite(st.translation ? 'target' : 'source');
  if (name) notifySaved([name]);
}

/** A file given to the browser to save (Downloads): exports, project files. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
