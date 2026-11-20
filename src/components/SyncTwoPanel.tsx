/**
 * Tools › Sync from two times: two subtitles far apart and when each should start → offset and
 * speed. A side panel, so the video and the timeline stay at hand: find the line, place the playhead,
 * take it. The result shows live on the timeline; nothing is kept until Apply (one undo step).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from './Alert';
import { t } from '../i18n';
import { applyLinear, linearFromAnchors } from '../lib/tools';
import { player, usePlayback } from '../store/playback';
import { useApp } from '../store/store';
import { TimeField } from './dialogs/Dialog';
import { SidePanel } from './SidePanel';
import { SubtitlePicker } from './SubtitlePicker';

export function SyncTwoPanel() {
  const doc = useApp((s) => s.doc)!;
  const base = useRef(doc.cues).current;
  const [aIdx, setAIdx] = useState(0);
  const [bIdx, setBIdx] = useState(base.length - 1);
  const [aTo, setATo] = useState(base[0].start);
  const [bTo, setBTo] = useState(base[base.length - 1].start);

  const { scale, offset } = useMemo(
    () => linearFromAnchors({ from: base[aIdx].start, to: aTo }, { from: base[bIdx].start, to: bTo }),
    [base, aIdx, bIdx, aTo, bTo],
  );
  const valid = Number.isFinite(scale) && scale > 0.5 && scale < 2;
  const changed = valid && (scale !== 1 || offset !== 0);
  const preview = useMemo(() => (changed ? applyLinear(base, scale, offset) : base), [base, changed, scale, offset]);
  useEffect(() => useApp.getState().previewLive(base, preview), [base, preview]);

  const close = () => useApp.getState().openDialog(null);
  const cancel = () => {
    useApp.getState().replaceLive(base);
    close();
  };
  const apply = () => {
    const st = useApp.getState();
    st.previewLive(base, applyLinear(base, scale, offset));
    st.endGesture(base, t.tools.sync);
    close();
  };

  // The time in the list: the video goes a little before the line (as it is in the file), to hear it come.
  const goTo = (i: number) => {
    player.seek(Math.max(0, base[i].start - 1000));
    usePlayback.getState().setFollowPaused(false);
  };
  const pickA = (i: number) => {
    setAIdx(i);
    setATo(base[i].start);
  };
  const pickB = (i: number) => {
    setBIdx(i);
    setBTo(base[i].start);
  };

  return (
    <SidePanel title={t.tools.sync} onClose={cancel} closeLabel={t.common.cancel}>
      <div className="side-body">
        {!valid && <Alert>{t.sync.unrealistic}</Alert>}
        <p className="note flush">{t.sync.intro}</p>

        <div className="group-title">{t.sync.first}</div>
        <SubtitlePicker cues={base} index={aIdx} onChange={pickA} onGo={goTo} ariaLabel={t.sync.first} />
        <div className="sync-two-at">
          <span className="muted">{t.sync.startAt}</span>
          <TimeField label={t.sync.firstTime} value={aTo} onChange={setATo} />
        </div>

        <div className="group-title">{t.sync.second}</div>
        <SubtitlePicker cues={base} index={bIdx} onChange={pickB} onGo={goTo} ariaLabel={t.sync.second} />
        <div className="sync-two-at">
          <span className="muted">{t.sync.startAt}</span>
          <TimeField label={t.sync.secondTime} value={bTo} onChange={setBTo} />
        </div>

        {valid && <p className="sync-result">{t.sync.result(scale.toFixed(5), offset)}</p>}
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={cancel}>
          {t.common.cancel}
        </button>
        <button className="btn primary" disabled={!changed} onClick={apply}>
          {t.sync.apply(base.length)}
        </button>
      </div>
    </SidePanel>
  );
}
