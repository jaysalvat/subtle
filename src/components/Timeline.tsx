/**
 * The timeline: head, ruler, filmstrip, waveform and subtitle blocks, playhead. Its parts are in
 * ./timeline: the view (zoom, scroll, playhead), dragging blocks, scrolling by hand, the head, the
 * ruler, the blocks.
 */
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { formatDuration, formatTimecode } from '../lib/time';
import type { Cue } from '../lib/types';
import { insertAtPlayhead, insertOnSpeech } from '../actions';
import { speechSlot } from '../lib/tools';
import { useWaveform } from '../store/waveform';
import { usePlayback } from '../store/playback';
import { useApp } from '../store/store';
import { useThumbs } from '../store/thumbs';
import { TimelineStrip } from './Filmstrip';
import { SceneNoteEditor } from './SceneNotes';
import { WaveformCanvas } from './Waveform';
import { Blocks } from './timeline/Blocks';
import { BookmarkLines, Ruler } from './timeline/Ruler';
import { TimelineHead } from './timeline/TimelineHead';
import { useCueDrag } from './timeline/useCueDrag';
import { usePan } from './timeline/usePan';
import { useTimelineView } from './timeline/useTimelineView';

const NO_CUES: Cue[] = [];

export function Timeline() {
  const cues = useApp((s) => s.doc?.cues ?? NO_CUES);
  const hasDoc = useApp((s) => !!s.doc);
  // Shown with subtitles, or with a video alone (images, dialogue; insert to start new subtitles).
  const hasVideo = useApp((s) => !!s.videoUrl);
  const lastSelected = useApp((s) => s.selection[s.selection.length - 1]);
  const showFilmstrip = useApp((s) => s.settings.showFilmstrip);
  const duration = usePlayback((s) => s.duration);
  const images = useThumbs((s) => s.status);
  const imagesReading = images === 'reading';
  // While thumbnails are being read, the strip's space is kept empty (no jump when it appears).
  const stripSpace = showFilmstrip && (images === 'ready' || imagesReading);
  const strip = showFilmstrip && images === 'ready';

  const bodyRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ cue: Cue; x: number } | null>(null);
  const lastEnd = cues.length ? cues[cues.length - 1].end : 0;
  const totalMs = Math.max(duration, lastEnd) + 5000;

  // Hooks stay above the early return below (same hooks on every render).
  const busy = useRef<() => boolean>(() => false);
  const view = useTimelineView({ bodyRef, playheadRef, cues, lastSelected, totalMs, shown: hasDoc || hasVideo, busy: () => busy.current() });
  const { viewStart, pps, visibleMs, xOf, msOf, width } = view;
  const shown = cues.filter((c) => c.end >= viewStart - 1000 && c.start <= viewStart + visibleMs + 1000);
  const drag = useCueDrag({ cues, shown, pps, msOf, onStart: () => setHover(null) });
  busy.current = drag.dragging;
  const { pan, panning, band, track, body } = usePan({ viewStart, pps, clampView: view.clampView, setViewStart: view.setViewStart, msOf });

  // Pick a line of dialogue: ⌥ over the dialogue waveform lights the speech under the mouse (where
  // no subtitle is), ⌥-click makes it an empty subtitle ready to type (`insertOnSpeech`).
  const spans = useWaveform((s) => s.dialogue?.spans ?? null);
  const gap = useApp((s) => s.settings.minGapMs);
  const floor = useApp((s) => s.settings.floorDurationMs);
  const [pick, setPick] = useState<{ start: number; end: number } | null>(null);
  const mouseX = useRef<number | null>(null);
  const slotAt = (clientX: number) => (spans ? speechSlot(cues, spans, msOf(clientX), { minGapMs: gap, floorDurationMs: floor }) : null);
  const slotRef = useRef(slotAt);
  slotRef.current = slotAt;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      setPick(e.type === 'keydown' && mouseX.current !== null ? slotRef.current(mouseX.current) : null);
    };
    const off = () => setPick(null);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      window.removeEventListener('blur', off);
    };
  }, []);
  const trackEvents = {
    ...track,
    onPointerMove: (e: React.PointerEvent) => {
      mouseX.current = e.clientX;
      setPick(e.altKey && !drag.dragging() ? slotAt(e.clientX) : null);
      track.onPointerMove(e);
    },
    onPointerLeave: () => {
      mouseX.current = null;
      setPick(null);
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button === 0 && e.altKey && slotAt(e.clientX)) {
        e.preventDefault();
        insertOnSpeech(msOf(e.clientX));
        setPick(null);
        return;
      }
      track.onPointerDown(e);
    },
  };

  if (!hasDoc && !hasVideo) {
    return (
      <section className="timeline" aria-label={t.timeline.title}>
        <div className="timeline-head">
          <span style={{ fontWeight: 600 }} className="muted">
            {t.timeline.title}
          </span>
        </div>
        <div className="tl-empty">{t.timeline.empty}</div>
      </section>
    );
  }

  return (
    <section className={`timeline ${stripSpace ? 'has-strip' : ''}`} aria-label={t.timeline.title}>
      <TimelineHead pps={pps} visibleMs={visibleMs} zoomTo={view.zoomTo} follow={view.follow} setFollow={view.setFollow} />
      <div
        className="tl-body"
        ref={bodyRef}
        onWheel={view.onWheel}
        onPointerDownCapture={body.onPointerDownCapture}
        onPointerMove={body.onPointerMove}
        onPointerUp={body.onPointerUp}
        onMouseDown={(e) => e.button === 1 && e.preventDefault() /* no browser autoscroll */}
      >
        <Ruler viewStart={viewStart} pps={pps} visibleMs={visibleMs} totalMs={totalMs} xOf={xOf} msOf={msOf} />
        <SceneNoteEditor />
        <BookmarkLines viewStart={viewStart} visibleMs={visibleMs} xOf={xOf} />
        {strip && <TimelineStrip viewStart={viewStart} pps={pps} width={width} pan={pan} />}
        <div
          className={`track ${panning ? 'panning' : ''}`}
          {...trackEvents}
          onDoubleClick={(e) => {
            if (e.target === e.currentTarget) insertAtPlayhead(msOf(e.clientX));
          }}
        >
          <WaveformCanvas viewStart={viewStart} pps={pps} width={width} />
          {pick && (
            <div
              className="dialogue-pick"
              style={{ left: xOf(pick.start), width: Math.max(2, ((pick.end - pick.start) / 1000) * pps) }}
              title={t.timeline.pickDialogue}
            />
          )}
          <Blocks
            shown={shown}
            xOf={xOf}
            pps={pps}
            draggingId={drag.draggingId}
            onBlockDown={drag.onBlockDown}
            onBlockMove={drag.onBlockMove}
            onHover={(c, e) => setHover(c && e && !drag.dragging() ? { cue: c, x: e.clientX - bodyRef.current!.getBoundingClientRect().left } : null)}
          />
        </div>
        <div className={`tl-pan ${panning ? 'panning' : ''}`} {...track} />
        {band && <div className="tl-band" style={{ left: Math.min(xOf(band.from), xOf(band.to)), width: Math.abs(xOf(band.to) - xOf(band.from)) }} />}
        <div className="playhead" ref={playheadRef} style={{ left: 0 }} />
        {hover && (
          <div className="tl-tooltip" style={{ left: Math.min(Math.max(0, hover.x - 60), width - 260) }}>
            {formatTimecode(hover.cue.start)} – {formatTimecode(hover.cue.end)} · {formatDuration(hover.cue.end - hover.cue.start)}
          </div>
        )}
        <div className="tl-hint">
          <span>{t.timeline.hint1}</span>
          <span>{t.timeline.hint2}</span>
        </div>
      </div>
    </section>
  );
}
