/**
 * Small thumbnails from the keyframes of a film's video track (MP4, MOV, MKV, WebM). Keyframes
 * decode on their own, so only their bytes are read, found through the file's index. Runs in a worker.
 */
import { EncodedPacketSink, type EncodedPacket } from 'mediabunny';
import { videoFrameRate } from '../lib/fps';
import { thumbGapMs } from '../lib/thumbs';
import { openMedia, videoTrackOf } from './mediaFile';

export interface ThumbCallbacks {
  /** Video frame rate, as soon as the headers are read (before any decoding). */
  onInfo?: (fps: number | null) => void;
  /** JPEG thumbnail. A Blob (real bytes), not an ImageBitmap tied to the decoder's frame. */
  onThumb: (timeMs: number, jpeg: Blob) => void;
  onProgress?: (done: number, total: number) => void;
}

const STEPS = 1000;

export async function readThumbs(file: File, height: number, cb: ThumbCallbacks): Promise<void> {
  const input = openMedia(file);
  try {
    const track = await videoTrackOf(input);
    // The frame rate from the first few hundred frames: no need to go through a whole MKV.
    const stats = await track.computePacketStats(300);
    cb.onInfo?.(stats.averagePacketRate > 0 ? videoFrameRate(stats.packetCount, (stats.packetCount / stats.averagePacketRate) * 1000) : null);
    const durationMs = (await track.computeDuration()) * 1000;
    const gapMs = thumbGapMs(durationMs);

    const config = await track.getDecoderConfig();
    if (!config) throw new Error(`The browser cannot decode this video (${track.codec ?? 'unknown codec'}).`);
    const w = track.displayWidth || track.codedWidth || 16;
    const h = track.displayHeight || track.codedHeight || 9;
    const resizeWidth = Math.max(1, Math.round((height * w) / h));
    const canvas = new OffscreenCanvas(resizeWidth, height);
    const ctx = canvas.getContext('2d')!;
    let pending = Promise.resolve();
    let decodeError: Error | null = null;
    const decoder = new VideoDecoder({
      output: (frame) => {
        const t = frame.timestamp / 1000;
        // Copy the pixels now, then release the frame: the decoder reuses its memory.
        ctx.drawImage(frame, 0, 0, resizeWidth, height);
        frame.close();
        const jpeg = canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
        pending = pending.then(() => jpeg.then((b) => cb.onThumb(t, b)));
      },
      error: (e) => (decodeError = e instanceof Error ? e : new Error(String(e))),
    });
    decoder.configure({ ...config, optimizeForLatency: true });

    // A keyframe at least `gapMs` after the previous one, found through the index.
    const packets = new EncodedPacketSink(track);
    let key: EncodedPacket | null = await packets.getKeyPacket(0);
    key ??= await packets.getFirstPacket();
    // `decodeError` is set by the decoder's error callback, outside the loop.
    // oxlint-disable-next-line no-unmodified-loop-condition
    while (key && !decodeError) {
      decoder.decode(key.toEncodedVideoChunk());
      // Each keyframe is independent: flushing keeps the decoder from holding frames back.
      await decoder.flush().catch(() => {});
      cb.onProgress?.(Math.min(STEPS, Math.round(((key.timestamp * 1000) / durationMs) * STEPS)), STEPS);
      // The last keyframe before the next slot, else (sparse keyframes, end of film) the one after.
      let next: EncodedPacket | null = await packets.getKeyPacket(key.timestamp + gapMs / 1000);
      if (next && next.timestamp < key.timestamp + gapMs / 1000 - 1e-3) next = await packets.getNextKeyPacket(next);
      key = next;
    }
    cb.onProgress?.(STEPS, STEPS);
    await pending;
    decoder.close();
    if (decodeError) throw decodeError;
  } finally {
    input.dispose();
  }
}
