/**
 * Dev helper: build a small H.264 film in the browser (numbered, coloured frames, a keyframe every
 * second), MP4 or MKV, to test video features without a real film. In the dev console:
 *   const { makeTestVideo } = await import('/src/dev/makeTestVideo.ts'); const file = await makeTestVideo(60);
 */
import { BufferTarget, CanvasSource, MkvOutputFormat, Mp4OutputFormat, Output } from 'mediabunny';

export async function makeTestVideo(seconds = 30, fps = 10, container: 'mp4' | 'mkv' = 'mp4'): Promise<File> {
  const width = 320;
  const height = 180;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const output = new Output({ format: container === 'mkv' ? new MkvOutputFormat() : new Mp4OutputFormat(), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 500_000, keyFrameInterval: 1 });
  output.addVideoTrack(video, { frameRate: fps });
  await output.start();
  for (let i = 0; i < seconds * fps; i++) {
    const s = Math.floor(i / fps);
    ctx.fillStyle = `hsl(${(s * 37) % 360} 60% 40%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 72px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${s}s`, width / 2, height / 2);
    await video.add(i / fps, 1 / fps);
  }
  await output.finalize();
  const bytes = output.target.buffer!;
  return new File([bytes], `test-video.${container}`, { type: container === 'mkv' ? 'video/x-matroska' : 'video/mp4' });
}
