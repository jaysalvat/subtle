/**
 * Spotting: hold Enter while someone speaks, release when they stop → an empty subtitle exactly
 * there, text typed later. Playback keeps going, so a whole scene can be spotted in one pass.
 */
import { create } from 'zustand';
import { placeSpotted } from '../lib/tools';
import { t } from '../i18n';
import { player } from './playback';
import { editField, useApp } from './store';
import { focusField } from './caret';

/**
 * `start`: when the key went down (ms), null when not spotting. `typing`: the subtitle just spotted,
 * whose text is being typed (Enter there saves and plays on).
 */
export const useSpot = create<{ start: number | null; typing: string | null }>(() => ({ start: null, typing: null }));

export function spotStart() {
  const st = useApp.getState();
  if (!st.doc && !st.videoUrl) return;
  useSpot.setState({ start: player.now() });
}

export function spotEnd() {
  const { start } = useSpot.getState();
  if (start === null) return;
  useSpot.setState({ start: null });
  const st = useApp.getState();
  const r = placeSpotted(st.doc?.cues ?? [], start, player.now(), st.settings);
  if (!r) return st.notify(t.spot.noRoom, { tone: 'warning' });
  st.commit(r.cues, t.spot.undo, [r.id]);
  if (!st.settings.spotTypeNow) return;
  // Pause and type its text now; Enter in the field saves and plays on (TextEditor in CueList).
  player.el?.pause();
  useSpot.setState({ typing: r.id });
  // Its field opens once the list has drawn the new row (the list itself may be new).
  focusField(editField(st), r.id);
}

/** Text of the spotted subtitle typed: playback goes on from where it was. */
export function spotTyped(resume: boolean) {
  useSpot.setState({ typing: null });
  if (resume) void player.el?.play();
}

export function spotCancel() {
  useSpot.setState({ start: null, typing: null });
}
