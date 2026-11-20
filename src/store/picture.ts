/**
 * Pictures of the film: the frame shown (bookmarks, "Use this frame" for the project), or the frame
 * at a time, read by a hidden video so the player isn't moved (the project's picture, taken at 10 %
 * of the film when none was chosen).
 */
import { player } from './playback';
import { useApp } from './store';

/** The video's current frame as a JPEG data URL, `width` px wide. */
export async function drawFrame(v: HTMLVideoElement, width: number): Promise<string | null> {
  if (!v.videoWidth) return null;
  try {
    const h = Math.round((width * v.videoHeight) / v.videoWidth);
    const c = new OffscreenCanvas(width, h);
    c.getContext('2d')!.drawImage(v, 0, 0, width, h);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
    return await new Promise<string>((ok, ko) => {
      const r = new FileReader();
      r.onload = () => ok(r.result as string);
      r.onerror = ko;
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const PICTURE_W = 320;

/** The frame at `ms` in the film at `url`, without touching the player. */
async function pictureAt(url: string, ms: number): Promise<string | null> {
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await new Promise<void>((ok, ko) => {
      v.onloadeddata = () => ok();
      v.onerror = () => ko(new Error('video'));
    });
    await new Promise<void>((ok, ko) => {
      v.onseeked = () => ok();
      v.onerror = () => ko(new Error('seek'));
      v.currentTime = ms / 1000;
    });
    return await drawFrame(v, PICTURE_W);
  } catch {
    return null;
  } finally {
    v.removeAttribute('src');
    v.load();
  }
}

/** The frame shown in the player becomes the project's picture. */
export async function frameAsPicture(): Promise<boolean> {
  const img = player.el ? await drawFrame(player.el, PICTURE_W) : null;
  if (img) useApp.setState({ projectPicture: img, pictureChosen: true });
  return !!img;
}

/** The frame at `ms` becomes the project's picture (chosen in the film's strip). */
export async function choosePictureAt(ms: number): Promise<boolean> {
  const url = useApp.getState().videoUrl;
  const img = url ? await pictureAt(url, ms) : null;
  if (img) useApp.setState({ projectPicture: img, pictureChosen: true });
  return !!img;
}

// A film whose length is known, in a project without a picture (a new one, or one opened with
// this film): one is taken at 10 %, past the opening black.
let taking: string | null = null;
let failed: string | null = null;
useApp.subscribe((s) => {
  const { video, videoUrl } = s;
  if (!video?.durationMs || !videoUrl || s.projectPicture || taking === videoUrl || failed === videoUrl) return;
  taking = videoUrl;
  void pictureAt(videoUrl, video.durationMs * 0.1).then((img) => {
    taking = null;
    if (!img) failed = videoUrl;
    const now = useApp.getState();
    if (img && now.videoUrl === videoUrl && !now.projectPicture) useApp.setState({ projectPicture: img, pictureChosen: false });
  });
});
