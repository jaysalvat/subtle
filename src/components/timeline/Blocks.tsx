/**
 * The subtitle blocks in view (and the one being spotted): selected, HI, with a problem, at the
 * top; while translating they follow the player's Show menu. Subscribes to what it draws itself, so
 * the rest of the timeline doesn't redraw when a setting or the selection changes.
 */
import { useMemo } from 'react';
import { t } from '../../i18n';
import { isTop } from '../../lib/position';
import { collectIssues } from '../../lib/tools';
import { viewOf } from '../../lib/translation';
import type { Cue } from '../../lib/types';
import { usePlayback } from '../../store/playback';
import { useSpot } from '../../store/spot';
import { toolSide, useApp } from '../../store/store';
import type { DragMode } from './useCueDrag';

const plain = (s: string) => s.replace(/\{\\[^}]*\}|<[^>]+>/g, '');

export function Blocks({
  shown,
  xOf,
  pps,
  draggingId,
  onBlockDown,
  onBlockMove,
  onHover,
}: {
  shown: Cue[];
  xOf: (ms: number) => number;
  pps: number;
  draggingId: string | null;
  onBlockDown: (e: React.PointerEvent, c: Cue, mode: DragMode) => void;
  onBlockMove: (e: React.PointerEvent) => void;
  /** Pointer over a block (its time shown under it), null when it leaves. */
  onHover: (c: Cue | null, e?: React.MouseEvent) => void;
}) {
  const cues = useApp((s) => s.doc?.cues);
  const selection = useApp((s) => s.selection);
  const settings = useApp((s) => s.settings);
  const translation = useApp((s) => s.translation);
  const display = useApp((s) => s.display);
  // Checks follow the language edited while translating.
  const side = useApp(toolSide);
  const sel = useMemo(() => new Set(selection), [selection]);
  const issues = useMemo(() => {
    const m = new Set<string>();
    if (!settings.showIssues || !cues) return m;
    for (const [id, k] of collectIssues(viewOf(cues, side), settings)) if (k.some((x) => x !== 'hi')) m.add(id);
    return m;
  }, [cues, settings, side]);

  return (
    <>
      <SpotGhost xOf={xOf} pps={pps} />
      {shown.map((c) => {
        const isSel = sel.has(c.id);
        const isHi = /\[[^\]]*\]|♪/.test(c.text);
        const hasTarget = !!c.target?.trim();
        const mode = translation ? display : 'source';
        const main = mode === 'source' || !hasTarget ? c.text : c.target!;
        const dim = mode !== 'source' && !hasTarget; // no translation yet: the source, faded
        return (
          <div
            key={c.id}
            className={`block ${isSel ? 'selected' : ''} ${isHi ? 'hi' : ''} ${issues.has(c.id) ? 'warn' : ''} ${draggingId === c.id ? 'dragging' : ''} ${isTop(c) ? 'top' : ''}`}
            style={{ left: xOf(c.start), width: Math.max(2, ((c.end - c.start) / 1000) * pps) }}
            onPointerDown={(e) => onBlockDown(e, c, 'move')}
            onPointerMove={onBlockMove}
            onMouseEnter={(e) => onHover(c, e)}
            onMouseLeave={() => onHover(null)}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <span className="block-text" style={{ opacity: dim ? 0.5 : 1 }}>
              {plain(main)}
              {mode === 'both' && hasTarget && <span className="block-src">{plain(c.text)}</span>}
            </span>
            <div className="handle l" onPointerDown={(e) => onBlockDown(e, c, 'start')} onPointerMove={onBlockMove} />
            <div className="handle r" onPointerDown={(e) => onBlockDown(e, c, 'end')} onPointerMove={onBlockMove} />
          </div>
        );
      })}
    </>
  );
}

/** While Enter is held (spotting): the subtitle being spotted, growing with the playhead. */
function SpotGhost({ xOf, pps }: { xOf: (ms: number) => number; pps: number }) {
  const start = useSpot((s) => s.start);
  const now = usePlayback((s) => (start === null ? 0 : s.time));
  if (start === null) return null;
  const a = Math.min(start, now);
  const b = Math.max(start, now);
  return (
    <div className="block spot-ghost" style={{ left: xOf(a), width: Math.max(2, ((b - a) / 1000) * pps) }} title={t.spot.live}>
      {t.spot.live}
    </div>
  );
}
