/**
 * Shorten with AI (Tools, or Check quality › Too fast to read): like Review with AI, a start step
 * first — which subtitles (the selected ones or the too fast ones), the AI and the tokens it will
 * take, then Shorten N subtitles — nothing is sent before. The AI model of Settings › Translation
 * proposes shorter versions, each accepted or skipped (all accepted ones applied in one undo step).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { playSound } from '../store/sounds';
import { Alert } from './Alert';
import { t } from '../i18n';
import { applyProposals, condenseItems, condenseSystemPrompt, condenseUserPrompt, estimateCondense, proposals, type Proposal } from '../lib/condense';
import { parseAiReply } from '../lib/mtAi';
import { charCount } from '../lib/tools';
import { aiProblem, askAi } from '../mt/ai';
import { toolSide, useApp } from '../store/store';
import { viewOf } from '../lib/translation';
import { ProgressBand } from './Progress';
import { AiProposals } from './AiProposals';
import { AiCall } from './AiCall';

const BATCH = 30;

export function ShortenAi({ tooFast, preferSelection, onDone }: { tooFast: string[]; preferSelection: boolean; onDone: () => void }) {
  const selection = useApp((s) => s.selection);
  const settings = useApp((s) => s.settings);
  const missing = aiProblem(settings);
  const [scope, setScope] = useState<'selection' | 'tooFast'>(preferSelection && selection.length ? 'selection' : 'tooFast');
  const picked = scope === 'selection' && selection.length ? selection : tooFast;
  /** The subtitles sent, once started (none before Shorten is pressed). */
  const [ids, setIds] = useState<string[] | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [list, setList] = useState<Proposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Left out: almost no time on screen. */
  const [skipped, setSkipped] = useState(0);
  const [tokens, setTokens] = useState({ input: 0, output: 0 });
  const stop = useRef<AbortController | null>(null);
  /** Stop pressed (keep what came back), as opposed to the panel closing. */
  const stopped = useRef(false);
  const [startedAt, setStartedAt] = useState(0);
  const ts = t.quality.shorten;
  const maxCps = useApp((s) => s.settings.maxCps);
  // What the run will roughly take, shown until the provider counts the tokens.
  const estimate = useMemo(() => {
    const st = useApp.getState();
    const cues = viewOf(st.doc!.cues, toolSide(st));
    const lang = st.translation && st.editSide === 'target' ? st.translation.targetLang : (st.translation?.sourceLang ?? st.doc!.lang);
    const { items } = condenseItems(cues, ids ?? picked, st.settings.maxCps);
    return {
      count: items.length,
      ...estimateCondense(items, condenseSystemPrompt(lang, st.settings.maxLineLength), Math.ceil((ids ?? picked).length / BATCH)),
    };
  }, [ids, picked]);

  useEffect(() => {
    if (!ids) return;
    const ac = new AbortController();
    stop.current = ac;
    void (async () => {
      const st = useApp.getState();
      // The language edited (the original when editing it while translating).
      const cues = viewOf(st.doc!.cues, toolSide(st));
      const lang = st.translation && st.editSide === 'target' ? st.translation.targetLang : (st.translation?.sourceLang ?? st.doc!.lang);
      const system = condenseSystemPrompt(lang, st.settings.maxLineLength);
      const out: Proposal[] = [];
      let failed = false;
      try {
        for (let i = 0; i < ids.length && !ac.signal.aborted; i += BATCH) {
          const { items, ids: got } = condenseItems(cues, ids.slice(i, i + BATCH), st.settings.maxCps);
          const r = await askAi(st.settings, system, condenseUserPrompt(items), ac.signal);
          if (ac.signal.aborted) break;
          setTokens((x) => ({ input: x.input + r.usage.input, output: x.output + r.usage.output }));
          out.push(...proposals(cues, got, items, parseAiReply(r.text, items.length)));
          setProgress({ done: Math.min(ids.length, i + BATCH), total: ids.length });
        }
      } catch (e) {
        failed = true;
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      }
      // Stopped by the component going away (or a second run in development): show nothing.
      if (ac.signal.aborted && !stopped.current) return;
      if (!ac.signal.aborted && !failed) playSound('done');
      setList(out);
      setSkipped(ids.length - condenseItems(cues, ids, st.settings.maxCps).ids.length);
    })();
    return () => ac.abort();
  }, [ids]);

  const apply = (ids: string[]) => {
    const st = useApp.getState();
    const chosen = (list ?? []).filter((p) => ids.includes(p.id));
    if (chosen.length) {
      st.commit(applyProposals(st.doc!.cues, chosen), ts.undo(chosen.length));
      st.notify(ts.applied(chosen.length), { undo: true, tone: 'success' });
    }
    onDone();
  };

  const start = () => {
    setStartedAt(Date.now());
    setProgress({ done: 0, total: picked.length });
    setIds(picked);
  };

  if (!ids) {
    return (
      <>
        <div className="dialog-body">
          {missing && <Alert>{ts.needsAi}</Alert>}
          <p className="note flush">{ts.intro}</p>
          {!missing && <AiCall estimate={estimate} />}
          {selection.length > 0 && (
            <div className="radio-row">
              <label>
                <input type="radio" checked={scope === 'selection'} onChange={() => setScope('selection')} /> {t.review.scopeSelection(selection.length)}
              </label>
              <label>
                <input type="radio" checked={scope === 'tooFast'} onChange={() => setScope('tooFast')} /> {ts.scopeTooFast(tooFast.length)}
              </label>
            </div>
          )}
        </div>
        <div className="dialog-foot">
          <button className="btn" onClick={onDone}>
            {t.common.cancel}
          </button>
          <button className="btn primary" disabled={!!missing || !estimate.count} onClick={start}>
            {ts.start(estimate.count)}
          </button>
        </div>
      </>
    );
  }

  if (!list) {
    return (
      <div className="dialog-body">
        <ProgressBand
          title={ts.running}
          done={progress.done}
          total={progress.total}
          startedAt={startedAt}
          onStop={() => {
            stopped.current = true;
            stop.current?.abort();
          }}
          variant="flush"
        />
        <AiCall used={tokens} estimate={estimate} />
      </div>
    );
  }

  return (
    <AiProposals
      intro={
        <>
          {error && <Alert>{error}</Alert>}
          {skipped > 0 && <Alert>{ts.skipped(skipped)}</Alert>}
          <AiCall used={tokens} />
          <p className="note flush">{list.length ? ts.review(list.length) : ts.nothing}</p>
        </>
      }
      items={list.map((p) => {
        // Reading speed before → after, the way the list shows it (red: still above the maximum).
        const c = useApp.getState().doc?.cues.find((x) => x.id === p.id);
        const secs = c ? Math.max(0.001, (c.end - c.start) / 1000) : 1;
        return {
          id: p.id,
          before: p.before,
          after: p.after,
          // Proposals that fit are ticked; the ones still too long wait for a look.
          on: !p.stillLong,
          meta: (
            <span className="shorten-cps tnum">
              <span className="muted shorten-cps-before">{Math.round(charCount(p.before) / secs)}</span>
              {' → '}
              <span className={p.stillLong ? 'shorten-cps-long' : 'shorten-cps-ok'} title={p.stillLong ? ts.stillLong : ts.fits(maxCps)}>
                {Math.round(charCount(p.after) / secs)} {t.common.cps}
              </span>
            </span>
          ),
        };
      })}
      applyLabel={ts.apply}
      onApply={apply}
      onCancel={onDone}
    />
  );
}
