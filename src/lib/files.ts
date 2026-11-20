/**
 * Which files Subtle opens. Videos: MP4, M4V, MOV, MKV, WebM, all read by one demuxer (Mediabunny,
 * src/media). What plays depends on Chrome's decoders (no DTS sound, for one).
 */

export const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/x-matroska,video/webm,.mp4,.m4v,.mov,.mkv,.webm';
export const SUBS_ACCEPT = '.srt,.vtt,.ass,.ssa,.sbv,.ttml,.dfxp,.xml,text/vtt,application/x-subrip,.zip,application/zip';

export function isSubtitleFile(f: { name: string }): boolean {
  return /\.(srt|vtt|ass|ssa|sbv|ttml|dfxp)$/i.test(f.name);
}

/** A .zip: subtitle sites hand them out (src/lib/zip.ts, store/zipSubs.ts). */
export function isZipFile(f: { name: string; type?: string }): boolean {
  return /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed';
}

/** Matroska (MKV, WebM): may carry subtitle tracks (src/lib/mkv.ts). */
export function isMkvFile(f: { name: string; type: string }): boolean {
  return ['video/x-matroska', 'video/webm'].includes(f.type) || /\.(mkv|webm)$/i.test(f.name);
}

export function isVideoFile(f: { name: string; type: string }): boolean {
  return isMkvFile(f) || /\.(mp4|m4v|mov)$/i.test(f.name) || ['video/mp4', 'video/quicktime'].includes(f.type);
}
