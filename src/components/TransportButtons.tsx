/**
 * The player's buttons: first / previous / −15 s / play / +15 s / next / last. Under the video, and
 * wherever a tool needs them at hand (Sync by ear). With ⌥⇧ = lines of dialogue, ⌥ = bookmarks,
 * ⇧ = scene notes, the first / previous / next / last buttons go to those instead of subtitles.
 */
import { t } from '../i18n';
import { goFirst, goLast, goMark, goNext, goPrev, skip } from '../actions';
import { player, usePlayback } from '../store/playback';
import { useApp } from '../store/store';
import { toggleLoop, useLoop } from '../store/loop';
import { Back15, First, Forward15, Last, Loop, Next, Pause, Play, Prev } from './Icons';

const withMarks = (dir: Parameters<typeof goMark>[1], go: () => void) => (e: React.MouseEvent) =>
  e.altKey && e.shiftKey ? goMark('note', dir) : e.altKey ? goMark('speech', dir) : e.shiftKey ? goMark('bookmark', dir) : go();

export function TransportButtons({ className = '' }: { className?: string }) {
  const playing = usePlayback((s) => s.playing);
  const hasCues = useApp((s) => !!s.doc?.cues);
  const hasVideo = useApp((s) => !!s.videoUrl);
  const noMarks = !hasCues && !hasVideo;
  return (
    <div className={`transport-buttons ${className}`}>
      <button
        className="icon-btn"
        aria-label={t.player.first}
        title={`${t.player.first}\n${t.player.markHints.first}`}
        onClick={withMarks('first', goFirst)}
        disabled={noMarks}
      >
        <First />
      </button>
      <button
        className="icon-btn"
        aria-label={t.player.prev}
        title={`${t.player.prev} (↑)\n${t.player.markHints.prev}`}
        onClick={withMarks(-1, goPrev)}
        disabled={noMarks}
      >
        <Prev />
      </button>
      <button className="icon-btn" aria-label={t.player.back15} title={t.player.back15} onClick={() => skip(-15000)} disabled={!hasVideo}>
        <Back15 />
      </button>
      <button
        className="play-btn"
        aria-label={playing ? t.player.pause : t.player.play}
        title={t.player.playKey}
        onClick={() => player.toggle()}
        disabled={!hasVideo}
      >
        {playing ? <Pause /> : <Play />}
      </button>
      <button className="icon-btn" aria-label={t.player.forward15} title={t.player.forward15} onClick={() => skip(15000)} disabled={!hasVideo}>
        <Forward15 />
      </button>
      <button
        className="icon-btn"
        aria-label={t.player.next}
        title={`${t.player.next} (↓)\n${t.player.markHints.next}`}
        onClick={withMarks(1, goNext)}
        disabled={noMarks}
      >
        <Next />
      </button>
      <button
        className="icon-btn"
        aria-label={t.player.last}
        title={`${t.player.last}\n${t.player.markHints.last}`}
        onClick={withMarks('last', goLast)}
        disabled={noMarks}
      >
        <Last />
      </button>
    </div>
  );
}

/** Loop the subtitle under the playhead (L). */
export function LoopButton() {
  const looping = useLoop((s) => !!s.loop);
  const hasVideo = useApp((s) => !!s.videoUrl);
  return (
    <button
      className="btn sm toggle icon-toggle"
      aria-pressed={looping}
      aria-label={t.player.loop}
      title={t.player.loopHint}
      disabled={!hasVideo}
      onClick={toggleLoop}
    >
      <Loop />
    </button>
  );
}

/**
 * The player's buttons centred and the loop on the right, for side panels: small moves (play, next
 * line, loop it) without leaving the tool (Sync by ear, Shift times).
 */
export function PanelTransport() {
  return (
    <div className="panel-transport">
      <TransportButtons />
      <LoopButton />
    </div>
  );
}
