/**
 * Tools › Shift times: a side panel, so the subtitles move on the timeline as you shift them — over
 * the dialogue waveform, to line them up by eye. The offset: typed, −/+ (⇧: 1 s), a slider, or
 * guessed from the dialogue (on the subtitles it applies to). Nothing is kept until Apply (one undo
 * step); Cancel puts them back.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { AiPill } from './Pill';
import { formatOffset, guessOffset } from '../lib/sync';
import { scopeFilter, shiftCues, type ShiftScope } from '../lib/tools';
import { useApp } from '../store/store';
import { useWaveform } from '../store/waveform';
import { Scope } from './dialogs/Dialog';
import { OffsetInput } from './OffsetInput';
import { SidePanel } from './SidePanel';
import { PanelTransport } from './TransportButtons';

/** The slider's reach (ms); further, type it or use the buttons. */
const SLIDE_MS = 10000;

export function ShiftPanel() {
  const doc = useApp((s) => s.doc)!;
  const spans = useWaveform((s) => s.dialogue?.spans ?? null);
  const base = useRef(doc.cues).current;
  // The selection as it is now: it can change while the panel is open.
  const selected = useApp((s) => s.selection);
  const [ms, setMs] = useState(0);
  const [scope, setScope] = useState<ShiftScope>(selected.length ? 'fromSelected' : 'all');
  const [found, setFound] = useState<{ offset: number; share: number } | null | 'none'>(null);

  const preview = useMemo(() => (ms ? shiftCues(base, ms, scope, selected) : base), [base, ms, scope, selected]);
  useEffect(() => useApp.getState().previewLive(base, preview), [base, preview]);

  const close = () => useApp.getState().openDialog(null);
  const cancel = () => {
    useApp.getState().replaceLive(base);
    close();
  };
  const apply = (by = ms) => {
    if (!by) return;
    const st = useApp.getState();
    st.previewLive(base, shiftCues(base, by, scope, selected));
    st.endGesture(base, t.shift.undo(formatOffset(by)));
    close();
  };
  const set = (v: number) => {
    setMs(Math.round(v));
    setFound(null);
  };
  const guess = () => {
    // Guessed on the subtitles the shift applies to (all, the selected ones, or from the selected one).
    const g = guessOffset(base.filter(scopeFilter(base, scope, selected)), spans);
    if (!g || g.share < 0.2) return setFound('none');
    setMs(g.offset);
    setFound(g);
  };

  return (
    <SidePanel title={t.tools.shift} onClose={cancel} closeLabel={t.common.cancel}>
      <div className="side-body shift-body">
        <OffsetInput value={ms} onChange={set} onEnter={apply} label={t.shift.offsetLabel} />
        <div className="shift-slider">
          <span className="muted">{t.shift.earlier}</span>
          <input
            type="range"
            min={-SLIDE_MS}
            max={SLIDE_MS}
            step={100}
            value={Math.max(-SLIDE_MS, Math.min(SLIDE_MS, ms))}
            aria-label={t.shift.offsetLabel}
            onChange={(e) => set(Number(e.target.value))}
          />
          <span className="muted">{t.shift.later}</span>
        </div>

        <PanelTransport />
        {/* What the guess (in the footer) found, or why it can't. */}
        {found === 'none' && <p className="note flush">{t.shift.guessNone}</p>}
        {found && found !== 'none' && <p className="note flush">{t.shift.guessed(Math.round(found.share * 100))}</p>}
        {!spans && <p className="note flush">{t.shift.needDialogue}</p>}

        <Scope value={scope} onChange={setScope} allowFrom />
      </div>
      <div className="dialog-foot">
        <button className="btn shift-guess" disabled={!spans} title={spans ? t.shift.guessHint : t.shift.needDialogue} onClick={guess}>
          {t.shift.guess} <AiPill />
        </button>
        <button className="btn" onClick={cancel}>
          {t.common.cancel}
        </button>
        <button className="btn primary" disabled={!ms} onClick={() => apply()}>
          {t.shift.apply(base.filter(scopeFilter(base, scope, selected)).length, ms ? formatOffset(ms) : undefined)}
        </button>
      </div>
    </SidePanel>
  );
}
