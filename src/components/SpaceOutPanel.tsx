/**
 * Tools › Space out subtitles: overlaps and subtitles too close to the next one, fixed by ending them
 * earlier (never a start), live on the timeline. The ones that would get too short are listed, each
 * number takes you there. Nothing is kept until Apply (one undo step); Cancel puts them back.
 * Pure part: spaceOut in lib/tools.ts, also Check quality's fix.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { spaceOut } from '../lib/tools';
import { goToCue } from '../actions';
import { useApp } from '../store/store';
import { useToolScope } from '../store/toolRequest';
import { CueNumber } from './CueNumber';
import { Scope, useCueNumbers } from './dialogs/Dialog';
import { NumberInput } from './NumberInput';
import { SidePanel } from './SidePanel';

export function SpaceOutPanel() {
  const doc = useApp((s) => s.doc)!;
  const minGapMs = useApp((s) => s.settings.minGapMs);
  const base = useRef(doc.cues).current;
  // The selection as it is now: it can change while the panel is open.
  const selected = useApp((s) => s.selection);
  const [gap, setGap] = useState(minGapMs);
  const [scope, setScope] = useToolScope('spaceOut');

  const result = useMemo(() => spaceOut(base, gap, scope === 'selection' ? selected : undefined), [base, gap, scope, selected]);
  const preview = result.spaced.length ? result.cues : base;
  useEffect(() => useApp.getState().previewLive(base, preview), [base, preview]);
  const byId = useCueNumbers();
  const ts = t.spaceOut;

  const close = () => useApp.getState().openDialog(null);
  const cancel = () => {
    useApp.getState().replaceLive(base);
    close();
  };
  const apply = () => {
    const st = useApp.getState();
    st.previewLive(base, result.cues);
    st.endGesture(base, t.tools.spaceOut);
    close();
  };

  return (
    <SidePanel title={t.tools.spaceOut} onClose={cancel} closeLabel={t.common.cancel}>
      <div className="side-body">
        <p className="note flush">{ts.intro}</p>
        <div className="field">
          <label>{ts.gap}</label>
          <NumberInput value={gap} onChange={setGap} step={10} min={0} label={ts.gap} />
        </div>
        <Scope value={scope} onChange={setScope} />
        <div className="summary">
          {ts.summary(result.spaced.length)}
          {result.blocked.length > 0 && (
            <>
              <div>{ts.blocked(result.blocked.length)}</div>
              <div className="cue-n-list">
                {result.blocked.map((id) => (
                  <CueNumber key={id} n={byId.get(id) ?? 0} onGo={() => goToCue(id)} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={cancel}>
          {t.common.cancel}
        </button>
        <button className="btn primary" disabled={!result.spaced.length} onClick={apply}>
          {ts.apply(result.spaced.length)}
        </button>
      </div>
    </SidePanel>
  );
}
