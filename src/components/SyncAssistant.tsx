import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { Alert } from './Alert';
import { fpsLabel } from '../lib/fps';
import { applySync, formatOffset, pickLineAt, speechAt, solveSync, type Anchor } from '../lib/sync';
import { formatTimecode } from '../lib/time';
import { player, usePlayback } from '../store/playback';
import { toolSide, useApp } from '../store/store';
import { shownCues } from '../lib/translation';
import { SidePanel } from './SidePanel';
import { loopAround, type Loop } from '../lib/loop';
import { setLoopChooser, startLoop, stopLoop, useLoop } from '../store/loop';
import { useWaveform } from '../store/waveform';
import { LinePicker, LineTarget } from './LinePicker';
import { PanelTransport } from './TransportButtons';
import { LiveWaveform } from './LiveWaveform';
import { WithKeys } from './Keys';

/** Both steps look the same: pick a line, find it in the video, press Here. */
type Step = 1 | 2;

/**
 * Sync assistant (non-modal side panel).
 * Step 1: find one line in the video and press Here → every subtitle is shifted, however far off.
 * Step 2 (optional): a line near the end plays in a loop; in sync → done, otherwise find it and
 * press Here → offset + speed (snapped to a frame rate conversion when close).
 */
/** Where the playhead sits on the dialogue band, and Here under it: a sixth of the way in, more of what is coming. */
const HERE_AT = 1 / 8;
/** The lines proposed: the n-th from the start and from the end; the playhead a little before them. */
const START_LINE = 2;
const END_LINE = 2;
const LEAD_MS = 2000;

export function SyncAssistant() {
  const doc = useApp((s) => s.doc)!;
  const hasVideo = useApp((s) => !!s.videoUrl);
  const notify = useApp((s) => s.notify);
  const time = usePlayback((s) => s.time);
  const base = useRef(doc.cues).current;
  // The lines read in the language edited (French while translating into French).
  const side = useApp(toolSide);
  const shown = useMemo(() => shownCues(base, side), [base, side]);

  const [step, setStep] = useState<Step>(1);
  // The n-th line from the start, then from the end: past the opening and before the closing credits.
  const [i1, setI1] = useState(() => pickLineAt(base, START_LINE, 'start'));
  const [i2, setI2] = useState(() => pickLineAt(base, END_LINE, 'end'));
  const [a1, setA1] = useState<Anchor | null>(null);
  const [a2, setA2] = useState<Anchor | null>(null);
  /** Loop to restart once the new timings are applied (set by Here / Back during a loop). */
  const relooping = useRef<(() => Loop) | null>(null);
  const result = useMemo(() => (a1 ? solveSync(a1, a2 ?? undefined) : null), [a1, a2]);
  const preview = useMemo(() => (result ? applySync(base, result) : base), [base, result]);
  useEffect(() => {
    useApp.getState().previewLive(base, preview);
    // Here / Back pressed while looping: carry on looping, now on the new timings.
    const next = relooping.current;
    relooping.current = null;
    if (next) startLoop(next());
  }, [base, preview]);

  /** Something placed: Cancel puts the times back; before that, nothing to cancel, Close. */
  const moved = !!a1;
  const index = step === 1 ? i1 : i2;
  const anchor = step === 1 ? a1 : a2;

  // The transport bar's Loop (and L) loops around the playhead while you search, and the placed
  // line once it's placed (it follows the fine-tuning).
  const chooser = useRef<() => Loop>(() => loopAround(player.now()));
  chooser.current = () => (anchor ? { cue: preview[index].id } : loopAround(player.now()));
  // Opening or closing the panel never touches a running loop (only the button / L stop it).
  useEffect(() => {
    setLoopChooser(() => chooser.current());
    return () => setLoopChooser(null);
  }, []);

  const looping = () => !!useLoop.getState().loop;
  const here = () => {
    const now = Math.round(player.now());
    const line = step === 1 ? i1 : i2;
    // Loop the line just placed: the fine-tuning (−/+ 0.1 s) is heard at once.
    relooping.current = () => ({ cue: base[line].id });
    if (step === 1) setA1({ from: base[i1].start, to: now });
    else setA2({ from: base[i2].start, to: now });
  };
  /** Undo the last Here (also ⌘Z while the panel is open). */
  const back = () => {
    if (step === 2 && !a2) {
      // Back to step 1: timings don't change, so restart the loop (if any) right away.
      if (looping()) startLoop(loopAround(player.now()));
      return setStep(1);
    }
    if (looping()) relooping.current = () => loopAround(player.now());
    else stopLoop();
    if (step === 2) setA2(null);
    else setA1(null);
  };
  const nudge = (ms: number) => {
    if (step === 2 && a2) setA2({ ...a2, to: a2.to + ms });
    else if (a1) setA1({ ...a1, to: a1.to + ms });
  };
  // Choosing which line to look for doesn't touch playback: a running loop keeps playing.
  const pick = (i: number) => {
    if (step === 1) {
      setI1(i);
      setA1(null);
    } else {
      setI2(i);
      setA2(null);
    }
  };
  /** Jump the video a little before where the line should be (with the current sync). */
  const goTo = (i: number) => {
    // A running loop follows the jump (store/loop).
    player.seek(Math.max(0, preview[i].start - 3000));
    usePlayback.getState().setFollowPaused(false);
  };

  // Enter = Here (unless a button or a field has the focus). ⌘Z = Back: the document's own undo
  // would act behind the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (a1 || step === 2) back();
        return;
      }
      if (e.key !== 'Enter') return;
      const el = e.target as HTMLElement;
      if (el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      e.preventDefault();
      here();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const finish = () => {
    stopLoop();
    if (result) {
      useApp.getState().endGesture(base, a2 ? t.sync2.undoTwo : t.sync2.undoOne);
      notify(a2 ? t.sync2.doneTwo : t.sync2.doneOne(formatOffset(result.offset)), { undo: true, tone: 'success' });
    }
    useApp.getState().openDialog(null);
  };
  const cancel = () => {
    stopLoop();
    useApp.getState().replaceLive(base);
    useApp.getState().openDialog(null);
  };

  /**
   * The playhead a little before the n-th line of dialogue from that side: the line to find is
   * around there and the dialogue band shows it coming (without the dialogue analysis: the line).
   */
  const placeHead = (from: 'start' | 'end', line: number) => {
    const at = speechAt(useWaveform.getState().dialogue?.spans, from === 'start' ? START_LINE : END_LINE, from);
    player.seek(Math.max(0, (at ?? preview[line].start) - LEAD_MS));
    usePlayback.getState().setFollowPaused(false);
  };
  // Opening: ready on the start (not playing: the first Play is yours).
  useEffect(() => placeHead('start', i1), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Back to the start line, the end kept: Here there re-places the start, the end stays placed. */
  const toStep1 = () => {
    setStep(1);
    stopLoop();
    placeHead('start', i1);
  };

  const toStep2 = () => {
    setStep(2);
    stopLoop();
    placeHead('end', i2);
    player.play();
  };
  return (
    <SidePanel title={t.sync2.title} onClose={cancel} closeLabel={moved ? t.common.cancel : t.common.close}>
      <div className="side-body">
        {!hasVideo && <Alert>{t.sync2.needVideo}</Alert>}
        {step === 2 && result && Math.abs(result.scale - 1) > 0.06 && <Alert>{t.sync2.oddSpeed}</Alert>}

        <div className="group-title">{step === 1 ? t.sync2.step1 : t.sync2.step2}</div>
        <p className="note">
          <WithKeys text={step === 1 ? t.sync2.step1Help : t.sync2.step2Help} />
        </p>

        {/* Top to bottom, as it's used: pick a line, read it, play, watch the dialogue come, press Here. */}
        <LinePicker cues={shown} times={preview} index={index} onPick={pick} onGo={goTo} />
        <LineTarget text={shown[index].text} />
        <PanelTransport />
        {hasVideo && (
          <div className="here-stage" style={{ '--here-at': HERE_AT } as React.CSSProperties}>
            <LiveWaveform at={HERE_AT} />
            <button className="here-btn" disabled={!hasVideo} onClick={here} title={`${t.sync2.here} (Enter)`}>
              {t.sync2.here}
            </button>
            <span className="muted tnum here-time" title={t.sync2.playhead}>
              {formatTimecode(time).slice(0, 10)}
            </span>
          </div>
        )}

        {anchor && result && (
          <>
            <p className="sync-result">
              {step === 1
                ? t.sync2.shifted(formatOffset(result.offset))
                : result.fps
                  ? t.sync2.fps(fpsLabel(result.fps.from), fpsLabel(result.fps.to))
                  : t.sync2.speed(result.scale.toFixed(5))}
            </p>
            <div className="fps-actions">
              <span className="muted">{t.sync2.fineTune}</span>
              <button className="btn sm" onClick={() => nudge(-100)}>
                −0.1 s
              </button>
              <button className="btn sm" onClick={() => nudge(100)}>
                +0.1 s
              </button>
            </div>
          </>
        )}
      </div>
      {/* As in the windows: the other way on the left, then Cancel (Close while nothing has moved), the main one on the right. */}
      <div className="dialog-foot">
        {step === 1 && a1 && (
          <button className="btn" style={{ marginRight: 'auto' }} onClick={toStep2}>
            {t.sync2.checkEnd}
          </button>
        )}
        {step === 2 && (
          <button className="btn" style={{ marginRight: 'auto' }} onClick={toStep1}>
            {t.sync2.backToStart}
          </button>
        )}
        <button className="btn" onClick={cancel}>
          {moved ? t.common.cancel : t.common.close}
        </button>
        {(a1 || step === 2) && (
          <button className="btn primary" onClick={finish}>
            {step === 1 || a2 ? t.sync2.done(base.length) : t.sync2.inSyncDone}
          </button>
        )}
      </div>
    </SidePanel>
  );
}
