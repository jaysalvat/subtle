/**
 * Dragging subtitle blocks: an edge retimes (stops at the neighbour, ⇧ pushes it), the block
 * moves (a multiple selection moves together), snapping to the playhead and neighbours (⌥: off).
 * A click without moving selects (⌘ / ⇧ add) or goes to the subtitle.
 */
import { useRef, useState } from 'react';
import { t } from '../../i18n';
import { moveCuesBy, retime } from '../../lib/tools';
import { snapNear, snapPoints, type SnapPoint } from '../../lib/snap';
import { useWaveform } from '../../store/waveform';
import type { Cue } from '../../lib/types';
import { goToCue } from '../../actions';
import { player } from '../../store/playback';
import { useApp } from '../../store/store';
import { capture } from '../Filmstrip';

const SNAP_PX = 8;

export type DragMode = 'start' | 'end' | 'move';
interface Drag {
  id: string;
  mode: DragMode;
  base: Cue[];
  grabOffsetMs: number;
  startX: number;
  moved: boolean;
  additive: 'toggle' | 'range' | null;
  /** Moving a block of a multiple selection: all of them move together. */
  group: string[] | null;
  /** The playhead when the drag began (it then follows the dragged edge). */
  playhead: number;
}

export function useCueDrag({
  cues,
  shown,
  pps,
  msOf,
  onStart,
}: {
  cues: Cue[];
  shown: Cue[];
  pps: number;
  msOf: (clientX: number) => number;
  onStart?: () => void;
}) {
  const dragRef = useRef<Drag | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const raf = useRef(0);

  /** The point the magnet catches near `ms`, or null (off, ⌥ held, nothing in reach). */
  const snap = (d: Drag, ms: number, alt: boolean): SnapPoint | null => {
    const { settings } = useApp.getState();
    if (!settings.snapping || alt) return null;
    const others = shown.filter((c) => c.id !== d.id && !d.group?.includes(c.id));
    // Speech edges only while the dialogue waveform shows: no catching on what can't be seen.
    const speech = settings.showWaveform ? (useWaveform.getState().dialogue?.spans ?? []) : [];
    return snapNear(ms, snapPoints(d.playhead, others, settings.minGapMs, speech), (SNAP_PX / pps) * 1000);
  };

  const onBlockUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDraggingId(null);
    if (!d) return;
    const st = useApp.getState();
    if (!d.moved) {
      if (d.additive) st.select(d.id, d.additive);
      // The keyboard stays on the timeline (Space, Delete, arrows); Enter starts typing.
      else goToCue(d.id);
      return;
    }
    st.endGesture(d.base, d.group ? t.list.moveGroupUndo : d.mode === 'move' ? t.list.moveUndo : t.list.retimeUndo);
  };

  const onBlockDown = (e: React.PointerEvent, c: Cue, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    capture(e);
    const { selection } = useApp.getState();
    const solo = !e.metaKey && !e.ctrlKey && !e.shiftKey;
    dragRef.current = {
      id: c.id,
      mode,
      base: cues,
      grabOffsetMs: msOf(e.clientX) - c.start,
      startX: e.clientX,
      moved: false,
      additive: e.metaKey || e.ctrlKey ? 'toggle' : e.shiftKey ? 'range' : null,
      group: mode === 'move' && solo && selection.length > 1 && selection.includes(c.id) ? [...selection] : null,
      playhead: player.now(),
    };
    // The release can be missed by the block (redrawn mid-drag, released elsewhere): the window
    // always ends the drag, so the block never follows a mouse whose button is up.
    const end = () => {
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      onBlockUp();
    };
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
  };

  const onBlockMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    // Button already up (its release was missed): end here instead of dragging on.
    if (!(e.buttons & 1)) return onBlockUp();
    if (!d.moved && Math.abs(e.clientX - d.startX) < 3) return;
    const st = useApp.getState();
    if (!d.moved) {
      d.moved = true;
      setDraggingId(d.id);
      if (!st.selection.includes(d.id)) st.select(d.id);
      onStart?.();
    }
    const tms = msOf(e.clientX);
    const c = d.base.find((x) => x.id === d.id)!;
    let value: number;
    if (d.mode === 'move') {
      // The block's start or, failing that, its end can catch.
      const start = tms - d.grabOffsetMs;
      const dur = c.end - c.start;
      const byStart = snap(d, start, e.altKey);
      const byEnd = byStart ? null : snap(d, start + dur, e.altKey);
      value = byStart ? byStart.at : byEnd ? byEnd.at - dur : start;
    } else {
      value = snap(d, tms, e.altKey)?.at ?? tms;
    }
    // A multiple selection moves together (stops at the first subtitle not moving). An edge stops
    // at the neighbour; with ⇧ held it pushes the neighbour's edge.
    const next = d.group
      ? moveCuesBy(d.base, d.group, Math.round(value - c.start), st.settings)
      : retime(d.base, d.id, d.mode, value, st.settings, d.mode !== 'move' && e.shiftKey);
    st.replaceLive(next);
    const moved = next.find((x) => x.id === d.id)!;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => player.seek(d.mode === 'end' ? moved.end - 1 : moved.start));
  };

  return { draggingId, dragging: () => !!dragRef.current, onBlockDown, onBlockMove };
}
