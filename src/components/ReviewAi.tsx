/**
 * Tools › Review with AI: the AI model of Settings › Translation proofreads the subtitles (the
 * selected ones, else all) and proposes corrections — words misheard by speech-to-text, spelling,
 * grammar, punctuation, names written two ways. A side panel, so each proposal can be heard (▶)
 * with the video. Nothing changes until applied (one undo step).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { playSound } from '../store/sounds';
import { Alert } from './Alert';
import { t } from '../i18n';
import {
  CHECK_KINDS,
  REVIEW_BATCH,
  checkItems,
  checkSystemPrompt,
  checkUserPrompt,
  estimateReview,
  parseReview,
  reviewItems,
  reviewProposals,
  reviewSystemPrompt,
  reviewUserPrompt,
  type ReviewProposal,
} from '../lib/review';
import { viewOf, restoreTargets, sourceLang } from '../lib/translation';
import { aiProblem, askAi } from '../mt/ai';
import { toolSide, useApp } from '../store/store';
import { AiProposals } from './AiProposals';
import { AiCall } from './AiCall';
import { ProgressBand } from './Progress';
import { SidePanel } from './SidePanel';

const close = () => useApp.getState().openDialog(null);

/** `check`: Tools › Check the translation with AI — each translation next to its original (the same panel). */
export function ReviewPanel({ check = false }: { check?: boolean }) {
  const doc = useApp((s) => s.doc)!;
  const selection = useApp((s) => s.selection);
  const settings = useApp((s) => s.settings);
  const side = useApp(toolSide);
  const translation = useApp((s) => s.translation);
  const notes = useApp((s) => s.sceneNotes);
  const tr = t.review;
  // What's reviewed: the selected subtitles (two or more), else all; the language edited.
  const [scope, setScope] = useState<'all' | 'selection'>(selection.length > 1 ? 'selection' : 'all');
  const seen = useMemo(() => (check ? doc.cues : viewOf(doc.cues, side)), [check, doc.cues, side]);
  const ids = scope === 'selection' ? selection : doc.cues.map((c) => c.id);
  const { items } = useMemo(() => (check ? checkItems(seen, ids, notes) : reviewItems(seen, ids)), [check, seen, ids, notes]);
  const lang = translation && side === 'target' ? translation.targetLang : (translation?.sourceLang ?? doc.lang);
  const estimate = estimateReview(items, Math.ceil(items.length / REVIEW_BATCH));
  const missing = aiProblem(settings);

  const [run, setRun] = useState<{ done: number; total: number; startedAt: number } | null>(null);
  const [list, setList] = useState<ReviewProposal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tokens, setTokens] = useState({ input: 0, output: 0 });
  const stop = useRef<AbortController | null>(null);
  const stopped = useRef(false);
  useEffect(() => () => stop.current?.abort(), []);

  const start = async () => {
    const ac = new AbortController();
    stop.current = ac;
    stopped.current = false;
    setError(null);
    const st = useApp.getState();
    const cues = check ? st.doc!.cues : viewOf(st.doc!.cues, toolSide(st));
    const pick = (some: string[]) => (check ? checkItems(cues, some, st.sceneNotes) : { ...reviewItems(cues, some), scenes: [] });
    const { items: all, ids: picked } = pick(ids);
    setRun({ done: 0, total: all.length, startedAt: Date.now() });
    const system =
      check && st.translation ? checkSystemPrompt(sourceLang(st.doc!.lang, st.translation), st.translation.targetLang) : reviewSystemPrompt(lang, true);
    const out: ReviewProposal[] = [];
    let failed = false;
    try {
      for (let i = 0; i < all.length && !ac.signal.aborted; i += REVIEW_BATCH) {
        const batchIds = picked.slice(i, i + REVIEW_BATCH);
        const { items: batch, ids: got, scenes } = pick(batchIds);
        const r = await askAi(st.settings, system, check ? checkUserPrompt(batch, scenes) : reviewUserPrompt(batch), ac.signal);
        if (ac.signal.aborted) break;
        setTokens((x) => ({ input: x.input + r.usage.input, output: x.output + r.usage.output }));
        out.push(...reviewProposals(cues, got, batch, parseReview(r.text, batch.length, check ? CHECK_KINDS : undefined)));
        setRun((x) => x && { ...x, done: Math.min(all.length, i + REVIEW_BATCH) });
      }
    } catch (e) {
      failed = true;
      if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    }
    // The panel closing stops it: nothing to show. Stop: what came back so far.
    if (ac.signal.aborted && !stopped.current) return;
    if (!ac.signal.aborted && !failed) playSound('done');
    setRun(null);
    setList(out);
  };

  const apply = (chosen: string[]) => {
    const st = useApp.getState();
    const byId = new Map((list ?? []).filter((p) => chosen.includes(p.id)).map((p) => [p.id, p]));
    if (!byId.size) return close();
    // On the cues as the review saw them, then the translations put back (editing the original).
    const side = check ? 'target' : toolSide(st);
    const next = (check ? st.doc!.cues : viewOf(st.doc!.cues, side)).map((c) => {
      const p = byId.get(c.id);
      return p ? { ...c, [p.field]: p.after } : c;
    });
    st.commit(side === 'source' ? restoreTargets(next, st.doc!.cues) : next, check ? t.check.undo(byId.size) : tr.undo(byId.size));
    st.notify(tr.applied(byId.size), { undo: true, tone: 'success' });
    close();
  };

  return (
    <SidePanel title={check ? t.tools.checkTranslation : t.tools.review} onClose={close} className="review-panel">
      {list ? (
        <AiProposals
          intro={
            <>
              {error && <Alert>{error}</Alert>}
              <AiCall used={tokens} />
              <p className="note flush">{list.length ? tr.found(list.length) : tr.nothing}</p>
              {list.some((p) => p.kind === 'misheard') && <p className="note flush">{tr.listenHint}</p>}
            </>
          }
          items={list.map((p) => ({
            id: p.id,
            ...(check ? { original: doc.cues.find((c) => c.id === p.id)?.text ?? '' } : {}),
            before: p.before,
            after: p.after,
            tag: tr.kinds[p.kind],
            reason: p.reason,
          }))}
          applyLabel={tr.apply}
          onApply={apply}
          onCancel={close}
        />
      ) : run ? (
        <div className="dialog-body">
          <ProgressBand
            title={check ? t.check.running : tr.running}
            done={run.done}
            total={run.total}
            startedAt={run.startedAt}
            onStop={() => {
              stopped.current = true;
              stop.current?.abort();
            }}
            variant="flush"
          />
          <AiCall used={tokens} estimate={{ count: run.total, ...estimate }} />
        </div>
      ) : (
        <>
          <div className="dialog-body">
            {missing && <Alert>{t.quality.shorten.needsAi}</Alert>}
            {error && <Alert>{error}</Alert>}
            <p className="note flush">{check ? t.check.intro : tr.intro}</p>
            {!missing && <AiCall estimate={{ count: items.length, ...estimate }} />}
            {selection.length > 0 && (
              <div className="radio-row">
                <label>
                  <input type="radio" checked={scope === 'selection'} onChange={() => setScope('selection')} /> {tr.scopeSelection(selection.length)}
                </label>
                <label>
                  <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> {tr.scopeAll(doc.cues.length)}
                </label>
              </div>
            )}
          </div>
          <div className="dialog-foot">
            <button className="btn" onClick={close}>
              {t.common.cancel}
            </button>
            <button className="btn primary" disabled={!!missing || !items.length} onClick={() => void start()}>
              {check ? t.check.start(items.length) : tr.start(items.length)}
            </button>
          </div>
        </>
      )}
    </SidePanel>
  );
}
