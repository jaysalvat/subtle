/**
 * Reading a .zip (subtitle sites hand them out): the central directory → entries, then one entry's
 * bytes, stored or deflated (the browser's DecompressionStream, no library). No Zip64, no encryption:
 * subtitle archives are small. Pure apart from DecompressionStream.
 */

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflated. */
  method: number;
  /** Where the local header starts. */
  headerAt: number;
  compressedSize: number;
  size: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Names are UTF-8 when the flag says so, else the old DOS code page (read as Latin-1: close enough). */
function entryName(bytes: Uint8Array, utf8: boolean): string {
  return new TextDecoder(utf8 ? 'utf-8' : 'latin1').decode(bytes);
}

export function isZipBytes(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5);
}

/** The files in the archive (folders left out). Throws when it isn't a zip it can read. */
export function zipEntries(b: Uint8Array): ZipEntry[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // The end record is in the last 22 bytes + up to 64 KB of comment.
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip');
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  if (at === 0xffffffff) throw new Error('zip64');
  const out: ZipEntry[] = [];
  for (let k = 0; k < count; k++) {
    if (at + 46 > b.length || v.getUint32(at, true) !== CENTRAL) throw new Error('broken zip');
    const flags = v.getUint16(at + 8, true);
    const method = v.getUint16(at + 10, true);
    const compressedSize = v.getUint32(at + 20, true);
    const size = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const commentLen = v.getUint16(at + 32, true);
    const headerAt = v.getUint32(at + 42, true);
    const name = entryName(b.subarray(at + 46, at + 46 + nameLen), (flags & 0x800) !== 0);
    if (!name.endsWith('/') && !(flags & 1)) out.push({ name, method, headerAt, compressedSize, size });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Bigger than any subtitle file: an entry that unpacks past this is refused (a zip bomb). */
export const ZIP_ENTRY_MAX = 32 * 1024 * 1024;

/** One entry's bytes; throws past `max` (whatever the entry claims), so a zip bomb can't fill the memory. */
export async function unzipEntry(b: Uint8Array, e: ZipEntry, max = ZIP_ENTRY_MAX): Promise<Uint8Array> {
  if (e.size > max || e.compressedSize > max) throw new Error('zip entry too big');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getUint32(e.headerAt, true) !== LOCAL) throw new Error('broken zip');
  const start = e.headerAt + 30 + v.getUint16(e.headerAt + 26, true) + v.getUint16(e.headerAt + 28, true);
  const data = b.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data;
  if (e.method !== 8) throw new Error(`compression ${e.method}`);
  const reader = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new Error('zip entry too big');
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The base name of an entry: "Subs/English.srt" → "English.srt". */
export const entryBaseName = (name: string) => name.slice(name.lastIndexOf('/') + 1);

/** macOS's resource forks and hidden files, never subtitles. */
export const isJunkEntry = (name: string) => name.startsWith('__MACOSX/') || entryBaseName(name).startsWith('.');
