/**
 * Playback loop (button in the transport bar, L key). Runs off the per-frame playback time.
 * Navigating elsewhere moves the loop there; only the button / L stops it.
 * A side panel can set how the next loop is chosen (e.g. "Sync by ear" loops around the playhead
 * before a line is placed).
 */
import { create } from 'zustand';
import { loopAround, loopAt, loopRange, loopStep, type Loop } from '../lib/loop';
import { cueAt } from '../lib/tools';
import { player, usePlayback } from './playback';
import { useApp } from './store';

export const useLoop = create<{ loop: Loop | null }>(() => ({ loop: null }));

let chooser: (() => Loop) | null = null;
/** Let a panel decide what the loop button loops; null for the default. */
export function setLoopChooser(fn: (() => Loop) | null) {
  chooser = fn;
}

export function startLoop(loop: Loop) {
  const range = loopRange(loop, useApp.getState().doc?.cues ?? []);
  if (!range) return;
  useLoop.setState({ loop });
  player.seek(range.from);
  usePlayback.getState().setFollowPaused(false);
  player.play();
}

export function stopLoop(pause = true) {
  if (!useLoop.getState().loop) return;
  useLoop.setState({ loop: null });
  if (pause) player.pause();
}

/** Default: the selected subtitle, else the one under the playhead, else 3 s around the playhead. */
function defaultLoop(): Loop {
  const { doc, selection } = useApp.getState();
  const cues = doc?.cues ?? [];
  const now = player.now();
  if (selection.length === 1) return { cue: selection[0] };
  const i = cueAt(cues, now);
  return i >= 0 ? { cue: cues[i].id } : loopAround(now);
}

export function toggleLoop() {
  if (useLoop.getState().loop) stopLoop();
  else startLoop(chooser ? chooser() : defaultLoop());
}

// Driver: every frame, wrap at the end of the range or stop when you've gone elsewhere.
usePlayback.subscribe((s, prev) => {
  const { loop } = useLoop.getState();
  if (!loop || s.time === prev.time) return;
  const range = loopRange(loop, useApp.getState().doc?.cues ?? []);
  if (!range) return stopLoop(false);
  const step = loopStep(range, s.time);
  if (step === 'wrap') player.seek(range.from);
  else if (step === 'move') {
    // You went elsewhere (click, arrows, next subtitle…): the loop follows you there.
    const cues = useApp.getState().doc?.cues ?? [];
    const i = cueAt(cues, s.time);
    useLoop.setState({ loop: loopAt(loop, s.time, i >= 0 ? cues[i].id : null) });
  }
});
