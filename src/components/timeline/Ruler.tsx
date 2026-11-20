/** The ruler: time ticks (labels on the major ones), bookmark flags, scene note bubbles; click or drag it to seek. */
import { useMemo } from 'react';
import { formatShort, formatTimecode } from '../../lib/time';
import { goToBookmark } from '../../actions';
import { player, usePlayback } from '../../store/playback';
import { useApp } from '../../store/store';
import { SceneNoteMarks } from '../SceneNotes';

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];

export function Ruler({
  viewStart,
  pps,
  visibleMs,
  totalMs,
  xOf,
  msOf,
}: {
  viewStart: number;
  pps: number;
  visibleMs: number;
  totalMs: number;
  xOf: (ms: number) => number;
  msOf: (clientX: number) => number;
}) {
  const bookmarks = useApp((s) => s.bookmarks);
  const ticks = useMemo(() => {
    const step = STEPS.find((s) => s * pps >= 90) ?? STEPS[STEPS.length - 1];
    const minor = step / (step >= 1 && [2, 30, 120].includes(step) ? 4 : 5);
    const out: { x: number; label: string; major: boolean }[] = [];
    const from = Math.floor(viewStart / 1000 / minor) * minor;
    for (let s = from; s * 1000 <= viewStart + visibleMs; s += minor) {
      const v = Math.round(s * 1000);
      const major = Math.abs(s / step - Math.round(s / step)) < 1e-6;
      out.push({ x: ((v - viewStart) / 1000) * pps, major, label: major ? (step < 1 ? formatTimecode(v).slice(3, 10) : formatShort(v)) : '' });
    }
    return out;
  }, [viewStart, pps, visibleMs]);

  return (
    <div
      className="ruler"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        player.seek(msOf(e.clientX));
        usePlayback.getState().setFollowPaused(false);
      }}
      onPointerMove={(e) => e.buttons === 1 && player.seek(msOf(e.clientX))}
    >
      {ticks.map((k, i) => (
        <div key={i} className={`tick ${k.major ? 'major' : ''}`} style={{ left: k.x, height: k.major ? 28 : 8 }}>
          {k.label && <span>{k.label}</span>}
        </div>
      ))}
      {bookmarks
        .filter((b) => b.time >= viewStart - 1000 && b.time <= viewStart + visibleMs)
        .map((b) => (
          <button
            key={b.id}
            className="tl-bookmark tnum"
            style={{ left: xOf(b.time) }}
            title={`${b.slot}. ${b.label} (${formatTimecode(b.time).slice(0, 8)})`}
            onPointerDown={(e) => {
              e.stopPropagation();
              goToBookmark(b.time);
            }}
          >
            {b.slot <= 9 ? b.slot : '•'}
          </button>
        ))}
      <SceneNoteMarks viewStart={viewStart} visibleMs={visibleMs} totalMs={totalMs} xOf={xOf} msOf={msOf} />
    </div>
  );
}

/** Faint lines across the tracks under each bookmark. */
export function BookmarkLines({ viewStart, visibleMs, xOf }: { viewStart: number; visibleMs: number; xOf: (ms: number) => number }) {
  const bookmarks = useApp((s) => s.bookmarks);
  return (
    <>
      {bookmarks
        .filter((b) => b.time >= viewStart && b.time <= viewStart + visibleMs)
        .map((b) => (
          <div key={b.id} className="tl-bookmark-line" style={{ left: xOf(b.time) }} />
        ))}
    </>
  );
}
