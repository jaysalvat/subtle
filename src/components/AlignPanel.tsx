/**
 * Tools › Align on the dialogue: a side panel, so the subtitles move on the timeline over the dialogue
 * waveform as you set how far they may go. Starts and ends go to the voices they touch (`alignToSpeech`).
 * Nothing is kept until Apply (one undo step); Cancel puts them back.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { alignToSpeech } from '../lib/align';
import { scopeFilter, type ShiftScope } from '../lib/tools';
import { useApp } from '../store/store';
import { useWaveform } from '../store/waveform';
import { Scope } from './dialogs/Dialog';
import { NumberInput } from './NumberInput';
import { SidePanel } from './SidePanel';

export function AlignPanel() {
  const doc = useApp((s) => s.doc)!;
  const settings = useApp((s) => s.settings);
  const spans = useWaveform((s) => s.dialogue?.spans ?? null);
  const base = useRef(doc.cues).current;
  // The selection as it is now: it can change while the panel is open.
  const selected = useApp((s) => s.selection);
  const [maxS, setMaxS] = useState(1);
  const [starts, setStarts] = useState(true);
  const [ends, setEnds] = useState(true);
  const [scope, setScope] = useState<ShiftScope>(selected.length > 1 ? 'selection' : 'all');

  const result = useMemo(() => {
    const ids = scope === 'all' ? undefined : base.filter(scopeFilter(base, scope, selected)).map((c) => c.id);
    return alignToSpeech(base, spans ?? [], { maxMs: Math.round(maxS * 1000), starts, ends, gapMs: settings.minGapMs, floorMs: settings.floorDurationMs }, ids);
  }, [base, spans, maxS, starts, ends, scope, selected, settings.minGapMs, settings.floorDurationMs]);
  const preview = result.moved.length ? result.cues : base;
  useEffect(() => useApp.getState().previewLive(base, preview), [base, preview]);

  const close = () => useApp.getState().openDialog(null);
  const cancel = () => {
    useApp.getState().replaceLive(base);
    close();
  };
  const apply = () => {
    const st = useApp.getState();
    st.previewLive(base, result.cues);
    st.endGesture(base, t.tools.align);
    close();
  };

  return (
    <SidePanel title={t.tools.align} onClose={cancel} closeLabel={t.common.cancel}>
      <div className="side-body">
        <p className="note flush">{spans ? t.align.intro : t.shift.needDialogue}</p>
        <div className="align-edges">
          <label className="check">
            <input type="checkbox" checked={starts} onChange={(e) => setStarts(e.target.checked)} />
            <span>{t.align.starts}</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={ends} onChange={(e) => setEnds(e.target.checked)} />
            <span>{t.align.ends}</span>
          </label>
        </div>
        <div className="field">
          <label>{t.align.maxMove}</label>
          <NumberInput value={maxS} onChange={setMaxS} step={0.1} min={0.1} max={5} label={t.align.maxMoveLabel} />
        </div>
        <Scope value={scope} onChange={setScope} />
        {spans && <div className="summary">{t.align.summary(result.moved.length)}</div>}
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={cancel}>
          {t.common.cancel}
        </button>
        <button className="btn primary" disabled={!result.moved.length} onClick={apply}>
          {t.align.apply(result.moved.length)}
        </button>
      </div>
    </SidePanel>
  );
}
