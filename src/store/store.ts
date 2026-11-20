import { create } from 'zustand';
import { toast } from 'sonner';
import { decodeSubtitleBytes, encodeUtf8, type TextEncodingName } from '../lib/encoding';
import { parseSubtitles, serialize } from '../lib/formats';
import { assLosses, type AssLosses } from '../lib/formatsMore';
import { sortCues } from '../lib/tools';
import { usePlayback } from './playback';
import { analyseWaveform, stopWaveform, useWaveform } from './waveform';
import { extractThumbs, stopThumbs, useThumbs } from './thumbs';
import { scanFilmSubs, stopFilmSubs } from './filmSubs';
import { canDecode } from './support';
import { startFrames, stopFrames } from './frames';
import { FEATURES } from '../features';
import { DEFAULT_SETTINGS, newId, type Bookmark, type Cue, type Settings, type SubtitleDoc, type SubtitleFormat } from '../lib/types';
import { defaultLabel, nextSlot, bookmarkNear } from '../lib/bookmarks';
import { noteNear, type SceneNote } from '../lib/sceneNotes';
import { adoptTranslation, sideField, type EditSide } from '../lib/translation';
import { mergeCues, prepareIncoming, type MergeOptions } from '../lib/merge';
import { langFromFileName } from '../lib/languages';
import { isVideoFile, isZipFile } from '../lib/files';
import { playSound } from './sounds';
import { sameVideo, videoFingerprint } from '../lib/fingerprint';
import { t } from '../i18n';

export type DialogName =
  | null
  | 'settings'
  | 'shift'
  | 'sync'
  | 'minDuration'
  | 'sign'
  | 'align'
  | 'syncRef'
  | 'zipSubs'
  | 'hi'
  | 'punctuation'
  | 'replace'
  | 'stt'
  | 'quality'
  | 'translate'
  | 'export'
  | 'shortcuts'
  | 'fps'
  | 'syncAssistant'
  | 'addSubs'
  | 'review'
  | 'filmSubs'
  | 'support'
  | 'retranslate'
  | 'checkTranslation';
/** Side panels that keep the video and keyboard shortcuts usable. */
export const NON_MODAL: DialogName[] = [
  'fps',
  'syncAssistant',
  'quality',
  'review',
  'checkTranslation',
  'shift',
  'sync',
  'minDuration',
  'sign',
  'align',
  'syncRef',
  'replace',
  'hi',
  'punctuation',
];

export interface VideoInfo {
  name: string;
  size: number;
  durationMs: number;
  /** Fingerprint (lib/fingerprint): the same film even renamed. Set a moment after opening. */
  fp?: string;
}

/** One undo step: the cues, plus translation mode and language so translate actions undo fully. */
interface Snapshot {
  cues: Cue[];
  label: string;
  translation: Translation | null;
  lang?: string;
}

interface Translation {
  targetLang: string;
  /** Language translated from (for automatic translation). */
  sourceLang?: string;
}

export interface AppState {
  doc: SubtitleDoc | null;
  subtitleName: string | null;
  encoding: TextEncodingName | null;
  /** The subtitle file on disk (Chrome), to save straight into it (src/store/file.ts). */
  fileHandle: FileSystemFileHandle | null;
  /** Its last-modified time when read or written: a change made elsewhere is noticed before overwriting. */
  fileModified: number | null;
  /** The cues as last written to (or read from) the file: different = unsaved changes. */
  savedCues: Cue[] | null;
  /** While translating: the translation's own file (my-film.fr.srt), its time, the cues last written to it. */
  targetHandle: FileSystemFileHandle | null;
  targetModified: number | null;
  savedTargetCues: Cue[] | null;
  translation: Translation | null;
  /** What the player shows in translation mode. */
  display: 'source' | 'target' | 'both';
  /** While translating: the language edited (list, tools, checks); the player follows it. */
  editSide: EditSide;
  setEditSide: (side: EditSide) => void;

  videoUrl: string | null;
  video: VideoInfo | null;
  /** Video of a restored project, waiting to be dropped again. */
  expectedVideo: VideoInfo | null;
  /** The video file on disk (Chrome), kept with the project: after a reload, Reopen in one click. */
  videoHandle: FileSystemFileHandle | null;

  selection: string[];
  past: Snapshot[];
  future: Snapshot[];

  settings: Settings;
  dialog: DialogName;
  /** Automatic translation running (which kind), so the window can lock what shouldn't change meanwhile. */
  autoTranslating: 'remaining' | 'all' | null;
  /** Subtitles are being created from the audio (src/store/stt.ts): every edit is refused meanwhile. */
  creatingSubs: boolean;
  setAutoTranslating: (v: 'remaining' | 'all' | null) => void;
  restored: boolean;

  loadSubtitleFile: (file: File, handle?: FileSystemFileHandle | null) => Promise<void>;
  loadVideoFile: (file: File, handle?: FileSystemFileHandle | null) => void;
  setVideoDuration: (ms: number) => void;
  closeProject: () => void;

  /** Replace cues and push an undo entry. */
  commit: (cues: Cue[], label: string, selection?: string[]) => void;
  /** Replace cues without history (live drag preview). Back to `previewBase`: the preview is over. */
  replaceLive: (cues: Cue[]) => void;
  /**
   * A tool's live preview (Shift times, Sync by ear, Convert frame rate): shows `cues`, but the
   * project keeps saving `base` until it's applied (endGesture) or cancelled (replaceLive(base)) —
   * a reload in between doesn't keep what was never applied.
   */
  previewLive: (base: Cue[], cues: Cue[]) => void;
  /** The cues a running preview started from (saved instead of the previewed ones), else null. */
  previewBase: Cue[] | null;
  /** Finish a live gesture: push `base` as the undo entry if something changed. */
  endGesture: (base: Cue[], label: string) => void;
  undo: () => void;
  redo: () => void;

  updateCue: (id: string, patch: Partial<Cue>, label?: string) => void;
  select: (id: string | null, mode?: 'replace' | 'toggle' | 'range') => void;
  setSelection: (ids: string[]) => void;

  /** `prefill`: the original copied, or each subtitle's translation by id (a translation file, matchTranslation). */
  enableTranslation: (targetLang: string, prefill: boolean | Map<string, string>, sourceLang?: string) => void;
  setTranslationSource: (sourceLang: string) => void;
  /** Change the translation's language code (a label: the translated text is kept). */
  setTranslationLang: (targetLang: string) => void;
  /** Discard the translation: translations deleted, back to the source (one undo step). */
  disableTranslation: () => void;
  /** Keep only the translation ("Keep only French"): it replaces the source text, translation mode ends (one undo step). */
  useTranslation: () => void;
  setDisplay: (d: AppState['display']) => void;

  setSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
  openDialog: (d: DialogName) => void;
  /** Message at the bottom of the screen. `undo` adds an Undo button; `tone` colours it. */
  /** `stay`: no auto-close, for a message with something left to do (closed with its ×). */
  notify: (
    text: string,
    opts?: {
      undo?: boolean;
      tone?: 'success' | 'warning';
      stay?: boolean;
      /** A button doing something else than Undo. */ action?: { label: string; onClick: () => void };
      /** Under the title (its line breaks kept). */ description?: string;
    },
  ) => void;

  /** A subtitle file dropped while subtitles are open: add it to them, or replace them. */
  /** `lost`: an ASS file's styles, colours… that won't be kept (said in the window, and after Replace). */
  pendingSubs: { name: string; doc: SubtitleDoc; handle?: FileSystemFileHandle | null; modified?: number; lost?: string } | null;
  /** Open a subtitle file: loads it, or (if subtitles are open) asks to add or replace. */
  offerSubtitleFile: (file: File, handle?: FileSystemFileHandle | null) => Promise<void>;
  /** Add the pending file's subtitles to the current ones (one undo step); they stay selected. */
  addPendingSubs: (opts: Omit<MergeOptions, 'format'>) => void;
  replaceWithPendingSubs: () => void;

  /** Markers in the film, saved with the project (not exported in subtitle files). */
  bookmarks: Bookmark[];
  /** The project's own name, when renamed (else it's named after the film). */
  projectName: string | null;
  /** The project's picture (a frame of its film, JPEG data URL), and whether it was chosen (else taken at 10 %). */
  projectPicture: string | null;
  pictureChosen: boolean;
  /** Scene notes for the AI translation (lib/sceneNotes), saved with the project. */
  sceneNotes: SceneNote[];
  /** A note at this moment (the one already there, if any). */
  addSceneNote: (time: number) => SceneNote;
  setSceneNote: (id: string, patch: Partial<Pick<SceneNote, 'time' | 'text'>>) => void;
  removeSceneNote: (id: string) => void;
  addBookmark: (time: number) => Bookmark;
  renameBookmark: (id: string, label: string) => void;
  removeBookmark: (id: string) => void;
  setBookmarkImage: (id: string, image: string) => void;

  /** `fileName` is the full name, extension included (see lib/filename). */
  exportFile: (format: SubtitleFormat, which: 'source' | 'target', fileName: string) => void;
}

const SETTINGS_KEY = 'subtle.settings';
// Projects (IndexedDB) are kept by src/store/projects.ts.
// Key used before the rename to Subtle, read once so saved settings are not lost.
const LEGACY_SETTINGS_KEY = 'subtitlizer.settings';
const HISTORY_LIMIT = 200;

/** "2 more styles, colours on 120 lines, …", or '' when the file holds nothing Subtle drops. */
function assLossText(l: AssLosses): string {
  const p = t.formats.assParts;
  const parts = [
    l.styles && p.styles(l.styles),
    l.colours && p.colours(l.colours),
    l.karaoke && p.karaoke(l.karaoke),
    l.positions && p.positions(l.positions),
    l.effects && p.effects(l.effects),
    l.drawings && p.drawings(l.drawings),
    l.comments && p.comments(l.comments),
    l.attachments && p.attachments,
  ].filter(Boolean);
  return parts.join(', ');
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<Settings>;
    // Local servers used to be an AI provider; they're their own engine now.
    if ((saved.aiProvider as string) === 'local') {
      saved.aiProvider = 'anthropic';
      if (saved.translationEngine === 'ai') saved.translationEngine = 'local';
    }
    // Per-provider maps: keep defaults for providers added since.
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      aiKeys: { ...DEFAULT_SETTINGS.aiKeys, ...saved.aiKeys },
      aiModels: { ...DEFAULT_SETTINGS.aiModels, ...saved.aiModels },
      signatures: Array.isArray(saved.signatures) ? saved.signatures : [],
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings stay in memory */
  }
}

export const useApp = create<AppState>((set, get) => ({
  doc: null,
  subtitleName: null,
  encoding: null,
  fileHandle: null,
  fileModified: null,
  savedCues: null,
  targetHandle: null,
  targetModified: null,
  savedTargetCues: null,
  translation: null,
  display: 'target',
  editSide: 'target',
  setEditSide: (side) => set((s) => ({ editSide: side, display: s.display === 'both' ? 'both' : side })),
  videoUrl: null,
  video: null,
  expectedVideo: null,
  videoHandle: null,
  selection: [],
  past: [],
  future: [],
  previewBase: null,
  settings: loadSettings(),
  dialog: null,
  autoTranslating: null,
  creatingSubs: false,
  setAutoTranslating: (v) => set({ autoTranslating: v }),
  restored: false,
  bookmarks: [],
  sceneNotes: [],
  projectName: null,
  projectPicture: null,
  pictureChosen: false,
  pendingSubs: null,

  async offerSubtitleFile(file, handle) {
    if (isZipFile(file)) return (await import('./zipSubs')).openZip(file);
    if (!get().doc) return get().loadSubtitleFile(file, handle);
    const { text } = decodeSubtitleBytes(await file.arrayBuffer());
    const doc = parseSubtitles(file.name, text);
    if (!doc.cues.length) return get().notify(t.files.noSubsIn(file.name), { tone: 'warning' });
    const lost = doc.format === 'ass' ? assLossText(assLosses(text)) : '';
    set({ pendingSubs: { name: file.name, doc, handle, modified: file.lastModified, lost }, dialog: 'addSubs' });
  },

  addPendingSubs(opts) {
    const { doc, pendingSubs } = get();
    if (!doc || !pendingSubs) return;
    const added = prepareIncoming(pendingSubs.doc.cues, { ...opts, format: doc.format });
    get().commit(
      mergeCues(doc.cues, added),
      t.merge.undo(pendingSubs.name),
      added.map((c) => c.id),
    );
    set({ pendingSubs: null, dialog: null });
    get().notify(t.merge.done(added.length), { undo: true, tone: 'success' });
  },

  replaceWithPendingSubs() {
    const { pendingSubs } = get();
    if (!pendingSubs) return;
    const doc = { ...pendingSubs.doc, lang: langFromFileName(pendingSubs.name) ?? undefined };
    set({
      doc,
      subtitleName: pendingSubs.name,
      translation: null,
      selection: [],
      past: [],
      future: [],
      pendingSubs: null,
      dialog: null,
      fileHandle: pendingSubs.handle ?? null,
      fileModified: pendingSubs.modified ?? null,
      savedCues: doc.cues,
      targetHandle: null,
      targetModified: null,
      savedTargetCues: null,
    });
    get().notify(t.files.loaded(doc.cues.length));
    if (pendingSubs.lost) get().notify(t.formats.assLost(pendingSubs.lost), { tone: 'warning', stay: true });
  },

  addBookmark(time) {
    const { bookmarks, doc } = get();
    const near = bookmarkNear(bookmarks, time);
    if (near) return near;
    const slot = nextSlot(bookmarks);
    const b: Bookmark = { id: newId(), slot, time: Math.round(time), label: defaultLabel(doc?.cues ?? [], time, slot) };
    set({ bookmarks: [...bookmarks, b] });
    return b;
  },
  renameBookmark(id, label) {
    set({ bookmarks: get().bookmarks.map((b) => (b.id === id ? { ...b, label } : b)) });
  },
  setBookmarkImage(id, image) {
    set({ bookmarks: get().bookmarks.map((b) => (b.id === id ? { ...b, image } : b)) });
  },
  addSceneNote(time) {
    const { sceneNotes } = get();
    const near = noteNear(sceneNotes, time);
    if (near) return near;
    const n: SceneNote = { id: newId(), time: Math.max(0, Math.round(time)), text: '' };
    set({ sceneNotes: [...sceneNotes, n] });
    return n;
  },
  setSceneNote(id, patch) {
    set({
      sceneNotes: get().sceneNotes.map((n) =>
        n.id === id ? { ...n, ...patch, ...(patch.time !== undefined ? { time: Math.max(0, Math.round(patch.time)) } : {}) } : n,
      ),
    });
  },
  removeSceneNote(id) {
    set({ sceneNotes: get().sceneNotes.filter((n) => n.id !== id) });
  },
  removeBookmark(id) {
    set({ bookmarks: get().bookmarks.filter((b) => b.id !== id) });
  },

  async loadSubtitleFile(file, handle = null) {
    if (isZipFile(file)) return (await import('./zipSubs')).openZip(file);
    const buf = await file.arrayBuffer();
    const { text, encoding } = decodeSubtitleBytes(buf);
    const doc = { ...parseSubtitles(file.name, text), lang: langFromFileName(file.name) ?? undefined };
    if (doc.cues.length === 0) {
      get().notify(t.files.noSubsIn(file.name), { tone: 'warning' });
      return;
    }
    set({
      doc,
      subtitleName: file.name,
      encoding,
      translation: null,
      selection: [],
      past: [],
      future: [],
      fileHandle: handle,
      fileModified: file.lastModified,
      savedCues: doc.cues,
      targetHandle: null,
      targetModified: null,
      savedTargetCues: null,
    });
    get().notify(t.files.loadedWith(doc.cues.length, encoding));
    // Styled formats are read simply: say what isn't kept (ASS: what this file holds, until closed).
    if (doc.format === 'ttml') get().notify(t.formats.opened('TTML'));
    if (doc.format === 'ass') {
      const what = assLossText(assLosses(text));
      if (what) get().notify(t.formats.assLost(what), { tone: 'warning', stay: true });
    }
  },

  loadVideoFile(file, handle = null) {
    if (!isVideoFile(file)) {
      get().notify(t.files.notVideo(file.name), { tone: 'warning' });
      return;
    }
    const prev = get().videoUrl;
    if (prev) URL.revokeObjectURL(prev);
    const expected = get().expectedVideo;
    set({ videoUrl: URL.createObjectURL(file), video: { name: file.name, size: file.size, durationMs: 0 }, expectedVideo: null, videoHandle: handle });
    // Its fingerprint, a moment later (3 MB read): the project's video or another one?
    void videoFingerprint(file).then((fp) => {
      const v = get().video;
      if (!v || v.name !== file.name || v.size !== file.size) return; // another video meanwhile
      set({ video: { ...v, fp } });
      if (expected && !sameVideo({ ...expected }, { name: file.name, size: file.size, fp })) {
        get().notify(t.files.madeWith(expected.name), { tone: 'warning' });
      }
    });
    // Without video and audio decoders (some Firefox / Safari versions): the film plays, nothing is read.
    if (canDecode()) {
      void analyseWaveform(file);
      extractThumbs(file);
      startFrames(file);
    } else {
      useWaveform.setState({ status: 'unavailable', waveform: null, dialogue: null });
      useThumbs.setState({ status: 'unavailable' });
    }
    void scanFilmSubs(file);
  },

  setVideoDuration(ms) {
    const v = get().video;
    if (v) set({ video: { ...v, durationMs: ms } });
  },

  closeProject() {
    const prev = get().videoUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      doc: null,
      subtitleName: null,
      encoding: null,
      fileHandle: null,
      fileModified: null,
      savedCues: null,
      targetHandle: null,
      targetModified: null,
      savedTargetCues: null,
      translation: null,
      videoUrl: null,
      video: null,
      expectedVideo: null,
      videoHandle: null,
      selection: [],
      past: [],
      future: [],
      bookmarks: [],
      sceneNotes: [],
      projectName: null,
      projectPicture: null,
      pictureChosen: false,
    });
    usePlayback.setState({ time: 0, duration: 0, playing: false, followPaused: false });
    stopWaveform();
    stopThumbs();
    stopFilmSubs();
    stopFrames();
  },

  commit(cues, label, selection) {
    if (refuseWhileCreating()) return;
    const { past, translation } = get();
    // A video alone: the first subtitle inserted (timeline, I key) starts new subtitles.
    const doc = get().doc ?? (get().videoUrl ? { format: 'srt' as const, cues: [] } : null);
    if (!doc) return;
    set({
      doc: { ...doc, cues: sortCues(cues) },
      past: [...past, { cues: doc.cues, label, translation, lang: doc.lang }].slice(-HISTORY_LIMIT),
      future: [],
      ...(selection ? { selection } : {}),
    });
  },

  replaceLive(cues) {
    if (refuseWhileCreating()) return;
    const { doc, previewBase } = get();
    if (doc) set({ doc: { ...doc, cues }, ...(cues === previewBase ? { previewBase: null } : {}) });
  },

  previewLive(base, cues) {
    if (refuseWhileCreating()) return;
    const { doc, previewBase } = get();
    if (doc) set({ doc: { ...doc, cues }, previewBase: previewBase ?? base });
  },

  endGesture(base, label) {
    set({ previewBase: null });
    const { doc, past } = get();
    if (!doc || doc.cues === base) return;
    const same = base.length === doc.cues.length && base.every((c, i) => c === doc.cues[i]);
    if (same) return;
    set({
      doc: { ...doc, cues: sortCues(doc.cues) },
      past: [...past, { cues: base, label, translation: get().translation, lang: doc.lang }].slice(-HISTORY_LIMIT),
      future: [],
    });
  },

  undo() {
    if (refuseWhileCreating()) return;
    const { doc, past, future, translation } = get();
    if (!doc || past.length === 0) return;
    const last = past[past.length - 1];
    set({
      doc: { ...doc, cues: last.cues, lang: last.lang },
      translation: last.translation,
      past: past.slice(0, -1),
      future: [{ cues: doc.cues, label: last.label, translation, lang: doc.lang }, ...future],
    });
    get().notify(t.common.undone(last.label));
  },

  redo() {
    if (refuseWhileCreating()) return;
    const { doc, past, future, translation } = get();
    if (!doc || future.length === 0) return;
    const next = future[0];
    set({
      doc: { ...doc, cues: next.cues, lang: next.lang },
      translation: next.translation,
      past: [...past, { cues: doc.cues, label: next.label, translation, lang: doc.lang }],
      future: future.slice(1),
    });
    get().notify(t.common.redone(next.label));
  },

  updateCue(id, patch, label = t.list.editUndo) {
    const { doc } = get();
    if (!doc) return;
    get().commit(
      doc.cues.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      label,
    );
  },

  select(id, mode = 'replace') {
    if (id === null) return set({ selection: [] });
    const { selection, doc } = get();
    if (mode === 'toggle') {
      set({ selection: selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id] });
    } else if (mode === 'range' && doc && selection.length) {
      const ids = doc.cues.map((c) => c.id);
      const a = ids.indexOf(selection[selection.length - 1]);
      const b = ids.indexOf(id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      set({ selection: Array.from(new Set([...selection, ...ids.slice(lo, hi + 1)])) });
    } else {
      set({ selection: [id] });
    }
  },

  setSelection(ids) {
    set({ selection: ids });
  },

  enableTranslation(targetLang, prefill, sourceLang) {
    const { doc } = get();
    if (!doc) return;
    get().commit(
      doc.cues.map((c) => ({ ...c, target: prefill instanceof Map ? (prefill.get(c.id) ?? '') : (c.target ?? (prefill ? c.text : '')) })),
      t.translate.startUndo,
    );
    set({ translation: { targetLang, ...(sourceLang ? { sourceLang } : {}) }, display: 'target', editSide: 'target' });
  },

  disableTranslation() {
    const { doc } = get();
    if (!doc) return;
    get().commit(
      doc.cues.map((c) => {
        const { target: _drop, ...rest } = c;
        void _drop;
        return rest;
      }),
      t.translate.discardUndo,
    );
    set({ translation: null, targetHandle: null, targetModified: null, savedTargetCues: null });
  },

  useTranslation() {
    const { doc, translation, targetHandle, targetModified, savedTargetCues } = get();
    if (!doc || !translation) return;
    const upToDate = savedTargetCues === doc.cues;
    get().commit(doc.cues.map(adoptTranslation), t.translate.useUndo);
    // The subtitles are now in the translation's language: the export name keeps it (my-film.fr.srt).
    set({ translation: null, doc: { ...get().doc!, lang: translation.targetLang } });
    // Its file, when it has one, becomes the file ⌘S writes into.
    if (targetHandle)
      set({
        fileHandle: targetHandle,
        fileModified: targetModified,
        subtitleName: targetHandle.name,
        savedCues: upToDate ? get().doc!.cues : null,
        targetHandle: null,
        targetModified: null,
        savedTargetCues: null,
      });
  },

  setTranslationSource(sourceLang) {
    const tr = get().translation;
    if (tr && tr.sourceLang !== sourceLang) set({ translation: { ...tr, sourceLang } });
  },

  setTranslationLang(targetLang) {
    const tr = get().translation;
    if (tr && tr.targetLang !== targetLang) set({ translation: { ...tr, targetLang } });
  },

  setDisplay(display) {
    set({ display });
  },

  setSettings(patch) {
    const settings = { ...get().settings, ...patch };
    saveSettings(settings);
    set({ settings });
  },

  resetSettings() {
    // The signatures are the person's own lines, not a setting to restore.
    const settings = { ...DEFAULT_SETTINGS, signatures: get().settings.signatures };
    saveSettings(settings);
    set({ settings });
  },

  openDialog(dialog) {
    // Leaving a tool whose preview was neither applied nor cancelled (another tool picked from the
    // menu): the preview goes, the subtitles are as they were.
    const { doc, previewBase } = get();
    if (previewBase && doc) set({ doc: { ...doc, cues: previewBase }, previewBase: null });
    set({ dialog });
  },

  notify(text, opts = {}) {
    playSound('toast');
    const show = opts.tone === 'success' ? toast.success : opts.tone === 'warning' ? toast.warning : toast;
    show(text, {
      ...(opts.undo ? { action: { label: t.common.undo, onClick: () => get().undo() } } : opts.action ? { action: opts.action } : {}),
      ...(opts.stay ? { duration: Infinity } : {}),
      ...(opts.description ? { description: opts.description } : {}),
    });
  },

  exportFile(format, which, fileName) {
    const { doc, settings, translation } = get();
    if (!doc) return;
    const useTarget = which === 'target' && !!translation;
    const text = serialize(doc, format, useTarget, useTarget ? translation?.targetLang : doc.lang);
    const name = fileName;
    const url = URL.createObjectURL(encodeUtf8(text, settings.exportBom));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    get().notify(t.files.exported(name));
  },
}));

/* ------------------------------------------------------------------ */
/* Autosave to IndexedDB                                               */
/* ------------------------------------------------------------------ */

export interface SavedProject {
  doc: SubtitleDoc;
  subtitleName: string | null;
  /** File handles survive in IndexedDB: after a reload, saving asks Chrome's permission again. */
  fileHandle?: FileSystemFileHandle | null;
  fileModified?: number | null;
  /** Whether the file was up to date when the project was saved. */
  fileSaved?: boolean;
  /** The translation's own file, the same way. */
  targetHandle?: FileSystemFileHandle | null;
  targetModified?: number | null;
  targetSaved?: boolean;
  translation: Translation | null;
  video: VideoInfo | null;
  bookmarks?: Bookmark[];
  sceneNotes?: SceneNote[];
  /** Given by Rename (else the film's name is shown). */
  name?: string | null;
  picture?: string | null;
  pictureChosen?: boolean;
  videoHandle?: FileSystemFileHandle | null;
  savedAt: number;
}

export function applyRestored(p: SavedProject) {
  useApp.setState({
    doc: p.doc,
    subtitleName: p.subtitleName,
    // Translation is off for V1: a project saved while translating opens on the source text.
    translation: FEATURES.translation ? p.translation : null,
    expectedVideo: p.video,
    videoHandle: p.videoHandle ?? null,
    bookmarks: p.bookmarks ?? [],
    sceneNotes: p.sceneNotes ?? [],
    projectName: p.name ?? null,
    projectPicture: p.picture ?? null,
    pictureChosen: !!p.pictureChosen,
    fileHandle: p.fileHandle ?? null,
    fileModified: p.fileModified ?? null,
    savedCues: p.fileSaved ? p.doc.cues : null,
    targetHandle: p.targetHandle ?? null,
    targetModified: p.targetModified ?? null,
    savedTargetCues: p.targetSaved ? p.doc.cues : null,
    past: [],
    future: [],
    selection: [],
  });
}

/** What a project keeps (null when there's nothing to keep yet: no subtitles). */
export function projectSnapshot(st: AppState): SavedProject | null {
  if (!st.doc) return null;
  // A preview not applied yet is never saved: its starting point is.
  const doc = st.previewBase ? { ...st.doc, cues: st.previewBase } : st.doc;
  return {
    doc,
    subtitleName: st.subtitleName,
    fileHandle: st.fileHandle,
    fileModified: st.fileModified,
    fileSaved: !!st.savedCues && st.savedCues === doc.cues,
    targetHandle: st.targetHandle,
    targetModified: st.targetModified,
    targetSaved: !!st.savedTargetCues && st.savedTargetCues === doc.cues,
    translation: st.translation,
    video: st.video ?? st.expectedVideo,
    bookmarks: st.bookmarks,
    sceneNotes: st.sceneNotes,
    name: st.projectName,
    picture: st.projectPicture,
    pictureChosen: st.pictureChosen,
    videoHandle: st.videoHandle,
    savedAt: Date.now(),
  };
}

/** Changes that are worth saving the project for. */
export const projectChanged = (s: AppState, prev: AppState) =>
  !(
    s.doc === prev.doc &&
    s.translation === prev.translation &&
    s.video === prev.video &&
    s.videoHandle === prev.videoHandle &&
    s.bookmarks === prev.bookmarks &&
    s.sceneNotes === prev.sceneNotes &&
    s.projectName === prev.projectName &&
    s.projectPicture === prev.projectPicture &&
    s.savedCues === prev.savedCues &&
    s.savedTargetCues === prev.savedTargetCues
  );

/** While subtitles are created from the audio, edits would clash with the ones coming in. */
let lastRefusal = 0;
function refuseWhileCreating(): boolean {
  if (!useApp.getState().creatingSubs) return false;
  if (Date.now() - lastRefusal > 3000) {
    lastRefusal = Date.now();
    useApp.getState().notify(t.stt.locked, { tone: 'warning' });
  }
  return true;
}

// Leaving the page loses the open video (it has to be dropped again): ask first. The subtitles are
// saved anyway.
window.addEventListener('beforeunload', (e) => {
  if (!useApp.getState().videoUrl) return;
  e.preventDefault();
  e.returnValue = '';
});

// Back (⌘←, the trackpad swipe, the button) while a video is open: Chrome may handle ⌘← before the
// page sees it, so a spare history entry takes the hit and the app stays where it is.
let trapped = false;
useApp.subscribe((st) => {
  if (st.videoUrl && !trapped) {
    history.pushState({ subtleStay: true }, '');
    trapped = true;
  }
});
window.addEventListener('popstate', () => {
  if (!useApp.getState().videoUrl) return;
  history.pushState({ subtleStay: true }, '');
});

/** The side tools and checks work on: the language edited while translating (else everything as is). */
export const toolSide = (s: Pick<AppState, 'translation' | 'editSide'>): EditSide => (s.translation ? s.editSide : 'target');
/** The field typed in: the edited language's while translating, else the text. */
export const editField = (s: Pick<AppState, 'translation' | 'editSide'>): 'text' | 'target' => (s.translation ? sideField(s.editSide) : 'text');
