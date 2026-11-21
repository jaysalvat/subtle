/**
 * Tools › Balance lines: one line when the text fits, else two cut where a subtitler would
 * (pure lib/lines.ts, also behind Check quality's Fix of long lines and the machine translation's
 * line breaks). Works on the language edited while translating; All or the live selection.
 */
import { useMemo, useState } from 'react';
import { t } from '../i18n';
import { balanceLines } from '../lib/lines';
import type { ShiftScope } from '../lib/tools';
import { editField, useApp } from '../store/store';
import { DiffPreview, Scope, close } from './dialogs/Dialog';
import { NumberInput } from './NumberInput';
import { SidePanel } from './SidePanel';

export function BalancePanel() {
  const doc = useApp((s) => s.doc)!;
  const selection = useApp((s) => s.selection);
  const field = useApp(editField);
  const lang = useApp((s) => (field === 'target' ? s.translation?.targetLang : s.doc?.lang));
  const maxLineLength = useApp((s) => s.settings.maxLineLength);
  const [max, setMax] = useState(maxLineLength);
  const [scope, setScope] = useState<ShiftScope>('all');
  const result = useMemo(
    () => balanceLines(doc.cues, max, lang, field, scope === 'selection' ? selection : undefined),
    [doc.cues, max, lang, field, scope, selection],
  );
  const tb = t.balance;

  return (
    <SidePanel title={t.tools.balance} onClose={close}>
      <div className="dialog-body">
        <p className="note">{tb.intro}</p>
        <div className="field">
          <label>{tb.max}</label>
          <NumberInput value={max} min={20} max={80} label={tb.max} onChange={setMax} />
        </div>
        <Scope value={scope} onChange={setScope} />
        <div className="summary">{result.changed.length ? tb.summary(result.changed.length) : tb.none}</div>
        <DiffPreview items={result.changed} className="lines" />
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={close}>
          {t.common.cancel}
        </button>
        <button
          className="btn primary"
          disabled={!result.changed.length}
          onClick={() => {
            useApp.getState().commit(result.cues, t.tools.balance);
            close();
          }}
        >
          {tb.apply(result.changed.length)}
        </button>
      </div>
    </SidePanel>
  );
}
