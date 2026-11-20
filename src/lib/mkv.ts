/**
 * Subtitle tracks inside an MKV / WebM (Matroska), which Mediabunny doesn't read. Pure: works on a
 * `read(offset, length)` over the file, so a 5 GB film is never loaded whole.
 *
 * 1. The header (SeekHead, Info, Tracks) lists the tracks: language, name, codec, default / forced.
 * 2. Each subtitle is found through the index when mkvmerge wrote the file (it indexes every subtitle
 *    block, with its place in the cluster), else by walking the clusters, skipping picture and sound.
 * Text formats only (SRT, ASS / SSA, WebVTT); picture ones (PGS, VobSub) are listed, not read.
 */
import { assToText } from './formatsMore';
import { languageName, langFromTrack } from './languages';
import { newId, type Cue } from './types';

export type ReadAt = (offset: number, length: number) => Promise<Uint8Array>;

export interface MkvSubTrack {
  number: number;
  codec: string;
  /** ISO 639-2 ("fre") or BCP 47 ("fr-FR"), as written in the file. */
  language: string;
  name: string;
  isDefault: boolean;
  forced: boolean;
  /** SRT, ASS / SSA or WebVTT: can be opened. Else a picture format (PGS, VobSub…). */
  text: boolean;
  /** Frames are compressed: 0 = zlib, 3 = header stripping (prefix in `strip`). */
  compression?: number;
  strip?: Uint8Array;
}

export interface MkvInfo {
  tracks: MkvSubTrack[];
  /** ns per timestamp unit. */
  scale: number;
  /** Where the segment's data starts: SeekHead, Cues… positions are relative to it. */
  segmentStart: number;
  segmentEnd: number;
  cuesAt: number | null;
  firstCluster: number | null;
  /** The program that wrote the file ("mkvmerge v80.0…"): only mkvmerge indexes every subtitle. */
  writingApp: string;
}

const ID = {
  ebml: 0x1a45dfa3,
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPos: 0x53ac,
  info: 0x1549a966,
  scale: 0x2ad7b1,
  writingApp: 0x5741,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackType: 0x83,
  codecId: 0x86,
  language: 0x22b59c,
  languageBcp47: 0x22b59d,
  name: 0x536e,
  flagDefault: 0x88,
  flagForced: 0x55aa,
  encodings: 0x6d80,
  encoding: 0x6240,
  compression: 0x5034,
  compAlgo: 0x4254,
  compSettings: 0x4255,
  cues: 0x1c53bb6b,
  cuePoint: 0xbb,
  cueTime: 0xb3,
  cuePos: 0xb7,
  cueTrack: 0xf7,
  cueCluster: 0xf1,
  cueRelative: 0xf0,
  cluster: 0x1f43b675,
  timestamp: 0xe7,
  simpleBlock: 0xa3,
  blockGroup: 0xa0,
  block: 0xa1,
  blockDuration: 0x9b,
} as const;

const TEXT_CODECS = /^S_TEXT\/(UTF8|ASS|SSA|WEBVTT)$/;
const UNKNOWN = -1;
/**
 * Sizes come from the file: a crafted one could claim gigabytes and fill the memory. Header parts
 * (SeekHead, Info, Tracks, Cues) above META_MAX and subtitles above BLOCK_MAX (stored or unpacked)
 * are left out.
 */
const META_MAX = 16 * 1024 * 1024;
const BLOCK_MAX = 1024 * 1024;

interface Head {
  id: number;
  /** Data size, UNKNOWN for "until the parent ends". */
  size: number;
  /** Length of the ID + size. */
  len: number;
}

/** An element ID (marker bit kept) and size (marker removed) at `p`, or null if cut. */
function readHead(b: Uint8Array, p: number): Head | null {
  if (p >= b.length) return null;
  const idLen = vintLength(b[p]);
  if (!idLen || idLen > 4 || p + idLen >= b.length) return null;
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + b[p + i];
  const sizeLen = vintLength(b[p + idLen]);
  if (!sizeLen || p + idLen + sizeLen > b.length) return null;
  let size = b[p + idLen] & (0xff >> sizeLen);
  let allOnes = size === 0xff >> sizeLen;
  for (let i = 1; i < sizeLen; i++) {
    const v = b[p + idLen + i];
    size = size * 256 + v;
    allOnes &&= v === 0xff;
  }
  return { id, size: allOnes ? UNKNOWN : size, len: idLen + sizeLen };
}

const vintLength = (first: number) => (first === 0 ? 0 : 8 - Math.floor(Math.log2(first)));

/** Children of an element whose data is all in `b` (from `from` to `to`). */
function* children(b: Uint8Array, from = 0, to = b.length): Generator<Head & { at: number }> {
  let p = from;
  while (p < to) {
    const h = readHead(b, p);
    if (!h || h.size === UNKNOWN) return;
    yield { ...h, at: p + h.len };
    p += h.len + h.size;
  }
}

const uint = (b: Uint8Array, at: number, size: number) => {
  let v = 0;
  for (let i = 0; i < size; i++) v = v * 256 + b[at + i];
  return v;
};
const utf8 = new TextDecoder();
const str = (b: Uint8Array, at: number, size: number) => utf8.decode(b.subarray(at, at + size)).replace(/\0+$/, '');

/** Reads the header: tracks, time scale, where the index and the clusters are. */
export async function readMkvInfo(read: ReadAt, fileSize: number): Promise<MkvInfo> {
  const start = await read(0, 64);
  const ebml = readHead(start, 0);
  if (!ebml || ebml.id !== ID.ebml) throw new Error('Not a Matroska file');
  const seg = readHead(start, ebml.len + ebml.size);
  if (!seg || seg.id !== ID.segment) throw new Error('No Matroska segment');
  const segmentStart = ebml.len + ebml.size + seg.len;
  const segmentEnd = seg.size === UNKNOWN ? fileSize : Math.min(fileSize, segmentStart + seg.size);

  // Level-1 elements: walk them up to the first cluster, then follow the SeekHead for the rest.
  const at = new Map<number, number>();
  let p = segmentStart;
  while (p < segmentEnd) {
    const h = readHead(await read(p, 16), 0);
    if (!h) break;
    if (!at.has(h.id)) at.set(h.id, p);
    if (h.id === ID.seekHead && h.size <= META_MAX) {
      const sh = await read(p + h.len, h.size);
      for (const s of children(sh)) {
        if (s.id !== ID.seek) continue;
        let id = 0;
        let pos = -1;
        for (const c of children(sh, s.at, s.at + s.size)) {
          if (c.id === ID.seekId) id = uint(sh, c.at, c.size);
          if (c.id === ID.seekPos) pos = uint(sh, c.at, c.size);
        }
        if (id && pos >= 0 && !at.has(id)) at.set(id, segmentStart + pos);
      }
    }
    if (h.id === ID.cluster || h.size === UNKNOWN) break;
    p += h.len + h.size;
  }

  const element = async (id: number) => {
    const pos = at.get(id);
    if (pos === undefined) return null;
    const h = readHead(await read(pos, 16), 0);
    return h && h.id === id && h.size !== UNKNOWN && h.size <= META_MAX ? read(pos + h.len, h.size) : null;
  };

  let scale = 1_000_000;
  let writingApp = '';
  const info = await element(ID.info);
  if (info)
    for (const c of children(info)) {
      if (c.id === ID.scale) scale = uint(info, c.at, c.size);
      if (c.id === ID.writingApp) writingApp = str(info, c.at, c.size);
    }

  const tracks: MkvSubTrack[] = [];
  const tr = await element(ID.tracks);
  if (tr)
    for (const e of children(tr)) {
      if (e.id !== ID.trackEntry) continue;
      const t: MkvSubTrack & { type: number; bcp?: string } = {
        number: 0,
        type: 0,
        codec: '',
        language: 'eng',
        name: '',
        isDefault: true,
        forced: false,
        text: false,
      };
      for (const c of children(tr, e.at, e.at + e.size)) {
        if (c.id === ID.trackNumber) t.number = uint(tr, c.at, c.size);
        else if (c.id === ID.trackType) t.type = uint(tr, c.at, c.size);
        else if (c.id === ID.codecId) t.codec = str(tr, c.at, c.size);
        else if (c.id === ID.language) t.language = str(tr, c.at, c.size);
        else if (c.id === ID.languageBcp47) t.bcp = str(tr, c.at, c.size);
        else if (c.id === ID.name) t.name = str(tr, c.at, c.size);
        else if (c.id === ID.flagDefault) t.isDefault = uint(tr, c.at, c.size) === 1;
        else if (c.id === ID.flagForced) t.forced = uint(tr, c.at, c.size) === 1;
        else if (c.id === ID.encodings) readCompression(tr, c.at, c.size, t);
      }
      if (t.type !== 0x11) continue;
      const { type: _type, bcp, ...track } = t;
      tracks.push({ ...track, language: bcp || t.language, text: TEXT_CODECS.test(t.codec) });
    }

  return { tracks, scale, segmentStart, segmentEnd, cuesAt: at.get(ID.cues) ?? null, firstCluster: at.get(ID.cluster) ?? null, writingApp };
}

function readCompression(b: Uint8Array, from: number, size: number, t: MkvSubTrack) {
  for (const enc of children(b, from, from + size)) {
    if (enc.id !== ID.encoding) continue;
    for (const c of children(b, enc.at, enc.at + enc.size)) {
      if (c.id !== ID.compression) continue;
      t.compression = 0; // zlib unless said otherwise
      for (const k of children(b, c.at, c.at + c.size)) {
        if (k.id === ID.compAlgo) t.compression = uint(b, k.at, k.size);
        if (k.id === ID.compSettings) t.strip = b.slice(k.at, k.at + k.size);
      }
    }
  }
}

/** "French · Forced", "English · SDH": the language, then the track's own name or flags. */
export function trackLabel(t: MkvSubTrack): string {
  const lang = langFromTrack(t.language);
  const parts = [lang ? languageName(lang) : t.language === 'und' ? '' : t.language];
  const name = t.name.trim();
  // The name often repeats the language ("French Forced"): keep what it adds.
  const extra = lang && name.toLowerCase().startsWith(languageName(lang).toLowerCase()) ? name.slice(languageName(lang).length).trim() : name;
  // "English (UK)" stays as written; "French Forced" → "French · Forced".
  if (extra.startsWith('(')) parts[0] = `${parts[0]} ${extra}`;
  else if (extra) parts.push(extra);
  else if (t.forced) parts.push('Forced');
  return parts.filter(Boolean).join(' · ') || `Track ${t.number}`;
}

/** One subtitle as stored: track, times in ms, raw bytes. */
export interface MkvSubBlock {
  track: number;
  start: number;
  end: number;
  data: Uint8Array;
}

/** A Block's track number, relative time and frame bytes (subtitles are never laced). */
function parseBlock(b: Uint8Array, at: number, size: number) {
  const len = vintLength(b[at]);
  let track = b[at] & (0xff >> len);
  for (let i = 1; i < len; i++) track = track * 256 + b[at + i];
  const rel = (((b[at + len] << 8) | b[at + len + 1]) << 16) >> 16;
  return { track, rel, data: b.subarray(at + len + 3, at + size) };
}

/** The subtitle in a BlockGroup / SimpleBlock whose data is in `b`, if it's one of `want`. */
function blockOf(b: Uint8Array, h: Head & { at: number }, clusterTs: number, scale: number, want: Set<number>): MkvSubBlock | null {
  let block: ReturnType<typeof parseBlock> | null = null;
  let duration = 0;
  if (h.id === ID.simpleBlock) block = parseBlock(b, h.at, h.size);
  else
    for (const c of children(b, h.at, h.at + h.size)) {
      if (c.id === ID.block) block = parseBlock(b, c.at, c.size);
      if (c.id === ID.blockDuration) duration = uint(b, c.at, c.size);
    }
  if (!block || !want.has(block.track)) return null;
  const ms = (units: number) => Math.round((units * scale) / 1e6);
  return { track: block.track, start: ms(clusterTs + block.rel), end: ms(clusterTs + block.rel + duration), data: block.data.slice() };
}

/**
 * Every subtitle of these tracks. Through the index when it points at each block, else by walking
 * the clusters (reads the whole file, in large chunks). `onProgress(done, total)` in bytes / cues.
 */
export async function readMkvSubs(
  read: ReadAt,
  info: MkvInfo,
  tracks: number[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ blocks: MkvSubBlock[]; via: 'index' | 'scan' }> {
  const want = new Set(tracks);
  // Other writers (FFmpeg, Mediabunny…) index one block per cluster at most, or none: subtitles
  // would be missed. Their files are walked.
  const fromIndex = info.cuesAt !== null && /mkvmerge/i.test(info.writingApp) ? await viaCues(read, info, want, onProgress) : null;
  if (fromIndex) return { blocks: fromIndex, via: 'index' };
  return { blocks: await viaScan(read, info, want, onProgress), via: 'scan' };
}

async function viaCues(read: ReadAt, info: MkvInfo, want: Set<number>, onProgress?: (done: number, total: number) => void): Promise<MkvSubBlock[] | null> {
  const h = readHead(await read(info.cuesAt!, 16), 0);
  if (!h || h.id !== ID.cues || h.size === UNKNOWN) return null;
  if (h.size > META_MAX) return null;
  const cues = await read(info.cuesAt! + h.len, h.size);
  const spots: { cluster: number; relative: number }[] = [];
  for (const cp of children(cues)) {
    if (cp.id !== ID.cuePoint) continue;
    for (const pos of children(cues, cp.at, cp.at + cp.size)) {
      if (pos.id !== ID.cuePos) continue;
      let track = 0;
      let cluster = -1;
      let relative = -1;
      for (const c of children(cues, pos.at, pos.at + pos.size)) {
        if (c.id === ID.cueTrack) track = uint(cues, c.at, c.size);
        if (c.id === ID.cueCluster) cluster = uint(cues, c.at, c.size);
        if (c.id === ID.cueRelative) relative = uint(cues, c.at, c.size);
      }
      if (!want.has(track)) continue;
      // Without the block's place in its cluster, the index doesn't help: walk the file instead.
      if (cluster < 0 || relative < 0) return null;
      spots.push({ cluster: info.segmentStart + cluster, relative });
    }
  }
  if (!spots.length) return null;

  // Each subtitle sits in another cluster, far from the last: two small reads each (cluster
  // timestamp, block), many at once: a film's file reads are slow one by one, fast side by side.
  const clusters = new Map<number, Promise<{ ts: number; data: number } | null>>();
  const clusterAt = (pos: number) => {
    let c = clusters.get(pos);
    if (!c) {
      c = read(pos, 64).then((head) => {
        const ch = readHead(head, 0);
        const first = ch && ch.id === ID.cluster ? readHead(head, ch.len) : null;
        return ch && first && first.id === ID.timestamp ? { ts: uint(head, ch.len + first.len, first.size), data: pos + ch.len } : null;
      });
      clusters.set(pos, c);
    }
    return c;
  };
  const blocks: (MkvSubBlock | null)[] = Array.from({ length: spots.length }, () => null);
  let broken = false;
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (!broken && next < spots.length) {
      const k = next++;
      const c = await clusterAt(spots[k].cluster);
      if (!c) return void (broken = true);
      const at = c.data + spots[k].relative;
      let data = await read(at, 4096); // a subtitle block is small: usually one read
      const bh = readHead(data, 0);
      if (!bh || bh.size === UNKNOWN || (bh.id !== ID.blockGroup && bh.id !== ID.simpleBlock)) return void (broken = true);
      if (bh.size > BLOCK_MAX) {
        onProgress?.(++done, spots.length);
        continue;
      }
      if (bh.len + bh.size > data.length) data = await read(at, bh.len + bh.size);
      blocks[k] = blockOf(data, { ...bh, at: bh.len }, c.ts, info.scale, want);
      onProgress?.(++done, spots.length);
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  if (broken) return null;
  return blocks.filter((b): b is MkvSubBlock => !!b);
}

const CHUNK = 16 * 1024 * 1024;

async function viaScan(read: ReadAt, info: MkvInfo, want: Set<number>, onProgress?: (done: number, total: number) => void): Promise<MkvSubBlock[]> {
  const blocks: MkvSubBlock[] = [];
  let buf: Uint8Array = new Uint8Array(0);
  let bufAt = 0;
  // Bytes from `p`, at least `n` of them if the file has them.
  const ensure = async (p: number, n: number) => {
    if (p >= bufAt && p + n <= bufAt + buf.length) return;
    bufAt = p;
    buf = await read(p, Math.min(Math.max(n, CHUNK), info.segmentEnd - p));
  };
  let p = info.firstCluster ?? info.segmentStart;
  let clusterTs = 0;
  while (p < info.segmentEnd) {
    await ensure(p, 16);
    const h = readHead(buf, p - bufAt);
    if (!h) break;
    if (h.id === ID.cluster) {
      p += h.len; // into the cluster: its children follow
      onProgress?.(p, info.segmentEnd);
      continue;
    }
    if (h.size === UNKNOWN) break;
    if (h.id === ID.timestamp && h.size <= 8) {
      await ensure(p, h.len + h.size);
      clusterTs = uint(buf, p - bufAt + h.len, h.size);
    } else if (h.id === ID.blockGroup || h.id === ID.simpleBlock) {
      // Only the track number is needed to skip: read the whole block only for a subtitle.
      await ensure(p, h.len + 8);
      const inner = h.id === ID.simpleBlock ? p + h.len : p + h.len + (readHead(buf, p - bufAt + h.len)?.len ?? 0);
      const len = vintLength(buf[inner - bufAt]);
      let track = buf[inner - bufAt] & (0xff >> len);
      for (let i = 1; i < len; i++) track = track * 256 + buf[inner - bufAt + i];
      if (want.has(track) && h.size <= BLOCK_MAX) {
        await ensure(p, h.len + h.size);
        const sub = blockOf(buf, { ...h, at: p - bufAt + h.len }, clusterTs, info.scale, want);
        if (sub) blocks.push(sub);
      }
    }
    // Anything else (cluster position, Cues, Tags…) is skipped by its size.
    p += h.len + h.size;
  }
  return blocks;
}

/** The frame's bytes as stored before compression. */
async function unpack(data: Uint8Array, t: Pick<MkvSubTrack, 'compression' | 'strip'>): Promise<Uint8Array> {
  if (t.compression === 3 && t.strip) {
    const out = new Uint8Array(t.strip.length + data.length);
    out.set(t.strip);
    out.set(data, t.strip.length);
    return out;
  }
  if (t.compression === 0) {
    // Read piece by piece: a small block could inflate to gigabytes (a zip bomb).
    const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > BLOCK_MAX) {
        await reader.cancel();
        throw new Error('Subtitle too large once unpacked');
      }
      parts.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
  return data;
}

/**
 * Subtle cues from a text track's blocks. SRT and WebVTT frames are the text itself; ASS / SSA
 * frames are "ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text".
 */
export async function mkvCues(blocks: MkvSubBlock[], t: MkvSubTrack): Promise<Cue[]> {
  const ass = /^S_TEXT\/(ASS|SSA)$/.test(t.codec);
  const cues: Cue[] = [];
  for (const b of blocks) {
    // A frame that can't be unpacked (broken, or too large) is left out, not the whole track.
    const bytes = await unpack(b.data, t).catch(() => null);
    if (!bytes) continue;
    let text = utf8.decode(bytes).replace(/\r\n?/g, '\n');
    if (ass) text = assToText(text.split(',').slice(8).join(','));
    text = text.trim();
    if (!text) continue;
    cues.push({ id: newId(), start: b.start, end: Math.max(b.end, b.start), text });
  }
  return cues.sort((a, b) => a.start - b.start || a.end - b.end);
}
