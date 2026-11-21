/**
 * Tools › Lengthen short subtitles: a side panel, so the ends grow on the timeline as you set the
 * minimum. Only ends move, never past the next subtitle. The ones it can't lengthen enough are listed,
 * each number takes you there. Nothing is kept until Apply (one undo step); Cancel puts them back.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { extendToMinDuration } from '../lib/tools';
import { useToolScope } from '../store/toolRequest';
import { goToCue } from '../actions';
import { useApp } from '../store/store';
import { CueNumber } from './CueNumber';
import { Scope, useCueNumbers } from './dialogs/Dialog';
import { NumberInput } from './NumberInput';
import { SidePanel } from './SidePanel';

export function MinDurationPanel() {
  const doc = useApp((s) => s.doc)!;
  const settings = useApp((s) => s.settings);
  const base = useRef(doc.cues).current;
  // The selection as it is now: it can change while the panel is open.
  const selected = useApp((s) => s.selection);
  const [minS, setMinS] = useState(settings.minDurationMs / 1000);
  const [gap, setGap] = useState(settings.minGapMs);
  const [cpsBased, setCpsBased] = useState(settings.cpsBasedMinDuration);
  const [scope, setScope] = useToolScope('minDuration');

  const result = useMemo(
    () =>
      extendToMinDuration(
        base,
        { minMs: Math.round(minS * 1000), gapMs: gap, cpsBased, maxCps: settings.maxCps },
        scope === 'selection' ? selected : undefined,
      ),
    [base, minS, gap, cpsBased, settings.maxCps, scope, selected],
  );
  const preview = result.extended.length ? result.cues : base;
  useEffect(() => useApp.getState().previewLive(base, preview), [base, preview]);
  const byId = useCueNumbers();

  const close = () => useApp.getState().openDialog(null);
  const cancel = () => {
    useApp.getState().replaceLive(base);
    close();
  };
  const apply = () => {
    const st = useApp.getState();
    st.previewLive(base, result.cues);
    st.endGesture(base, t.tools.minDuration);
    close();
  };

  return (
    <SidePanel title={t.tools.minDuration} onClose={cancel} closeLabel={t.common.cancel}>
      <div className="side-body">
        <p className="note flush">{t.minDuration.intro}</p>
        <div className="field">
          <label>{t.minDuration.min}</label>
          <NumberInput value={minS} onChange={setMinS} step={0.1} min={0.3} label={t.minDuration.minLabel} />
        </div>
        <div className="field">
          <label>{t.minDuration.gap}</label>
          <NumberInput value={gap} onChange={setGap} step={10} min={0} label={t.minDuration.gapLabel} />
        </div>
        <label className="check">
          <input type="checkbox" checked={cpsBased} onChange={(e) => setCpsBased(e.target.checked)} />
          <span>
            {t.minDuration.cpsBased}
            <br />
            <span className="note">{t.minDuration.cpsBasedNote(settings.maxCps)}</span>
          </span>
        </label>
        <Scope value={scope} onChange={setScope} />
        <div className="summary">
          {t.minDuration.summary(result.extended.length)}
          {result.blocked.length > 0 && (
            <>
              <div>{t.minDuration.blocked(result.blocked.length)}</div>
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
        <button className="btn primary" disabled={!result.extended.length} onClick={apply}>
          {t.minDuration.apply(result.extended.length)}
        </button>
      </div>
    </SidePanel>
  );
}
