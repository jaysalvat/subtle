/**
 * Subtitles in a .zip (what subtitle sites hand out): the subtitle files inside are read; one opens
 * like a dropped .srt (offerSubtitleFile: add or replace), several are offered in a window like the
 * MKV's tracks (ZipSubsDialog).
 */
import { create } from 'zustand';
import { t } from '../i18n';
import { decodeSubtitleBytes } from '../lib/encoding';
import { isSubtitleFile } from '../lib/files';
import { parseSubtitles } from '../lib/formats';
import { entryBaseName, isJunkEntry, unzipEntry, zipEntries } from '../lib/zip';
import { useApp } from './store';

export interface ZipSub {
  /** The file as it opens: its name in the zip, its bytes. */
  file: File;
  /** Where it is in the zip, when in a folder. */
  path: string;
  cues: number;
}

export const useZipSubs = create<{ name: string; subs: ZipSub[] }>(() => ({ name: '', subs: [] }));

export async function openZip(zip: File): Promise<void> {
  const notify = (text: string) => useApp.getState().notify(text, { tone: 'warning' });
  let subs: ZipSub[];
  try {
    const bytes = new Uint8Array(await zip.arrayBuffer());
    const entries = zipEntries(bytes).filter((e) => !isJunkEntry(e.name) && isSubtitleFile({ name: entryBaseName(e.name) }));
    subs = [];
    for (const e of entries) {
      // One entry too big (a zip bomb) is left out, not the whole zip.
      const data = await unzipEntry(bytes, e).catch(() => null);
      if (!data) continue;
      const name = entryBaseName(e.name);
      const cues = parseSubtitles(name, decodeSubtitleBytes(data).text).cues.length;
      if (cues) subs.push({ file: new File([data as Uint8Array<ArrayBuffer>], name, { lastModified: zip.lastModified }), path: e.name, cues });
    }
  } catch {
    return notify(t.zipSubs.failed(zip.name));
  }
  if (!subs.length) return notify(t.files.noSubsIn(zip.name));
  if (subs.length === 1) return useApp.getState().offerSubtitleFile(subs[0].file);
  subs.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  useZipSubs.setState({ name: zip.name, subs });
  useApp.getState().openDialog('zipSubs');
}

/** The one picked in the window opens (add or replace when subtitles are open). */
export async function openZipSub(sub: ZipSub): Promise<void> {
  useApp.getState().openDialog(null);
  await useApp.getState().offerSubtitleFile(sub.file);
}
