/**
 * Opens a film with Mediabunny: MP4 / M4V / MOV, MKV, WebM. One demuxer for everything that reads
 * the video (audio, thumbnails, exact frames). Runs in workers; only the bytes needed are read.
 */
import { BlobSource, Input, MATROSKA, MP4, QTFF, WEBM } from 'mediabunny';

/** What Subtle opens (lib/files): only these readers are bundled, not Mediabunny's audio formats. */
const FORMATS = [MP4, QTFF, MATROSKA, WEBM];

export function openMedia(file: File): Input<BlobSource> {
  return new Input({ formats: FORMATS, source: new BlobSource(file) });
}

export async function videoTrackOf(input: Input) {
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('No video track.');
  if (!(await track.canDecode())) throw new Error(`The browser cannot decode this video (${track.codec ?? 'unknown codec'}).`);
  return track;
}
