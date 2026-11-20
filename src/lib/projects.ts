/**
 * Projects kept in this browser: each one has its own id (made when it starts) and a card for the
 * Recent projects menu. A video dropped later finds its project by its fingerprint (lib/fingerprint:
 * size + three 1 MB pieces, so a renamed film is still found); older projects by name and size.
 */
import { sameVideo } from './fingerprint';
import { isLangCode } from './languages';
import type { SceneNote } from './sceneNotes';
import { newId, type Bookmark, type Cue, type SubtitleDoc, type SubtitleFormat } from './types';

export interface ProjectCard {
  id: string;
  /** The film's name (the video's, else the subtitle file's), for the menu. */
  title: string;
  video: { name: string; size: number; fp?: string } | null;
  subtitleName: string | null;
  lang?: string;
  targetLang?: string;
  cues: number;
  updatedAt: number;
  /** The project's picture (a frame of its film, JPEG data URL ≈ 15 KB). */
  picture?: string;
  /** The film's length, ms. */
  durationMs?: number;
  /** Roughly what it takes in this browser. */
  bytes?: number;
}

const stripExt = (name: string) => name.replace(/\.(mp4|m4v|mov|mkv|webm|srt|vtt|ass|ssa|sbv|ttml|dfxp|xml)$/i, '');

export function projectTitle(video: { name: string } | null, subtitleName: string | null, name?: string | null): string {
  if (name?.trim()) return name.trim();
  if (video) return stripExt(video.name);
  if (subtitleName) return stripExt(subtitleName).replace(/\.[a-z]{2,3}(-[A-Za-z]{2,4})?$/, '');
  return 'Untitled';
}

/** The list with this card added or updated, most recent first, and the ids that no longer fit (no limit by default). */
export function upsertCard(list: ProjectCard[], card: ProjectCard, limit = Infinity): { list: ProjectCard[]; evicted: string[] } {
  const all = [card, ...list.filter((c) => c.id !== card.id)].sort((a, b) => b.updatedAt - a.updatedAt);
  return { list: all.slice(0, limit), evicted: all.slice(limit).map((c) => c.id) };
}

/** The most recent other project made with this video (its fingerprint; name and size for older projects). */
export function projectForVideo(list: ProjectCard[], video: { name: string; size: number; fp?: string }, exceptId: string | null): ProjectCard | undefined {
  return list.find((c) => c.id !== exceptId && sameVideo(c.video, video));
}

/** "The Odyssey" → "The Odyssey copy", "The Odyssey copy" → "The Odyssey copy 2"… among the titles taken. */
export function copyName(title: string, taken: string[]): string {
  const base = title.replace(/ copy( \d+)?$/, '');
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base} copy` : `${base} copy ${n}`;
    if (!taken.includes(name)) return name;
  }
}

/** Projects whose title, film or subtitle file contains the words typed. */
export function filterProjects(list: ProjectCard[], query: string): ProjectCard[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((c) => {
    const hay = [c.title, c.video?.name ?? '', c.subtitleName ?? ''].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** A project file (Export project…): the project as kept here, without its file handles. */
export const PROJECT_FILE = 'subtle-project';

export function projectFileText(project: Record<string, unknown>): string {
  const { fileHandle: _a, targetHandle: _b, videoHandle: _c, ...rest } = project;
  return JSON.stringify({ format: PROJECT_FILE, version: 1, project: rest });
}

/** The project in a .subtle file, every field checked (cleanProject), or null when it isn't one. */
export function readProjectFile(text: string): ProjectData | null {
  try {
    const data = JSON.parse(text) as { format?: string; project?: unknown };
    return data?.format === PROJECT_FILE ? cleanProject(data.project) : null;
  } catch {
    return null;
  }
}

/** A project as kept (without file handles), every field checked: what a .subtle file or storage may hold. */
export interface ProjectData {
  doc: SubtitleDoc;
  subtitleName: string | null;
  translation: { targetLang: string; sourceLang?: string } | null;
  video: { name: string; size: number; durationMs: number; fp?: string } | null;
  bookmarks: Bookmark[];
  sceneNotes: SceneNote[];
  name: string | null;
  picture: string | null;
  pictureChosen: boolean;
  fileModified: number | null;
  fileSaved: boolean;
  targetModified: number | null;
  targetSaved: boolean;
  savedAt: number;
}

const FORMATS: SubtitleFormat[] = ['srt', 'vtt', 'sbv', 'ass', 'ttml'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max = 100_000): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Only pictures held in the file itself: a web address would be fetched (a tracker) every time it shows. */
export const safePicture = (v: unknown): string | null =>
  typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < 2_000_000 ? v : null;
const lang = (v: unknown) => (typeof v === 'string' && isLangCode(v) ? v : undefined);

function cueOf(v: unknown): Cue | null {
  if (!isObj(v) || !num(v.start) || !num(v.end)) return null;
  const start = Math.max(0, Math.round(v.start));
  const c: Cue = { id: str(v.id, 100) || newId(), start, end: Math.max(start, Math.round(v.end)), text: str(v.text) ?? '' };
  const target = str(v.target);
  if (target !== undefined) c.target = target;
  const vttId = str(v.vttId, 500);
  if (vttId !== undefined) c.vttId = vttId;
  const vttSettings = str(v.vttSettings, 500);
  if (vttSettings !== undefined) c.vttSettings = vttSettings;
  return c;
}

/**
 * The project in `raw` with every field checked (types, numbers, lengths), what's wrong dropped or
 * set to its default, or null when there are no subtitles to speak of. A bad file then opens what
 * it can instead of breaking the app on every launch.
 */
export function cleanProject(raw: unknown): ProjectData | null {
  if (!isObj(raw) || !isObj(raw.doc) || !Array.isArray(raw.doc.cues)) return null;
  const d = raw.doc;
  const seen = new Set<string>();
  const cues = (d.cues as unknown[])
    .map(cueOf)
    .filter((c): c is Cue => !!c)
    .map((c) => (seen.has(c.id) ? { ...c, id: newId() } : (seen.add(c.id), c)))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const doc: SubtitleDoc = { format: FORMATS.includes(d.format as SubtitleFormat) ? (d.format as SubtitleFormat) : 'srt', cues };
  const docLang = lang(d.lang);
  if (docLang) doc.lang = docLang;
  const vttHeader = str(d.vttHeader, 10_000);
  if (vttHeader !== undefined) doc.vttHeader = vttHeader;
  if (Array.isArray(d.vttBlocks)) doc.vttBlocks = d.vttBlocks.map((b) => str(b, 100_000)).filter((b): b is string => b !== undefined);
  const tr =
    isObj(raw.translation) && lang(raw.translation.targetLang)
      ? { targetLang: lang(raw.translation.targetLang)!, ...(lang(raw.translation.sourceLang) ? { sourceLang: lang(raw.translation.sourceLang) } : {}) }
      : null;
  const v = raw.video;
  const video =
    isObj(v) && str(v.name, 1000) && num(v.size)
      ? { name: str(v.name, 1000)!, size: v.size, durationMs: num(v.durationMs) ? v.durationMs : 0, ...(str(v.fp, 200) ? { fp: str(v.fp, 200) } : {}) }
      : null;
  const bookmarks = list(raw.bookmarks)
    .filter(isObj)
    .filter((b) => num(b.time) && num(b.slot))
    .map((b) => ({
      id: str(b.id, 100) || newId(),
      slot: Math.max(1, Math.round(b.slot as number)),
      time: Math.max(0, Math.round(b.time as number)),
      label: str(b.label, 500) ?? '',
      ...(safePicture(b.image) ? { image: safePicture(b.image)! } : {}),
    }));
  const sceneNotes = list(raw.sceneNotes)
    .filter(isObj)
    .filter((n) => num(n.time))
    .map((n) => ({ id: str(n.id, 100) || newId(), time: Math.max(0, Math.round(n.time as number)), text: str(n.text, 10_000) ?? '' }));
  return {
    doc,
    subtitleName: str(raw.subtitleName, 1000) ?? null,
    translation: tr,
    video,
    bookmarks,
    sceneNotes,
    name: str(raw.name, 500)?.trim() || null,
    picture: safePicture(raw.picture),
    pictureChosen: raw.pictureChosen === true,
    fileModified: num(raw.fileModified) ? raw.fileModified : null,
    fileSaved: raw.fileSaved === true,
    targetModified: num(raw.targetModified) ? raw.targetModified : null,
    targetSaved: raw.targetSaved === true,
    savedAt: num(raw.savedAt) ? raw.savedAt : Date.now(),
  };
}
