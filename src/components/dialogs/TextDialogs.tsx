/** Text tools: Remove HI tags, Fix punctuation, Find and replace. */
import { DEFAULT_REPLACE, findReplace, type ReplaceOptions } from '../../lib/replace';
import {
  DEFAULT_PUNCT,
  fixPunctuation,
  netflixPunct,
  punctStyleFor,
  samePunct,
  type DashStyle,
  type EllipsisStyle,
  type PunctOptions,
  type PunctStyle,
  type QuoteStyle,
} from '../../lib/punctuation';
import { useMemo, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { SidePanel } from '../SidePanel';
import { cleanHi, DEFAULT_HI_RULES, type HiRules, type ShiftScope } from '../../lib/tools';
import { editField, useApp } from '../../store/store';
import { DiffPreview, Scope, close } from './Dialog';

export const HI_LABELS: Record<keyof HiRules, [string, string]> = t.hi.labels;

export function HiDialog() {
  const doc = useApp((s) => s.doc)!;
  const selection = useApp((s) => s.selection);
  const commit = useApp((s) => s.commit);
  const [rules, setRules] = useState<HiRules>(DEFAULT_HI_RULES);
  const [scope, setScope] = useState<ShiftScope>('all');
  const result = useMemo(() => cleanHi(doc.cues, rules, scope === 'selection' ? selection : undefined), [doc.cues, rules, scope, selection]);
  const removed = new Set(result.removed);

  return (
    <SidePanel title={t.tools.cleanHi} onClose={close}>
      <div className="dialog-body">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: 10,
          }}
        >
          {(Object.keys(HI_LABELS) as (keyof HiRules)[]).map((k) => (
            <label className="check" key={k}>
              <input type="checkbox" checked={rules[k]} onChange={(e) => setRules({ ...rules, [k]: e.target.checked })} />
              <span>
                {HI_LABELS[k][0]}
                <br />
                <span className="note">{HI_LABELS[k][1]}</span>
              </span>
            </label>
          ))}
        </div>
        <Scope value={scope} onChange={setScope} />
        <div className="summary">{t.hi.summary(result.changed.filter((c) => !removed.has(c.id)).length, removed.size)}</div>
        <DiffPreview items={result.changed} removed={removed} />
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={close}>
          {t.common.cancel}
        </button>
        <button
          className="btn primary"
          disabled={!result.changed.length}
          onClick={() => {
            commit(result.cues, t.tools.cleanHi, []);
            close();
          }}
        >
          {t.hi.apply(result.changed.length)}
        </button>
      </div>
    </SidePanel>
  );
}

/* ---------------- Punctuation ---------------- */

/** No-break spaces made visible in the preview. */
export function showSpaces(text: string): ReactNode[] {
  return text.split(/([\u00a0\u202f])/).map((part, i) =>
    part === '\u00a0' || part === '\u202f' ? (
      <span className={`nbsp ${part === '\u202f' ? 'narrow' : ''}`} key={i}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function PunctuationDialog() {
  const doc = useApp((s) => s.doc)!;
  const selection = useApp((s) => s.selection);
  const translation = useApp((s) => s.translation);
  const commit = useApp((s) => s.commit);
  const [field, setField] = useState<'text' | 'target'>(() => editField(useApp.getState()));
  const lang = field === 'target' ? translation?.targetLang : doc.lang;
  const [opts, setOpts] = useState<PunctOptions>(() => ({ ...DEFAULT_PUNCT, style: punctStyleFor(lang) }));
  const [scope, setScope] = useState<ShiftScope>('all');
  const result = useMemo(() => fixPunctuation(doc.cues, opts, field, scope === 'selection' ? selection : undefined), [doc.cues, opts, field, scope, selection]);
  const tp = t.punctuation;
  const set = (o: Partial<PunctOptions>) => setOpts({ ...opts, ...o });
  const netflix = netflixPunct(lang);
  const isNetflix = samePunct(opts, netflix);
  const pickField = (f: 'text' | 'target') => {
    setField(f);
    const l = f === 'target' ? translation?.targetLang : doc.lang;
    // A style guide follows the language of the text picked.
    setOpts(isNetflix ? netflixPunct(l) : { ...opts, style: punctStyleFor(l) });
  };

  return (
    <SidePanel title={t.tools.punctuation} onClose={close}>
      <div className="dialog-body">
        {translation && (
          <div className="field">
            <label>{tp.field}</label>
            <select className="select" value={field} onChange={(e) => pickField(e.target.value as 'text' | 'target')}>
              <option value="target">{tp.fieldTarget}</option>
              <option value="text">{tp.fieldSource}</option>
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="punct-guide">{tp.guide}</label>
          <select
            id="punct-guide"
            className="select"
            value={isNetflix ? 'netflix' : 'custom'}
            onChange={(e) => setOpts(e.target.value === 'netflix' ? netflix : { ...DEFAULT_PUNCT, style: punctStyleFor(lang) })}
          >
            <option value="custom">{tp.guides.custom}</option>
            <option value="netflix">{tp.guides.netflix}</option>
          </select>
        </div>
        <div className="field">
          <label>{tp.convention}</label>
          <select className="select" value={opts.style} onChange={(e) => set({ style: e.target.value as PunctStyle })}>
            {(Object.keys(tp.styles) as PunctStyle[]).map((k) => (
              <option key={k} value={k}>
                {tp.styles[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{tp.quotes}</label>
          <select className="select" value={opts.quotes} onChange={(e) => set({ quotes: e.target.value as QuoteStyle })}>
            {(Object.keys(tp.quoteStyles) as QuoteStyle[]).map((k) => (
              <option key={k} value={k}>
                {tp.quoteStyles[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{tp.ellipsis}</label>
          <select className="select" value={opts.ellipsis} onChange={(e) => set({ ellipsis: e.target.value as EllipsisStyle })}>
            {(Object.keys(tp.ellipsisStyles) as EllipsisStyle[]).map((k) => (
              <option key={k} value={k}>
                {tp.ellipsisStyles[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{tp.dashes}</label>
          <select className="select" value={opts.dashes} onChange={(e) => set({ dashes: e.target.value as DashStyle })}>
            {(Object.keys(tp.dashStyles) as DashStyle[]).map((k) => (
              <option key={k} value={k}>
                {tp.dashStyles[k]}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          <label className="check">
            <input type="checkbox" checked={opts.spaces} onChange={(e) => set({ spaces: e.target.checked })} />
            <span>
              {tp.spaces}
              <br />
              <span className="note">{tp.spacesHint}</span>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" checked={opts.semicolons} onChange={(e) => set({ semicolons: e.target.checked })} />
            <span>
              {tp.semicolons}
              <br />
              <span className="note">{tp.semicolonsHint}</span>
            </span>
          </label>
        </div>
        <Scope value={scope} onChange={setScope} />
        <div className="summary">
          {tp.summary(result.changed.length)}
          {result.changed.length > 0 && <div>{tp.spaceMark}</div>}
        </div>
        <DiffPreview items={result.changed} show={showSpaces} className="punct" />
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={close}>
          {t.common.cancel}
        </button>
        <button
          className="btn primary"
          disabled={!result.changed.length}
          onClick={() => {
            commit(result.cues, t.tools.punctuation);
            close();
          }}
        >
          {tp.apply(result.changed.length)}
        </button>
      </div>
    </SidePanel>
  );
}

/* ---------------- Find and replace ---------------- */

export function ReplaceDialog() {
  const doc = useApp((s) => s.doc)!;
  const selection = useApp((s) => s.selection);
  const translation = useApp((s) => s.translation);
  const commit = useApp((s) => s.commit);
  const [field, setField] = useState<'text' | 'target'>(() => editField(useApp.getState()));
  const [opts, setOpts] = useState<ReplaceOptions>(DEFAULT_REPLACE);
  const [scope, setScope] = useState<ShiftScope>('all');
  const result = useMemo(() => findReplace(doc.cues, opts, field, scope === 'selection' ? selection : undefined), [doc.cues, opts, field, scope, selection]);
  const tr = t.replace;
  const set = (o: Partial<ReplaceOptions>) => setOpts({ ...opts, ...o });
  const n = result.changed.length;

  // A side panel: the list and the video stay usable, the selection can change while it's open.
  return (
    <SidePanel title={t.tools.replace} onClose={close}>
      <div className="dialog-body">
        {translation && (
          <div className="field">
            <label>{t.punctuation.field}</label>
            <select className="select" value={field} onChange={(e) => setField(e.target.value as 'text' | 'target')}>
              <option value="target">{t.punctuation.fieldTarget}</option>
              <option value="text">{t.punctuation.fieldSource}</option>
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="replace-find">{tr.find}</label>
          <input
            id="replace-find"
            autoFocus
            className={`input ${result.error ? 'bad' : ''}`}
            style={{ flex: 1 }}
            spellCheck={false}
            placeholder={tr.findPlaceholder}
            value={opts.find}
            onChange={(e) => set({ find: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="replace-with">{tr.with}</label>
          <input
            id="replace-with"
            className="input"
            style={{ flex: 1 }}
            spellCheck={false}
            value={opts.replace}
            onChange={(e) => set({ replace: e.target.value })}
          />
        </div>
        <div className="radio-row">
          <label className="check">
            <input type="checkbox" checked={opts.matchCase} onChange={(e) => set({ matchCase: e.target.checked })} />
            <span>{tr.matchCase}</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={opts.wholeWord} onChange={(e) => set({ wholeWord: e.target.checked })} />
            <span>{tr.wholeWord}</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={opts.regex} onChange={(e) => set({ regex: e.target.checked })} />
            <span>{tr.regex}</span>
          </label>
        </div>
        {opts.regex && <p className="note flush">{tr.regexHint}</p>}
        <Scope value={scope} onChange={setScope} />
        {opts.find && <div className="summary">{result.error ? tr.error(result.error) : tr.summary(result.count, n)}</div>}
        {n > 0 && <DiffPreview items={result.changed} className="punct" />}
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={close}>
          {t.common.cancel}
        </button>
        <button
          className="btn primary"
          disabled={!n}
          onClick={() => {
            commit(result.cues, t.tools.replace);
            close();
          }}
        >
          {tr.apply(n)}
        </button>
      </div>
    </SidePanel>
  );
}
