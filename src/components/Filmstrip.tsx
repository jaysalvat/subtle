import { useEffect, useRef, useState, type RefObject } from 'react';
import { SceneStripBands } from './SceneNotes';
import { formatTimecode } from '../lib/time';
import { thumbAt } from '../lib/thumbs';
import { BitmapCanvas } from './BitmapCanvas';
import { player, usePlayback } from '../store/playback';
import { useApp } from '../store/store';
import { useThumbs } from '../store/thumbs';
import { frameKey, getFrame, useFrames, wantFrames } from '../store/frames';

/**
 * Colour strips built from the video keyframes:
 * - PlayerMiniStrip: the whole film above the seek bar, one flat average colour per frame (scene changes).
 * - TimelineStrip: thumbnails of the visible range in the timeline, following the zoom.
 * Both show the frame on hover and jump there on click.
 */

function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function setupCanvas(c: HTMLCanvasElement, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.max(1, Math.round(width * dpr));
  c.height = Math.round(height * dpr);
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, c.width, c.height);
  return { ctx, dpr };
}

/** Frame preview above a strip, at `x` px, for time `t`. */
/**
 * Enlarged picture under the pointer. `exact`: the same picture as the timeline strip's slot (the
 * decoded frame at `t` once it's there), not the keyframe before it, which can be seconds earlier.
 */
function StripPreview({ x, t, width, exact }: { x: number; t: number; width: number; exact?: boolean }) {
  useFrames((s) => s.version); // drawn again when the exact frame arrives
  const { times, bitmaps } = useThumbs.getState();
  const bitmap = bitmaps.length ? (exact && getFrame(frameKey(t))) || bitmaps[thumbAt(times, t)] : undefined;
  return (
    <div className="strip-preview" style={{ left: Math.min(Math.max(x, 68), width - 68) }}>
      <BitmapCanvas bitmap={bitmap} />
      <span className="tnum">{formatTimecode(t).slice(0, 8)}</span>
    </div>
  );
}

/** Keep receiving pointer events outside the element while dragging (no-op for synthetic events). */
export function capture(e: React.PointerEvent) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    /* pointer not active */
  }
}

/** Drag-to-scroll provided by the timeline. */
export interface Pan {
  start: (clientX: number) => void;
  move: (clientX: number) => boolean;
  end: () => boolean;
}

/** Pointer handlers shared by both strips: hover preview, click to seek, and drag to scroll when `pan` is given. */
function useStripPointer(timeAt: (x: number) => number, pan?: Pan) {
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const local = (e: React.PointerEvent) => e.clientX - e.currentTarget.getBoundingClientRect().left;
  const seek = (e: React.PointerEvent) => {
    player.seek(Math.max(0, timeAt(local(e))));
    usePlayback.getState().setFollowPaused(false);
  };
  return {
    hover,
    handlers: {
      onPointerMove: (e: React.PointerEvent) => {
        if (pan?.move(e.clientX)) return setHover(null);
        const x = local(e);
        setHover({ x, t: Math.max(0, timeAt(x)) });
      },
      onPointerLeave: () => setHover(null),
      onPointerDown: (e: React.PointerEvent) => {
        e.stopPropagation();
        if (e.button !== 0) return;
        if (!pan) return seek(e);
        capture(e);
        pan.start(e.clientX);
      },
      onPointerUp: (e: React.PointerEvent) => {
        if (pan && !pan.end()) seek(e);
      },
      onPointerCancel: () => pan?.end(),
    },
  };
}

const MINI_H = 16; // CSS px

export function PlayerMiniStrip() {
  const wrap = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const width = useWidth(wrap);
  const count = useThumbs((s) => s.count);
  const duration = usePlayback((s) => s.duration);
  const lastEnd = useApp((s) => (s.doc?.cues.length ? s.doc.cues[s.doc.cues.length - 1].end : 0));
  const total = Math.max(duration, lastEnd, 1);
  const { hover, handlers } = useStripPointer((x) => (x / Math.max(1, width)) * total);

  useEffect(() => {
    const c = ref.current;
    if (!c || !width) return;
    const { ctx } = setupCanvas(c, width, MINI_H);
    const { times, colors } = useThumbs.getState();
    if (!times.length) return;
    const end = Math.min(total, duration || total);
    // One flat colour per frame: no detail in height, sharp cuts between scenes.
    for (let x = 0; x < c.width; x++) {
      const t = (x / c.width) * total;
      if (t > end) break;
      const [r, g, b] = colors[thumbAt(times, t)];
      ctx.fillStyle = `rgb(${r} ${g} ${b})`;
      ctx.fillRect(x, 0, 1, c.height);
    }
  }, [count, width, total, duration]);

  return (
    <div className="mini-strip" ref={wrap} {...handlers}>
      <canvas ref={ref} aria-hidden="true" />
      <SceneStripBands totalMs={total} />
      {hover && <StripPreview x={hover.x} t={hover.t} width={width} />}
    </div>
  );
}

const TL_H = 48; // CSS px

/** Thumbnails of the visible range, between the ruler and the subtitle track. */
export function TimelineStrip({ viewStart, pps, width, pan }: { viewStart: number; pps: number; width: number; pan: Pan }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const count = useThumbs((s) => s.count);
  const framesVersion = useFrames((s) => s.version);
  const framesOn = useFrames((s) => s.available);
  const duration = usePlayback((s) => s.duration);
  const { hover, handlers } = useStripPointer((x) => viewStart + (x / pps) * 1000, pan);
  // The slot under the pointer shows the frame at its middle: the preview shows that same frame.
  const slotMiddle = (t: number) => {
    const b = useThumbs.getState().bitmaps[0];
    if (!b) return t;
    const slotMs = ((TL_H * b.width) / b.height / pps) * 1000;
    return Math.floor(t / slotMs) * slotMs + slotMs / 2;
  };

  useEffect(() => {
    const c = ref.current;
    if (!c || !width) return;
    const { ctx, dpr } = setupCanvas(c, width, TL_H);
    ctx.scale(dpr, dpr);
    const { times, bitmaps } = useThumbs.getState();
    if (!times.length) return;
    const tw = (TL_H * bitmaps[0].width) / bitmaps[0].height;
    // Slots on a time grid, so thumbnails don't shimmer while scrolling.
    const slotMs = (tw / pps) * 1000;
    const end = duration || times[times.length - 1] + slotMs;
    ctx.fillStyle = getComputedStyle(c).getPropertyValue('--scrim').trim() || 'rgba(0, 0, 0, 0.3)';
    const wanted: { key: number; t: number }[] = [];
    for (let k = Math.max(0, Math.floor(viewStart / slotMs)); ; k++) {
      const t = k * slotMs;
      const x = ((t - viewStart) / 1000) * pps;
      if (x > width || t > end) break;
      // Each slot shows the frame at its middle: exact when decoded, else the keyframe before it, dimmed.
      const mid = t + slotMs / 2;
      const key = frameKey(mid);
      const exact = getFrame(key);
      if (exact) ctx.drawImage(exact, x, 0, tw, TL_H);
      else {
        ctx.globalAlpha = 0.35;
        ctx.drawImage(bitmaps[thumbAt(times, mid)], x, 0, tw, TL_H);
        ctx.globalAlpha = 1;
        wanted.push({ key, t: mid });
      }
      ctx.fillRect(Math.round(x), 0, 1, TL_H);
    }
    wantFrames(wanted);
  }, [count, viewStart, pps, width, duration, framesVersion, framesOn]);

  return (
    <div className="tl-strip" {...handlers}>
      <canvas ref={ref} aria-hidden="true" />
      {hover && <StripPreview x={hover.x} t={slotMiddle(hover.t)} width={width} exact />}
    </div>
  );
}
