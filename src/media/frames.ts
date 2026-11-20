/**
 * Exact video frames on demand (MP4, MOV, MKV, WebM): decoded from the keyframe before a time up
 * to that time, by Mediabunny. Used for the timeline thumbnails, which would otherwise show the
 * last keyframe (seconds off). Runs in a worker; keeps the file open between requests.
 */
import { CanvasSink } from 'mediabunny';
import { openMedia, videoTrackOf } from './mediaFile';

export class FrameReader {
  private constructor(
    private sink: CanvasSink,
    private first: number,
  ) {}

  static async open(file: File, height: number): Promise<FrameReader> {
    const input = openMedia(file);
    const track = await videoTrackOf(input);
    const w = track.displayWidth || track.codedWidth || 16;
    const h = track.displayHeight || track.codedHeight || 9;
    const sink = new CanvasSink(track, { width: Math.max(1, Math.round((height * w) / h)), height, fit: 'fill', poolSize: 1 });
    return new FrameReader(sink, await track.getFirstTimestamp());
  }

  /** JPEG of the frame shown at `tMs`, or null before the first frame. */
  async frameAt(tMs: number): Promise<Blob | null> {
    if (tMs / 1000 < this.first) return null;
    const f = await this.sink.getCanvas(tMs / 1000);
    if (!f) return null;
    const c = f.canvas;
    // An OffscreenCanvas in a worker (the app), a canvas element on a page (tests, POCs).
    if ('convertToBlob' in c) return c.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
    return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.75));
  }
}
