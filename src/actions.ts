import { caretFor, focusField, forgetCaret } from './store/caret';
import { editableText, setColour, isBold, setBold } from './lib/markup';
import { newId } from './lib/types';
import { replaceColour, withoutColours } from './lib/colour';
import type { Cue, SavedSelection } from './lib/types';
import { liveIds, selectionRange } from './lib/selections';
import { isUpperCase, toSentenceCase, toUpperCase } from './lib/textCase';
import { bookmarkNear, defaultLabel, nextMark } from './lib/bookmarks';
import { t } from './i18n';
import { isSubtitleFile, isVideoFile, isZipFile } from './lib/files';
import { isTop, setPosition } from './lib/position';
import { isItalic, setItalic } from './lib/markup';
import { editField, useApp } from './store/store';
import { openNote } from './store/sceneNoteEditor';
import { drawFrame } from './store/picture';
import { importProjectFile, newProject, showProjects, useProjects } from './store/projects';
import { player, usePlayback } from './store/playback';
import { useWaveform } from './store/waveform';
import { cueAt, deleteCues, insertCueAt, speechSlot, moveCuesBy, mergeWithNext, nextCueIndex, nudgeEnds, prevCueTarget, retime, splitCue } from './lib/tools';

/** Commands shared by buttons, keyboard shortcuts and the timeline. */

const cues = () => useApp.getState().doc?.cues ?? [];
const settings = () => useApp.getState().settings;
const notify = (s: string, opts?: { undo?: boolean; tone?: 'success' | 'warning' }) => useApp.getState().notify(s, opts);

/** Selected ids, or the active cue when nothing is selected. */
function targetIds(): string[] {
  const sel = useApp.getState().selection;
  if (sel.length) return sel;
  const i = cueAt(cues(), player.now());
  return i >= 0 ? [cues()[i].id] : [];
}

export function goToIndex(i: number) {
  const list = cues();
  if (i < 0 || i >= list.length) return;
  player.seek(list[i].start);
  useApp.getState().select(list[i].id);
  usePlayback.getState().setFollowPaused(false);
  if (settings().autoPlayOnJump) player.play();
}

export function goToCue(id: string) {
  const i = cues().findIndex((c) => c.id === id);
  goToIndex(i);
}

export const goNext = () => {
  const i = nextCueIndex(cues(), player.now());
  if (i >= 0) goToIndex(i);
};
export const goPrev = () => {
  const i = prevCueTarget(cues(), player.now());
  if (i >= 0) goToIndex(i);
};
export const goFirst = () => goToIndex(0);
export const goLast = () => goToIndex(cues().length - 1);

export function nudge(sign: 1 | -1) {
  const ids = targetIds();
  if (!ids.length) return;
  const s = settings();
  useApp.getState().commit(nudgeEnds(cues(), ids, sign * s.nudgeStepMs, s), sign > 0 ? t.list.lengthenUndo : t.list.shortenUndo);
}

/** ⌥⇧← / → : move the selected subtitles (else the one at the playhead) by the nudge step. */
export function moveSelected(sign: 1 | -1) {
  const ids = targetIds();
  if (!ids.length) return;
  const s = settings();
  const next = moveCuesBy(cues(), ids, sign * s.nudgeStepMs, s);
  if (next !== cues()) useApp.getState().commit(next, sign > 0 ? t.list.moveLaterUndo : t.list.moveEarlierUndo);
}

export function insertAtPlayhead(at = player.now()) {
  const s = settings();
  const r = insertCueAt(cues(), at, s);
  if (!r) {
    notify(t.list.noRoom, { tone: 'warning' });
    return null;
  }
  useApp.getState().commit(r.cues, t.list.insertUndo, [r.id]);
  // Ready to type its text (the translation while translating).
  focusField(editField(useApp.getState()));
  return r.id;
}

/**
 * A new, empty subtitle on the line of dialogue at `at` (⌥-click on the dialogue waveform): the
 * speech span's times, a gap from its neighbours (`speechSlot`); ready to type. Null when there's
 * no speech there, a subtitle already, or no room.
 */
export function insertOnSpeech(at: number) {
  const spans = useWaveform.getState().dialogue?.spans;
  const slot = spans ? speechSlot(cues(), spans, at, settings()) : null;
  if (!slot) return null;
  const list = cues();
  const id = newId();
  const cue: Cue = { id, ...slot, text: '', ...(list.some((c) => c.target !== undefined) ? { target: '' } : {}) };
  useApp.getState().commit(
    [...list, cue].sort((a, b) => a.start - b.start),
    t.list.insertUndo,
    [id],
  );
  focusField(editField(useApp.getState()));
  return id;
}

export function setEdgeToNow(edge: 'start' | 'end') {
  const ids = targetIds();
  if (ids.length !== 1) return;
  useApp.getState().commit(retime(cues(), ids[0], edge, player.now(), settings()), edge === 'start' ? t.list.setStartUndo : t.list.setEndUndo);
}

export function splitSelected() {
  const ids = targetIds();
  if (ids.length !== 1) return;
  const cue = cues().find((c) => c.id === ids[0]);
  // The text cursor was in this subtitle: cut the text there.
  const caret = cue ? caretFor(cue.id, cue, editableText) : null;
  const r = splitCue(cues(), ids[0], player.now(), settings(), caret ? { field: caret.field, index: caret.index } : undefined);
  if (r) forgetCaret();
  if (!r) {
    notify(t.list.splitOutside, { tone: 'warning' });
    return;
  }
  useApp.getState().commit(r.cues, t.list.splitUndo, [r.id]);
}

export function mergeSelected() {
  const ids = targetIds();
  if (ids.length !== 1) return;
  useApp.getState().commit(mergeWithNext(cues(), ids[0]), t.list.mergeUndo, [ids[0]]);
}

/**
 * What the Delete key deletes: the selection (highlighted; it follows the playhead, see
 * followSelection), else the subtitle under the playhead.
 */
function deleteTargets(): string[] {
  const sel = useApp.getState().selection;
  if (sel.length) return sel;
  const list = cues();
  const i = cueAt(list, player.now());
  return i >= 0 ? [list[i].id] : [];
}

/** Delete subtitles (`ids`, or what the Delete key targets), always saying what happened. */
export function deleteSelected(ids: string[] = deleteTargets()) {
  if (!ids.length) return notify(t.list.nothingToDelete, { tone: 'warning' });
  const list = cues();
  const set = new Set(ids);
  const idx = list.findIndex((c) => set.has(c.id));
  const rest = deleteCues(list, ids);
  const nextSel = rest[Math.min(idx, rest.length - 1)];
  useApp.getState().commit(rest, t.list.deleteUndo(ids.length), nextSel ? [nextSel.id] : []);
  notify(ids.length > 1 ? t.list.deletedMany(ids.length) : t.list.deletedOne(idx + 1), { undo: true });
}

/**
 * While translating: edit the other language (or `to`). When a subtitle's text was being typed,
 * the cursor moves to the same subtitle in the other language.
 */
export function switchEditSide(to?: 'source' | 'target') {
  const st = useApp.getState();
  if (!st.translation) return;
  const typing = (document.activeElement as HTMLElement | null)?.closest?.('.rows .selected');
  const next = to ?? (st.editSide === 'target' ? 'source' : 'target');
  if (next === st.editSide) return;
  st.setEditSide(next);
  if (typing) focusField(editField(useApp.getState()));
}

/** A scene note at the playhead (the one already there, if any), its window open to type in it. */
export function addSceneNoteHere() {
  const st = useApp.getState();
  if (!st.doc && !st.videoUrl) return;
  openNote(st.addSceneNote(player.now()).id);
}

/** Bookmark the current moment. */
export function addBookmarkHere() {
  const st = useApp.getState();
  if (!st.doc && !st.videoUrl) return;
  const near = bookmarkNear(st.bookmarks, player.now());
  if (near) return notify(t.bookmarks.exists(near.slot <= 9 ? near.slot : null));
  const b = st.addBookmark(player.now());
  const label = b.label === defaultLabel([], b.time, b.slot) ? undefined : b.label; // a subtitle's text, not the default name
  notify(b.slot <= 9 ? t.bookmarks.added(b.slot, label) : t.bookmarks.addedNoKey(label));
  void frameImage().then((img) => img && useApp.getState().setBookmarkImage(b.id, img));
}

/** The frame shown, as a small JPEG data URL (≈ 3 KB), or null without a video. */
const frameImage = async (width = 160) => (player.el ? drawFrame(player.el, width) : null);

/** Selections menu: the selected subtitles kept with the project, under a name made from their numbers. */
export function saveSelection() {
  const st = useApp.getState();
  const ids = liveIds({ ids: st.selection }, cues());
  if (!ids.length) return notify(t.selections.none);
  st.addSelection(ids, t.selections.defaultLabel(ids.length, selectionRange(ids, cues())));
  notify(t.selections.saved(ids.length), { tone: 'success' });
}

/** Selects a saved selection again (the ones still there) and goes to its first subtitle. */
export function selectSaved(saved: SavedSelection) {
  const ids = liveIds(saved, cues());
  if (!ids.length) return notify(t.selections.gone, { tone: 'warning' });
  goToCue(ids[0]);
  useApp.setState({ selection: ids });
}

export function goToBookmark(time: number) {
  player.seek(time);
  usePlayback.getState().setFollowPaused(false);
}

/**
 * The transport buttons with a modifier: ⌥ = bookmarks, ⇧ = scene notes, ⌥⇧ = lines of dialogue
 * (also ⌥↑ ↓ / ⇧↑ ↓ / ⌥⇧↑ ↓). `dir`: previous / next from the playhead, or the first / last one.
 */
export type MarkKind = 'bookmark' | 'note' | 'speech';
export function goMark(kind: MarkKind, dir: 1 | -1 | 'first' | 'last') {
  const { bookmarks, sceneNotes } = useApp.getState();
  // Lines of dialogue: where each speech span of the dialogue waveform starts.
  const times =
    kind === 'speech'
      ? (useWaveform.getState().dialogue?.spans ?? []).map(([start]) => start)
      : (kind === 'bookmark' ? bookmarks : sceneNotes).map((m) => m.time);
  const text = t.player.marks[kind];
  if (!times.length) return notify(text.none);
  const at = dir === 'first' ? Math.min(...times) : dir === 'last' ? Math.max(...times) : nextMark(times, player.now(), dir);
  if (at === null) notify(dir === 1 ? text.after : text.before);
  else goToBookmark(at);
}

/** Keys 1–9: jump to that bookmark. */
export function goToBookmarkSlot(slot: number) {
  const b = useApp.getState().bookmarks.find((x) => x.slot === slot);
  if (b) goToBookmark(b.time);
  else notify(t.bookmarks.noSlot(slot));
}

/** Jump 15 s back or forward (a running loop follows). */
export function skip(ms: number) {
  const end = usePlayback.getState().duration || Infinity;
  player.seek(Math.min(end, Math.max(0, player.now() + ms)));
  usePlayback.getState().setFollowPaused(false);
}

/** Top / bottom of the screen for the selected subtitles (or the one under the playhead). */
export function togglePosition() {
  const ids = targetIds();
  const doc = useApp.getState().doc;
  if (!ids.length || !doc) return;
  const set = new Set(ids);
  const list = cues();
  const top = !list.filter((c) => set.has(c.id)).every(isTop);
  useApp.getState().commit(
    list.map((c) => (set.has(c.id) ? setPosition(c, top, doc.format) : c)),
    top ? t.list.toTopUndo : t.list.toBottomUndo,
  );
}

/** Whole subtitle in italics, for the selected subtitles (or the one under the playhead); translation too. */
export function toggleItalic() {
  const ids = new Set(targetIds());
  if (!ids.size) return;
  const list = cues();
  const on = !list.filter((c) => ids.has(c.id)).every((c) => isItalic(c.text));
  useApp.getState().commit(
    list.map((c) => (ids.has(c.id) ? { ...c, text: setItalic(c.text, on), ...(c.target ? { target: setItalic(c.target, on) } : {}) } : c)),
    on ? t.list.italicOnUndo : t.list.italicOffUndo,
  );
}

/** Bold on the selected subtitles (or the one under the playhead), both languages, like italics (Pro mode). */
export function toggleBold() {
  const ids = new Set(targetIds());
  if (!ids.size) return;
  const list = cues();
  const on = !list.filter((c) => ids.has(c.id)).every((c) => isBold(c.text));
  useApp.getState().commit(
    list.map((c) => (ids.has(c.id) ? { ...c, text: setBold(c.text, on), ...(c.target ? { target: setBold(c.target, on) } : {}) } : c)),
    on ? t.list.boldOnUndo : t.list.boldOffUndo,
  );
}

/** The selected subtitles (or the one under the playhead) in a colour, both languages; null: none. */
export function setCueColour(colour: string | null) {
  const ids = new Set(targetIds());
  if (!ids.size) return;
  useApp.getState().commit(
    cues().map((c) => (ids.has(c.id) ? { ...c, text: setColour(c.text, colour), ...(c.target ? { target: setColour(c.target, colour) } : {}) } : c)),
    colour ? t.list.colourUndo : t.list.noColourUndo,
  );
}

/** A colour changed everywhere it's used (both languages, whole or part of a subtitle): one undo step. */
export function recolourEverywhere(from: string, to: string) {
  let n = 0;
  const next = cues().map((c) => {
    const text = replaceColour(c.text, from, to);
    const target = c.target !== undefined ? replaceColour(c.target, from, to) : undefined;
    if (text === c.text && target === c.target) return c;
    n++;
    return { ...c, text, ...(target !== undefined ? { target } : {}) };
  });
  if (!n) return;
  useApp.getState().commit(next, t.list.recolourUndo);
  notify(t.list.recoloured(n), { undo: true, tone: 'success' });
}

/** Tools › Remove colours: every subtitle back to white, both languages (one undo step). */
export function removeAllColours() {
  const before = cues();
  const next = withoutColours(before);
  const n = next.filter((c, i) => c !== before[i]).length;
  if (!n) return notify(t.tools.removeColoursNone);
  useApp.getState().commit(next, t.tools.removeColours);
  notify(t.tools.removeColoursDone(n), { undo: true, tone: 'success' });
}

/**
 * Capitals ↔ sentence case on the selected subtitles (OCR of a sign often gives capitals). While
 * translating, on the translation when there is one.
 */
export function toggleTextCase() {
  const ids = new Set(targetIds());
  if (!ids.size) return;
  const st = useApp.getState();
  const list = cues();
  const tr = st.translation;
  // Capitals or not: decided by the language edited (the translation unless the original is edited).
  const field = (c: Cue): 'text' | 'target' => (tr && st.editSide === 'target' && c.target?.trim() ? 'target' : 'text');
  const picked = list.filter((c) => ids.has(c.id));
  // Several subtitles: all go the same way, decided by the first.
  const toUpper = !isUpperCase(picked[0][field(picked[0])] ?? '');
  // Both languages go the same way, like italics; each with its own rules (sentence case).
  const source = tr?.sourceLang ?? st.doc?.lang;
  const change = (v: string, l?: string) => (toUpper ? toUpperCase(v, l) : toSentenceCase(v, l));
  st.commit(
    list.map((c) => {
      if (!ids.has(c.id)) return c;
      return { ...c, text: change(c.text, source), ...(c.target?.trim() ? { target: change(c.target, tr?.targetLang) } : {}) };
    }),
    toUpper ? t.list.upperUndo : t.list.sentenceUndo,
  );
}

/** A file dropped anywhere (window or drop zone): subtitles or video, whichever it is. */
/** Files dropped on the Projects page start one new project (a film and its subtitles together). */
let starting: Promise<void> | null = null;

export async function openDroppedFile(f: File, handle: FileSystemFileHandle | null = null) {
  if (/\.subtle$/i.test(f.name)) return void importProjectFile(f);
  if (useProjects.getState().pageOpen && (isSubtitleFile(f) || isZipFile(f) || isVideoFile(f))) {
    starting ??= newProject().then(() => {
      showProjects(false);
      setTimeout(() => (starting = null), 0);
    });
    await starting;
  }
  const st = useApp.getState();
  if (isSubtitleFile(f) || isZipFile(f))
    void st.offerSubtitleFile(f, handle); // subtitles open: asks to add (e.g. forced) or replace
  else if (isVideoFile(f)) st.loadVideoFile(f, handle);
  else notify(t.files.notVideoOrSubs(f.name), { tone: 'warning' });
}
