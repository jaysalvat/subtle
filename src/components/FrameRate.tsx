import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { Alert } from './Alert';
import { conversionsFor, convertFps, FPS_CONVERSIONS, fpsLabel, rankConversions, speechActivity, type FpsConversion } from '../lib/fps';
import { useThumbs } from '../store/thumbs';
import type { Cue } from '../lib/types';
import { player, usePlayback } from '../store/playback';
import { toolSide, useApp } from '../store/store';
import { shownText } from '../lib/translation';
import { useWaveform } from '../store/waveform';
import { LineTarget } from './LinePicker';
import { SidePanel } from './SidePanel';

const close = () => useApp.getState().openDialog(null);
const label = (c: FpsConversion) => (c.id === 'none' ? t.fps.none : t.fps.convert(fpsLabel(c.from), fpsLabel(c.to)));

/** A subtitle around 75 % of the film (where a wrong frame rate drifts the most), at least 1 s long. */
function testCue(cues: Cue[]): Cue {
  const target = cues[cues.length - 1].start * 0.75;
  let best = cues[0];
  for (const c of cues) {
    if (c.end - c.start < 1000) continue;
    if (Math.abs(c.start - target) < Math.abs(best.start - target)) best = c;
  }
  return best;
}

/**
 * Frame rate conversion. Non-modal panel, so the video stays visible and audible:
 * one-click conversions, or a guided mode that tries the most likely ones first and asks if it's in sync.
 */
export function FrameRatePanel() {
  const doc = useApp((s) => s.doc)!;
  // The line to listen for, in the language edited.
  const side = useApp(toolSide);
  const hasVideo = useApp((s) => !!s.videoUrl);
  const waveform = useWaveform((s) => (s.status === 'ready' ? s.waveform : null));
  const notify = useApp((s) => s.notify);
  const videoFps = useThumbs((s) => s.fps);
  const base = useRef(doc.cues).current; // cues when the panel opened
  const [tries, setTries] = useState<FpsConversion[] | null>(null);
  /** The conversion picked in the list (shown live, kept with Convert). */
  const [chosen, setChosen] = useState<FpsConversion | null>(null);
  const [step, setStep] = useState(0);
  const stopTimer = useRef(0);
  const playing = useRef(false);

  const order = useMemo(() => rankConversions(base, waveform ? speechActivity(waveform) : null, videoFps), [base, waveform, videoFps]);
  const possible = new Set(conversionsFor(videoFps).map((c) => c.id));
  const current = tries ? tries[step] : (chosen ?? undefined);
  const preview = useMemo(() => (current ? convertFps(base, current) : null), [base, current]);
  const cue = useMemo(() => (preview ? testCue(preview) : null), [preview]);

  const play = () => {
    if (!cue) return;
    window.clearTimeout(stopTimer.current);
    player.seek(Math.max(0, cue.start - 2500));
    usePlayback.getState().setFollowPaused(false);
    player.play();
    playing.current = true;
    stopTimer.current = window.setTimeout(stopPlaying, cue.end - cue.start + 4500);
  };
  /** Pause only the playback this panel started (a running loop or your own playback is left alone). */
  const stopPlaying = () => {
    window.clearTimeout(stopTimer.current);
    if (playing.current) player.pause();
    playing.current = false;
  };

  // Show the candidate live, and play the test line.
  useEffect(() => {
    if (!preview) return;
    useApp.getState().previewLive(base, preview);
    play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);
  useEffect(() => () => window.clearTimeout(stopTimer.current), []);

  const cancel = () => {
    stopPlaying();
    useApp.getState().replaceLive(base);
    close();
  };
  /** Guided tries → the choices again, showing the one picked there (if any). */
  const back = () => {
    stopPlaying();
    setTries(null);
    setStep(0);
    if (!chosen) useApp.getState().replaceLive(base);
  };
  const keep = (c: FpsConversion) => {
    stopPlaying();
    if (c.id === 'none') {
      useApp.getState().replaceLive(base);
      notify(t.fps.keptNone);
    } else {
      useApp.getState().previewLive(base, convertFps(base, c));
      useApp.getState().endGesture(base, t.fps.undoLabel(fpsLabel(c.from), fpsLabel(c.to)));
      notify(t.fps.done(fpsLabel(c.from), fpsLabel(c.to)), { undo: true, tone: 'success' });
    }
    close();
  };

  return (
    <SidePanel title={t.fps.title} onClose={cancel} closeLabel={t.common.cancel}>
      {!tries ? (
        <>
          <div className="side-body">
            {!hasVideo && <Alert>{t.fps.needVideo}</Alert>}
            <p className="note">{t.fps.intro}</p>
            {videoFps && <p className="sync-result">{t.fps.videoAt(fpsLabel(videoFps))}</p>}
            {/* Picking one shows it live on the timeline (and plays a line near the end): Convert keeps it. */}
            <div className="fps-grid" role="radiogroup" aria-label={t.fps.title}>
              {FPS_CONVERSIONS.map((c) => (
                <label key={c.id} className={`engine ${!possible.has(c.id) ? 'unlikely' : ''}`}>
                  <input type="radio" name="fps" checked={chosen?.id === c.id} onChange={() => setChosen(c)} />
                  <span className="tnum">
                    {fpsLabel(c.from)} → {fpsLabel(c.to)}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="dialog-foot">
            <button className="btn fps-left" disabled={!hasVideo} onClick={() => setTries(order)}>
              {t.fps.find}
            </button>
            <button className="btn" onClick={cancel}>
              {t.common.cancel}
            </button>
            <button className="btn primary" disabled={!chosen} onClick={() => chosen && keep(chosen)}>
              {t.fps.convertNow(base.length)}
            </button>
          </div>
        </>
      ) : (
        <>
          {current ? (
            <div className="side-body">
              <p className="note flush">{waveform ? t.fps.ranked : t.fps.unranked}</p>
              <div className="group-title">{t.fps.tryN(step + 1, tries.length, label(current))}</div>
              {cue && <LineTarget text={shownText(cue, side)} label={t.fps.listen} />}
              <div className="fps-actions">
                <button className="btn fps-left" onClick={play}>
                  {t.fps.replay}
                </button>
                <button className="btn" onClick={() => setStep(step + 1)}>
                  {step + 1 < tries.length ? t.fps.next : t.fps.noMore}
                </button>
                <button className="btn primary" onClick={() => keep(current)}>
                  {t.fps.yes}
                </button>
              </div>
            </div>
          ) : (
            <div className="side-body">
              <p className="note">{t.fps.nothing}</p>
              <div className="fps-actions">
                <button className="btn" onClick={() => setStep(0)}>
                  {t.fps.again}
                </button>
              </div>
            </div>
          )}
          <div className="dialog-foot">
            <button className="btn fps-left" onClick={back}>
              {t.fps.back}
            </button>
            <button className="btn" onClick={cancel}>
              {t.common.cancel}
            </button>
          </div>
        </>
      )}
    </SidePanel>
  );
}
