/**
 * The timeline's view: its width, zoom (pixels per second) and first visible moment; the playhead
 * placed every frame (straight on the DOM) with the view paging along; the selected subtitle brought
 * into view; wheel to scroll, ⌘ wheel and the buttons to zoom.
 */
import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import type { Cue } from '../../lib/types';
import { player, usePlayback } from '../../store/playback';

export const MIN_PPS = 4; // px per second
export const MAX_PPS = 800;

export function useTimelineView({
  bodyRef,
  playheadRef,
  cues,
  lastSelected,
  totalMs,
  shown,
  busy,
}: {
  bodyRef: RefObject<HTMLDivElement | null>;
  playheadRef: RefObject<HTMLDivElement | null>;
  cues: Cue[];
  /** The last selected subtitle: brought into view when it changes from elsewhere. */
  lastSelected: string | undefined;
  totalMs: number;
  /** Whether the timeline is drawn (its body exists). */
  shown: boolean;
  /** A block is being dragged: the view doesn't page meanwhile. */
  busy: () => boolean;
}) {
  const [width, setWidth] = useState(1200);
  const [pps, setPps] = useState(100);
  const [viewStart, setViewStart] = useState(0);
  const [follow, setFollow] = useState(true);
  const visibleMs = (width / pps) * 1000;

  const clampView = useCallback((v: number) => Math.max(0, Math.min(v, Math.max(0, totalMs - visibleMs * 0.5))), [totalMs, visibleMs]);
  const xOf = (ms: number) => ((ms - viewStart) / 1000) * pps;
  const msOf = (clientX: number) => {
    const r = bodyRef.current!.getBoundingClientRect();
    return viewStart + ((clientX - r.left) / pps) * 1000;
  };

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  // Playhead: moved directly on the DOM every frame, the view pages when it gets near the edge.
  useEffect(() => {
    const place = (time: number) => {
      if (playheadRef.current) playheadRef.current.style.transform = `translateX(${((time - viewStart) / 1000) * pps}px)`;
    };
    place(usePlayback.getState().time);
    return usePlayback.subscribe((s) => {
      place(s.time);
      if (!follow || s.followPaused || busy()) return;
      const tt = s.time;
      if (tt < viewStart || tt > viewStart + visibleMs * 0.9) setViewStart(clampView(tt - visibleMs * (s.playing ? 0.1 : 0.3)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewStart, pps, visibleMs, follow, clampView]);

  // Bring the selected cue into view when it changes from elsewhere (list, keys).
  useEffect(() => {
    if (!lastSelected || busy()) return;
    const c = cues.find((x) => x.id === lastSelected);
    if (!c) return;
    if (c.end < viewStart || c.start > viewStart + visibleMs) setViewStart(clampView(c.start - visibleMs * 0.3));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSelected]);

  const onWheel = (e: React.WheelEvent) => {
    if (e.metaKey || e.ctrlKey) {
      const at = msOf(e.clientX);
      const nextPps = Math.min(MAX_PPS, Math.max(MIN_PPS, pps * Math.exp(-e.deltaY * 0.002)));
      const r = bodyRef.current!.getBoundingClientRect();
      setPps(nextPps);
      setViewStart(Math.max(0, at - ((e.clientX - r.left) / nextPps) * 1000));
      return;
    }
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    setViewStart((v) => clampView(v + (delta / pps) * 1000));
    usePlayback.getState().setFollowPaused(true);
  };

  /** Zoom around the playhead (the − / + buttons). */
  const zoomTo = (next: number) => {
    const center = player.now();
    const n = Math.min(MAX_PPS, Math.max(MIN_PPS, next));
    setPps(n);
    setViewStart(Math.max(0, center - ((width / n) * 1000) / 2));
  };

  return { width, pps, viewStart, setViewStart, visibleMs, clampView, xOf, msOf, onWheel, zoomTo, follow, setFollow };
}
