/** The timeline's head: reading progress (dialogue, images) or why there's none, insert / bookmark / note, display toggles, zoom. */
import { t } from '../../i18n';
import { addBookmarkHere, addSceneNoteHere, insertAtPlayhead } from '../../actions';
import { usePlayback } from '../../store/playback';
import { useApp } from '../../store/store';
import { useSupport } from '../../store/support';
import { useThumbs } from '../../store/thumbs';
import { useWaveform } from '../../store/waveform';
import { BookmarkIcon, Film, FollowIcon, NoteIcon, Plus, SnapIcon, Waveform, ZoomInIcon, ZoomOutIcon } from '../Icons';
import { ProgressBadge } from '../Progress';
import { AiPill } from '../Pill';
import { MAX_PPS, MIN_PPS } from './useTimelineView';
import { decimal } from '../../lib/locale';

export function TimelineHead({
  pps,
  visibleMs,
  zoomTo,
  follow,
  setFollow,
}: {
  pps: number;
  visibleMs: number;
  zoomTo: (pps: number) => void;
  follow: boolean;
  setFollow: (v: boolean) => void;
}) {
  const creating = useApp((s) => s.creatingSubs);
  const showWaveform = useApp((s) => s.settings.showWaveform);
  const showFilmstrip = useApp((s) => s.settings.showFilmstrip);
  const snapping = useApp((s) => s.settings.snapping);
  const setSettings = useApp((s) => s.setSettings);
  const followPaused = usePlayback((s) => s.followPaused);
  const setFollowPaused = usePlayback((s) => s.setFollowPaused);
  const images = useThumbs((s) => (s.status === 'reading' ? Math.round(s.progress * 100) : s.status));
  const imagesStart = useThumbs((s) => s.startedAt);
  const audio = useWaveform((s) => (s.status === 'reading' ? Math.round(s.progress * 100) : s.status));
  const audioStart = useWaveform((s) => s.startedAt);
  const decodes = useSupport((s) => !s.missing.includes('codecs'));
  return (
    <div className="timeline-head">
      <span style={{ fontWeight: 600 }}>{t.timeline.title}</span>
      {/* Longest first (dialogue), so the other one ending doesn't move it. */}
      {typeof audio === 'number' && <ProgressBadge text={t.timeline.readingAudio} frac={audio / 100} startedAt={audioStart} />}
      {typeof images === 'number' && <ProgressBadge text={t.timeline.readingVideo} frac={images / 100} startedAt={imagesStart} />}
      {/* Nothing could be read: say why instead of an empty track. */}
      {audio === 'unavailable' && <span className="dim timeline-note">{decodes ? t.support.noSound : t.support.noWaveform}</span>}
      {images === 'unavailable' && !decodes && <span className="dim timeline-note">{t.support.noImages}</span>}
      <span className="spacer" />
      <div className="toggle-group" role="group" aria-label={t.timeline.actions}>
        <button
          className="btn sm icon-toggle"
          aria-label={t.tools.insertHint}
          title={t.tools.insertHint}
          disabled={creating}
          onClick={() => insertAtPlayhead()}
        >
          <Plus />
        </button>
        <button className="btn sm icon-toggle" aria-label={t.bookmarks.addButton} title={t.bookmarks.addButton} onClick={addBookmarkHere}>
          <BookmarkIcon />
        </button>
        <button className="btn sm icon-toggle" aria-label={t.notes.add} title={t.notes.add} onClick={addSceneNoteHere}>
          <NoteIcon />
          <AiPill corner />
        </button>
      </div>
      {/* Display and behaviour toggles. */}
      <div className="toggle-group" role="group" aria-label={t.timeline.show}>
        {(audio === 'ready' || typeof audio === 'number') && (
          <button
            className="btn sm toggle icon-toggle"
            aria-pressed={showWaveform}
            aria-label={t.timeline.waveform}
            title={t.timeline.waveform}
            onClick={() => setSettings({ showWaveform: !showWaveform })}
          >
            <Waveform />
          </button>
        )}
        {images === 'ready' && (
          <button
            className="btn sm toggle icon-toggle"
            aria-pressed={showFilmstrip}
            aria-label={t.timeline.filmstrip}
            title={t.timeline.filmstrip}
            onClick={() => setSettings({ showFilmstrip: !showFilmstrip })}
          >
            <Film />
          </button>
        )}
        <button
          className="btn sm toggle icon-toggle"
          aria-pressed={snapping}
          aria-label={t.timeline.snap}
          title={t.timeline.snap}
          onClick={() => setSettings({ snapping: !snapping })}
        >
          <SnapIcon />
        </button>
        <button
          className="btn sm toggle icon-toggle"
          aria-pressed={follow && !followPaused}
          aria-label={t.timeline.follow}
          title={t.timeline.follow}
          onClick={() => {
            if (followPaused) {
              setFollowPaused(false);
              setFollow(true);
            } else setFollow(!follow);
          }}
        >
          <FollowIcon />
        </button>
      </div>
      <div className="zoom">
        <div className="toggle-group" role="group" aria-label={t.timeline.zoom}>
          <button
            className="btn sm icon-toggle"
            aria-label={t.timeline.zoomOut}
            title={t.timeline.zoomOutHint}
            disabled={pps <= MIN_PPS}
            onClick={() => zoomTo(pps / 1.5)}
          >
            <ZoomOutIcon />
          </button>
          <button
            className="btn sm icon-toggle"
            aria-label={t.timeline.zoomIn}
            title={t.timeline.zoomInHint}
            disabled={pps >= MAX_PPS}
            onClick={() => zoomTo(pps * 1.5)}
          >
            <ZoomInIcon />
          </button>
        </div>
        <span className="tnum" style={{ fontSize: 'var(--fs-s)', width: 56 }}>
          {visibleMs >= 60000 ? `${decimal(visibleMs / 60000, 1)} min` : `${Math.round(visibleMs / 1000)} s`}
        </span>
      </div>
    </div>
  );
}
