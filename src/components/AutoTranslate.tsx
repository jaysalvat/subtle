import { ProgressBand } from './Progress';
import { useEffect, useMemo, useRef, useState } from 'react';
import { playSound } from '../store/sounds';
import { Alert } from './Alert';
import { createPortal } from 'react-dom';
import { t } from '../i18n';
import { ENGINES, translateCues } from '../mt';
import { forAi } from '../mt/ai';
import { sourceLang } from '../lib/translation';
import type { EngineState } from '../mt/engine';
import { useApp } from '../store/store';
import { activeAiProvider } from '../lib/types';
import { estimateTokens, type TokenCount } from '../lib/mtAi';
import { AiCall, kTokens } from './AiCall';

/** State of the chosen engine for a language pair ('checking' while asking). */
export function useEngineState(from: string, to: string, ai = false): EngineState | 'checking' {
  // Raw settings from the store (forAi makes a new object: never inside a selector).
  const raw = useApp((s) => s.settings);
  const settings = useMemo(() => (ai ? forAi(raw) : raw), [ai, raw]);
  const engineId = settings.translationEngine;
  const provider = activeAiProvider(settings);
  const key = settings.aiKeys[provider];
  const model = settings.aiModels[provider];
  const [state, setState] = useState<EngineState | 'checking'>('checking');
  useEffect(() => {
    let live = true;
    setState('checking');
    ENGINES[engineId].status(from, to, ai ? forAi(useApp.getState().settings) : useApp.getState().settings).then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, [engineId, from, to, provider, key, ai, settings.aiBaseUrl, model]);
  return state;
}

export const canTranslate = (state: EngineState | 'checking') => state === 'ready' || state === 'download';

/**
 * "Translate automatically" while translating: fills the missing translations (or all of them) with
 * the engine chosen in Settings. One undo step; stopping keeps what's done. `autoStart` runs it as
 * soon as the engine is ready (when "Translate automatically" was chosen at the start).
 */
export function AutoTranslate({
  autoStart = false,
  compact = false,
  only,
  startIn,
  ai = false,
  instruction,
  closeWhenDone = false,
  startLabel,
}: {
  autoStart?: boolean;
  compact?: boolean;
  /** These subtitles only, translated again (a scene, the selection). */
  only?: string[];
  /** Where the start button goes (a window's footer), else here. */
  startIn?: HTMLElement | null;
  /** The AI model, even when Chrome translates (like the other AI tools): notes, instructions. */
  ai?: boolean;
  instruction?: string;
  closeWhenDone?: boolean;
  /** The start button's text (else "Translate this scene again" with `only`). */
  startLabel?: string;
}) {
  const doc = useApp((s) => s.doc)!;
  const translation = useApp((s) => s.translation)!;
  const raw = useApp((s) => s.settings);
  const settings = useMemo(() => (ai ? forAi(raw) : raw), [ai, raw]);
  const notify = useApp((s) => s.notify);
  const engine = ENGINES[settings.translationEngine];
  const from = sourceLang(doc.lang, translation);
  const state = useEngineState(from, translation.targetLang, ai);
  // Compact: the remaining ones. Full (in More options): everything again, replacing what's there.
  const redo = !compact || !!only;
  const pick = (c: { id: string; target?: string }) => (only ? only.includes(c.id) : redo || !c.target?.trim());
  // t0: when translating started (after any download): gives the time left.
  const [run, setRun] = useState<{ done: number; total: number; download?: number; t0: number } | null>(null);
  const [, tick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<AbortController | null>(null);
  const started = useRef(false);

  useEffect(() => () => stop.current?.abort(), []);
  // Elapsed time ticks while running.
  const running = !!run;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const todo = doc.cues.filter(pick);

  const start = async () => {
    setError(null);
    const ac = new AbortController();
    stop.current = ac;
    const st = useApp.getState();
    const base = st.doc!.cues;
    const list = base.filter(pick);
    setRun({ done: 0, total: list.length, t0: Date.now() });
    st.setAutoTranslating(redo ? 'all' : 'remaining');
    // Translations show in the list as they come in; the whole run is one undo step at the end.
    let got = new Map<string, string>();
    const count = () => got.size;
    let failed = false;
    const usage: { last: TokenCount | null } = { last: null };
    const show = (out: Map<string, string>) => {
      got = out;
      const cur = useApp.getState().doc!.cues;
      useApp.getState().replaceLive(cur.map((c) => (out.has(c.id) && c.target !== out.get(c.id) ? { ...c, target: out.get(c.id)! } : c)));
    };
    try {
      const out = await translateCues(engine, list, from, translation.targetLang, ai ? forAi(useApp.getState().settings) : useApp.getState().settings, {
        signal: ac.signal,
        onDownload: (p) => setRun((r) => r && { ...r, download: p, t0: Date.now() }),
        onProgress: (done, total) =>
          setRun((r) => {
            const t0 = r?.t0 ?? Date.now();
            return { done, total, t0 };
          }),
        onPartial: show,
        onUsage: (u) => (usage.last = u),
        notes: useApp.getState().sceneNotes,
        instruction,
        ...(only ? { film: base } : {}),
      });
      if (out.size) show(out);
    } catch (e) {
      if (!ac.signal.aborted) {
        failed = true;
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      useApp.getState().endGesture(base, t.mt.undo(count()));
      setRun(null);
      stop.current = null;
      useApp.getState().setAutoTranslating(null);
    }
    const n = count();
    const skipped = !ac.signal.aborted && !failed && n < list.length;
    // AI services: what it really took, as the provider counted it.
    const used = usage.last;
    const tokens = engine.id === 'ai' && used ? ` ${t.aiCall.used(kTokens(used.input), kTokens(used.output))}` : '';
    if (n && !failed && !skipped && !ac.signal.aborted) playSound('done');
    if (skipped) notify(t.mt.partial(n, list.length) + tokens, { undo: !!n, tone: 'warning', stay: true });
    else if (n)
      notify((ac.signal.aborted ? t.mt.stopped(n) : t.mt.done(n, translation.targetLang)) + tokens, {
        undo: true,
        tone: ac.signal.aborted ? undefined : 'success',
      });
    // Finished: close, so the translations can be reviewed. Stop, an error or skipped lines keep it
    // open (with "Translate the k remaining" right there).
    if (n && !ac.signal.aborted && !failed && !skipped && (!only || closeWhenDone)) useApp.getState().openDialog(null);
  };

  // Chosen at the start: go as soon as the engine is ready.
  useEffect(() => {
    if (autoStart && !started.current && canTranslate(state)) {
      started.current = true;
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, state]);

  // Which service and model will do it: "DeepSeek · deepseek-chat", "Local model · gemma4".
  const p = activeAiProvider(settings);
  const model = engine.id === 'chrome' ? '' : settings.aiModels[p]?.trim();
  const name = engine.id === 'ai' && p !== 'local' ? t.mt.ai.providers[p] : engine.id === 'local' ? t.mt.localName : t.mt.engines.chrome.name;
  const stateText = state === 'checking' ? t.mt.checking : t.mt.state[state];
  const busy = useApp((s) => s.autoTranslating);
  // AI services are paid per token: what this run will roughly use (no prices: they change).
  const estimate = useMemo(
    () => (engine.id === 'ai' && todo.length ? estimateTokens(todo, from, translation.targetLang, settings.maxLineLength, settings.maxCps) : null),
    [engine.id, todo, from, translation.targetLang, settings.maxLineLength, settings.maxCps],
  );
  const canRun = canTranslate(state) && todo.length > 0 && from !== translation.targetLang && !busy;

  // One framed block: who translates, what it will take, the button last.
  return (
    <div className="auto-translate">
      {error && <Alert>{error}</Alert>}
      <AiCall who={{ name, model }} suffix={stateText} estimate={run || !estimate ? null : { count: todo.length, ...estimate }} />
      {run ? (
        run.download !== undefined && run.done === 0 ? (
          <ProgressBand
            title={t.mt.running}
            done={run.download * 100}
            total={100}
            show={{ text: t.mt.downloading(Math.round(run.download * 100)) }}
            onStop={() => stop.current?.abort()}
            variant="plain"
          />
        ) : (
          <ProgressBand title={t.mt.running} done={run.done} total={run.total} startedAt={run.t0} onStop={() => stop.current?.abort()} variant="plain" />
        )
      ) : (
        <>
          {!compact && !only && <p className="note flush">{t.mt.redoNote}</p>}
          {(() => {
            const button = (
              <button className={`btn primary-soft ${startIn ? 'sm' : ''}`} disabled={!canRun} onClick={start}>
                {only ? (startLabel ?? t.mt.startScene(todo.length > 0)) : redo ? t.mt.startAll : t.mt.startRemaining(todo.length > 0)}
              </button>
            );
            return startIn ? createPortal(button, startIn) : button;
          })()}
        </>
      )}
    </div>
  );
}
