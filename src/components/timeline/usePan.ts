/**
 * Drag an empty spot (or the thumbnails) to scroll the timeline, a click without moving seeks; the
 * middle button scrolls from anywhere, even over blocks or the ruler. ⇧-drag an empty spot: select
 * the subtitles it spans (`band`, drawn by Timeline); near an edge the timeline scrolls on by itself.
 */
import { useEffect, useRef, useState } from 'react';
import { cuesInSpan } from '../../lib/tools';
import { player, usePlayback } from '../../store/playback';
import { useApp } from '../../store/store';
import { capture } from '../Filmstrip';

/** ⇧-drag: how close to an edge scrolling starts, and its speed there (px per frame). */
const EDGE_PX = 48;
const SCROLL_PX = 14;

export function usePan({
  viewStart,
  pps,
  clampView,
  setViewStart,
  msOf,
}: {
  viewStart: number;
  pps: number;
  clampView: (v: number) => number;
  setViewStart: (v: number) => void;
  msOf: (clientX: number) => number;
}) {
  const panRef = useRef<{ x: number; view: number; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);
  /** ⇧-drag: the span being selected, in ms. */
  const [band, setBand] = useState<{ from: number; to: number } | null>(null);
  const bandRef = useRef<{ from: number; to: number; keep: string[] } | null>(null);
  // ⇧ still held since the last ⇧-drag: the next one adds to what it selected.
  const kept = useRef<string[] | null>(null);
  useEffect(() => {
    const forget = () => (kept.current = null);
    const up = (e: KeyboardEvent) => e.key === 'Shift' && forget();
    window.addEventListener('keyup', up);
    window.addEventListener('blur', forget);
    return () => {
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', forget);
    };
  }, []);
  const setSpan = (v: { from: number; to: number; keep: string[] } | null) => {
    bandRef.current = v;
    setBand(v);
    if (v) {
      const st = useApp.getState();
      st.setSelection([...new Set([...v.keep, ...cuesInSpan(st.doc?.cues ?? [], v.from, v.to)])]);
    }
  };
  const setFollowPaused = (v: boolean) => usePlayback.getState().setFollowPaused(v);

  // ⇧-drag near an edge: the timeline scrolls on by itself, the band follows.
  const view = useRef(viewStart);
  view.current = viewStart;
  const edge = useRef<{ x: number; left: number; right: number; offsetMs: number } | null>(null);
  const raf = useRef(0);
  const scrollTick = () => {
    raf.current = 0;
    const b = bandRef.current;
    const g = edge.current;
    if (!b || !g) return;
    const d = g.x < g.left + EDGE_PX ? g.x - (g.left + EDGE_PX) : g.x > g.right - EDGE_PX ? g.x - (g.right - EDGE_PX) : 0;
    if (!d) return;
    const step = ((Math.max(-1.5, Math.min(1.5, d / EDGE_PX)) * SCROLL_PX) / pps) * 1000;
    const v = clampView(view.current + step);
    if (v === view.current) return;
    view.current = v;
    setViewStart(v);
    setSpan({ ...b, to: v + g.offsetMs });
    raf.current = requestAnimationFrame(scrollTick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const pan = {
    start: (clientX: number) => {
      panRef.current = { x: clientX, view: viewStart, moved: false };
    },
    /** Returns true once the pointer has moved enough to count as a drag. */
    move: (clientX: number) => {
      const p = panRef.current;
      if (!p) return false;
      const dx = clientX - p.x;
      if (!p.moved && Math.abs(dx) < 4) return false;
      if (!p.moved) {
        p.moved = true;
        setPanning(true);
        setFollowPaused(true);
      }
      setViewStart(clampView(p.view - (dx / pps) * 1000));
      return true;
    },
    /** Returns true if it was a drag (so the click action is skipped). */
    end: () => {
      const moved = !!panRef.current?.moved;
      panRef.current = null;
      setPanning(false);
      return moved;
    },
  };

  const startBand = (e: React.PointerEvent) => {
    capture(e);
    const at = msOf(e.clientX);
    bandRef.current = { from: at, to: at, keep: kept.current ?? [] };
  };

  const track = {
    // ⇧ still held after a ⇧-drag: still selecting, even from a block (no move, no push).
    onPointerDownCapture: (e: React.PointerEvent) => {
      if (e.button !== 0 || !e.shiftKey || !kept.current || e.target === e.currentTarget) return;
      e.stopPropagation();
      startBand(e);
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || e.target !== e.currentTarget) return;
      if (e.shiftKey) return startBand(e);
      capture(e);
      pan.start(e.clientX);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (bandRef.current) {
        const to = msOf(e.clientX);
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        edge.current = { x: e.clientX, left: r.left, right: r.right, offsetMs: to - viewStart };
        setSpan({ ...bandRef.current, to });
        if (!raf.current) raf.current = requestAnimationFrame(scrollTick);
      } else if (panRef.current) pan.move(e.clientX);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (bandRef.current) {
        if (e.shiftKey) kept.current = useApp.getState().selection;
        edge.current = null;
        setSpan(null);
        return;
      }
      if (!panRef.current) return;
      if (!pan.end()) {
        player.seek(msOf(e.clientX));
        setFollowPaused(false);
      }
    },
    onPointerCancel: () => {
      edge.current = null;
      setSpan(null);
      pan.end();
    },
  };

  const body = {
    onPointerDownCapture: (e: React.PointerEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      capture(e);
      pan.start(e.clientX);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (panRef.current && e.buttons & 4) pan.move(e.clientX);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (e.button === 1) pan.end();
    },
  };

  return { pan, panning, band, track, body };
}
