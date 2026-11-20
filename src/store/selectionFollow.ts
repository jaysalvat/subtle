/** Keeps the highlighted subtitle in step with the playhead (lib/tools followSelection). */
import { followSelection } from '../lib/tools';
import { usePlayback } from './playback';
import { useApp } from './store';

const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

usePlayback.subscribe((s, prev) => {
  if (s.time === prev.time) return;
  const st = useApp.getState();
  if (!st.doc || typing()) return;
  const next = followSelection(st.doc.cues, st.selection, s.time, s.duration || Infinity);
  if (next) useApp.setState({ selection: next });
});
