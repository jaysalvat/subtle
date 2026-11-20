/** Export file names. Video players load "my-film.srt" (and "my-film.fr.srt") next to "my-film.mp4". */

const stripExt = (name: string, exts: string) => name.replace(new RegExp(`\\.(${exts})$`, 'i'), '');

/**
 * Default name (without extension): the video's name, else the subtitle file's; a translation adds
 * its language code.
 */
export function defaultExportName(o: { video?: string | null; subtitles?: string | null; lang?: string | null }): string {
  let base = o.video ? stripExt(o.video, 'mp4|m4v|mov') : o.subtitles ? stripExt(o.subtitles, 'srt|vtt|ass|ssa|sbv|ttml|dfxp|xml') : 'subtitles';
  if (o.lang) base = `${o.video ? base : base.replace(/\.[a-z]{2,3}(-[A-Za-z]{2,4})?$/, '')}.${o.lang}`;
  return base;
}

/** A name made safe for a file: no path or forbidden characters, no leading dot; `fallback` when nothing is left. */
export function safeFileName(raw: string, fallback: string): string {
  const name = raw
    .replace(/[/\\:*?"<>|\u0000-\u001f]/g, '')
    .replace(/^\.+/, '')
    .trim();
  return name || fallback;
}

/** What the person typed, made safe: no path or forbidden characters, no doubled extension. */
export function cleanFileName(raw: string, format: string): string {
  return `${safeFileName(stripExt(raw.trim(), 'srt|vtt|ass|ssa|sbv|ttml|dfxp|xml'), 'subtitles')}.${format}`;
}

/**
 * A long file name shortened in the middle, its start and its extension kept:
 * "The.Grand.Budapest.Hotel.2014.1080p.BluRay.x264.mp4" → "The.Grand.Budap…ay.x264.mp4".
 */
export function middleEllipsis(name: string, max = 32): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : '';
  const room = max - 1;
  const tail = Math.min(name.length - ext.length, Math.ceil((room - ext.length) * 0.4)) + ext.length;
  return `${name.slice(0, room - tail)}…${name.slice(name.length - tail)}`;
}
