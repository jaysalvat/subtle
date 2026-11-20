/**
 * Projects kept in this browser (IndexedDB): the open one is saved as you work; New puts it aside
 * instead of deleting it; Recent projects opens one again; a video dropped into an empty project
 * offers the project it was used in. The single project kept before (subtle.project) becomes the
 * first one. Pure parts: src/lib/projects.ts.
 */
import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import { create } from 'zustand';
import { choose } from '../components/Confirm';
import { t } from '../i18n';
import { cleanProject, copyName, projectFileText, projectForVideo, projectTitle, readProjectFile, upsertCard, type ProjectCard } from '../lib/projects';
import { newId } from '../lib/types';
import { safeFileName } from '../lib/filename';
import { downloadBlob } from './file';
import { applyRestored, projectChanged, projectSnapshot, useApp, type SavedProject } from './store';

const LIST_KEY = 'subtle.projects';
const projectKey = (id: string) => `subtle.project.${id}`;

const handle = (h: unknown) => (h instanceof FileSystemHandle ? (h as FileSystemFileHandle) : null);

/** A kept project, every field checked (lib/projects cleanProject): a broken one opens what it can. */
async function read(id: string): Promise<SavedProject | undefined> {
  const raw = (await idbGet(projectKey(id)).catch(() => undefined)) as Record<string, unknown> | undefined;
  const p = cleanProject(raw);
  // Its file handles (from this browser) stay as they are.
  return p ? { ...p, fileHandle: handle(raw?.fileHandle), targetHandle: handle(raw?.targetHandle), videoHandle: handle(raw?.videoHandle) } : undefined;
}
const CURRENT_KEY = 'subtle.currentProject';
// Before projects: one project only, under these keys.
const OLD_KEYS = ['subtle.project', 'subtitlizer.project'];

export const useProjects = create<{ list: ProjectCard[]; currentId: string | null; /** The Projects page shows instead of the editor. */ pageOpen: boolean }>(
  () => ({ list: [], currentId: null, pageOpen: false }),
);

export const showProjects = (open: boolean) => useProjects.setState({ pageOpen: open });

const readCurrent = () => {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
};
const writeCurrent = (id: string | null) => {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    /* private mode */
  }
};
const setCurrent = (id: string | null) => {
  useProjects.setState({ currentId: id });
  writeCurrent(id);
};

function cardOf(id: string, p: SavedProject): ProjectCard {
  return {
    id,
    title: projectTitle(p.video, p.subtitleName, p.name),
    video: p.video ? { name: p.video.name, size: p.video.size, ...(p.video.fp ? { fp: p.video.fp } : {}) } : null,
    subtitleName: p.subtitleName,
    lang: p.translation?.sourceLang ?? p.doc.lang,
    targetLang: p.translation?.targetLang,
    cues: p.doc.cues.length,
    updatedAt: p.savedAt,
    ...(p.picture ? { picture: p.picture } : {}),
    ...(p.video?.durationMs ? { durationMs: p.video.durationMs } : {}),
    bytes: sizeOf(p),
  };
}

/** Roughly what a project takes (its JSON, file handles aside). */
function sizeOf(p: SavedProject): number {
  return new Blob([projectFileText(p as unknown as Record<string, unknown>)]).size;
}

async function store(id: string, p: SavedProject) {
  await idbSet(projectKey(id), p);
  const { list, evicted } = upsertCard(useProjects.getState().list, cardOf(id, p));
  useProjects.setState({ list });
  await idbSet(LIST_KEY, list);
  await Promise.all(evicted.map((e) => idbDel(projectKey(e))));
}

/** Save the open project now (before New, opening another…). */
export async function saveProjectNow() {
  clearTimeout(timer);
  const p = projectSnapshot(useApp.getState());
  if (!p) return;
  let id = useProjects.getState().currentId;
  if (!id) setCurrent((id = newId()));
  await store(id, p).catch(() => {});
}

let timer: ReturnType<typeof setTimeout> | undefined;
useApp.subscribe((s, prev) => {
  if (!s.doc || !projectChanged(s, prev)) return;
  clearTimeout(timer);
  timer = setTimeout(() => void saveProjectNow(), 600);
});

/** At start: the list, the old single project moved in, the last project opened again. Runs once. */
let started: Promise<void> | null = null;
export function initProjects() {
  return (started ??= init());
}

async function init() {
  let list = ((await idbGet(LIST_KEY).catch(() => undefined)) as ProjectCard[] | undefined) ?? [];
  useProjects.setState({ list });
  let current = readCurrent();
  if (!list.length) {
    for (const key of OLD_KEYS) {
      const old = cleanProject(await idbGet(key).catch(() => undefined));
      if (!old?.doc) continue;
      const id = newId();
      await store(id, old);
      list = useProjects.getState().list;
      current = id;
      // Only once it's safely in the new place.
      await Promise.all(OLD_KEYS.map((k) => idbDel(k).catch(() => {})));
      break;
    }
  }
  void fillCards(list);
  if (!current || !list.some((c) => c.id === current)) return setCurrent(null);
  const p = await read(current);
  if (p?.doc && !useApp.getState().doc) {
    applyRestored(p);
    setCurrent(current);
  } else if (!p) setCurrent(null);
}

/** New: the open project stays in Recent projects; an empty one starts. */
export async function newProject() {
  await saveProjectNow();
  useApp.getState().closeProject();
  setCurrent(null);
}

/** Open a kept project (the open one is kept first). */
async function openProject(id: string) {
  if (id === useProjects.getState().currentId) return;
  const p = await read(id);
  if (!p?.doc) {
    useApp.getState().notify(t.projects.gone, { tone: 'warning' });
    return forgetCard(id);
  }
  await saveProjectNow();
  useApp.getState().closeProject();
  applyRestored(p);
  setCurrent(id);
}

async function forgetCard(id: string) {
  const list = useProjects.getState().list.filter((c) => c.id !== id);
  useProjects.setState({ list });
  await idbSet(LIST_KEY, list).catch(() => {});
}

/** Delete a kept project (the open one: closed first). */
export async function deleteProject(id: string) {
  if (id === useProjects.getState().currentId) {
    clearTimeout(timer);
    useApp.getState().closeProject();
    setCurrent(null);
  }
  await idbDel(projectKey(id)).catch(() => {});
  await forgetCard(id);
}

/**
 * A video comes into an empty project (no subtitles yet): if it was used in another project,
 * offer to go back to it, with the video already there.
 */
let lastOffered = '';
useApp.subscribe((s, prev) => {
  // Once its fingerprint is known (a moment after opening).
  if (!s.video?.fp || s.video === prev.video || s.doc) return;
  const fp = s.video.fp;
  if (fp === lastOffered) return;
  const card = projectForVideo(useProjects.getState().list, s.video, useProjects.getState().currentId);
  if (!card) return;
  lastOffered = fp;
  void (async () => {
    const q = t.projects.found(card.title, new Date(card.updatedAt), card.cues, card.lang, card.targetLang);
    if ((await choose({ title: q.title, text: q.text, ok: q.ok, cancel: q.cancel })) !== 'ok') return;
    const p = await read(card.id);
    if (!p?.doc) return;
    // The video just opened stays: only the project's work comes back.
    const st = useApp.getState();
    const { videoHandle } = st;
    applyRestored(p);
    useApp.setState({ expectedVideo: null, videoHandle: videoHandle ?? p.videoHandle ?? null });
    setCurrent(card.id);
  })();
});

/** Rename a project (empty: named after its film again). */
export async function renameProject(id: string, name: string) {
  const clean = name.trim() || null;
  if (id === useProjects.getState().currentId) {
    useApp.setState({ projectName: clean });
    return saveProjectNow();
  }
  const p = await read(id);
  if (!p?.doc) return;
  // Not opened: its last change stays where it was in the list.
  await store(id, { ...p, name: clean });
}

/** The project, the open one as it is now. */
async function projectNow(id: string): Promise<SavedProject | undefined> {
  if (id === useProjects.getState().currentId) await saveProjectNow();
  return read(id);
}

/** Export project…: a .subtle file (JSON) with everything but the files on disk and the video. */
export async function exportProject(id: string) {
  const p = await projectNow(id);
  if (!p?.doc) return useApp.getState().notify(t.projects.gone, { tone: 'warning' });
  const name = `${safeFileName(projectTitle(p.video, p.subtitleName, p.name), 'Project')}.subtle`;
  downloadBlob(new Blob([projectFileText(p as unknown as Record<string, unknown>)], { type: 'application/json' }), name);
  useApp.getState().notify(t.files.exported(name), { tone: 'success' });
}

/** Import project…: a .subtle file becomes a new project, opened. */
export async function importProjectFile(file: File) {
  const p = readProjectFile(await file.text());
  if (!p) return useApp.getState().notify(t.projects.notAProject(file.name), { tone: 'warning' });
  const id = newId();
  // The film's files aren't in it: Save asks where, the video is dropped again.
  await store(id, { ...p, fileHandle: null, targetHandle: null, videoHandle: null, fileSaved: false, targetSaved: false, savedAt: Date.now() });
  await openProject(id);
  showProjects(false);
  useApp.getState().notify(t.projects.imported(projectTitle(p.video, p.subtitleName, p.name)), { tone: 'success' });
}

/** Duplicate: a copy beside it ("… copy"), not opened. */
export async function duplicateProject(id: string) {
  const p = await projectNow(id);
  if (!p?.doc) return;
  const title = projectTitle(p.video, p.subtitleName, p.name);
  await store(newId(), {
    ...p,
    name: copyName(
      title,
      useProjects.getState().list.map((c) => c.title),
    ),
    savedAt: Date.now(),
  });
}

/** Open a project from the Projects page (the open one: back to it). */
export async function openFromPage(id: string) {
  await openProject(id);
  showProjects(false);
}

/** Cards kept before the Projects page lack their size and picture: filled once from the projects. */
async function fillCards(list: ProjectCard[]) {
  const old = list.filter((c) => c.bytes === undefined);
  if (!old.length) return;
  const filled = new Map<string, ProjectCard>();
  for (const c of old) {
    const p = await read(c.id);
    if (p?.doc) filled.set(c.id, { ...cardOf(c.id, p), updatedAt: c.updatedAt });
  }
  const next = useProjects.getState().list.map((c) => filled.get(c.id) ?? c);
  useProjects.setState({ list: next });
  await idbSet(LIST_KEY, next).catch(() => {});
}
