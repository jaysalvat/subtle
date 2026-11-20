import { ProgressBadge, Spinner } from './Progress';
import { SidePanel } from './SidePanel';
import { normColour } from '../lib/colour';
import { middleEllipsis } from '../lib/filename';
import { reopenVideo } from '../store/file';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { cueAt } from '../lib/tools';
import { isTop } from '../lib/position';
import { fpsLabel } from '../lib/fps';
import { formatTimecode, parseUserTime } from '../lib/time';
import { player, usePlayback } from '../store/playback';
import { useApp } from '../store/store';
import { goToBookmark } from '../actions';
import { LoopButton, TransportButtons } from './TransportButtons';

import { DropZone, VIDEO_ACCEPT } from './DropZone';
import { FindTextIcon, MovieIcon } from './Icons';
import { AiPill } from './Pill';
import { closeOcr, createFromLine, createFromText, findTextInPicture, setDraft, togglePicked, useOcr } from '../store/ocr';
import { PlayerMiniStrip } from './Filmstrip';
import { useThumbs } from '../store/thumbs';

/** Renders <i>, <b>, <u>, <font color> and strips other tags ({\an8}, <c>…). Returns placement too. */
export function renderCueText(text: string): { nodes: ReactNode[]; top: boolean } {
  const an = /\{\\an(\d)\}/.exec(text);
  const top = !!an && ['7', '8', '9'].includes(an[1]);
  const clean = text.replace(/\{\\[^}]*\}/g, '');
  const nodes: ReactNode[] = [];
  const re = /<(\/?)([ibu])>|<(\/?)font\b([^>]*)>|<[^>]+>/gi;
  /** What's open: a tag, or a colour ("#RRGGBB"; null for a <font> without one). */
  const stack: (string | null)[] = [];
  let last = 0;
  let k = 0;
  const push = (s: string) => {
    if (!s) return;
    let node: ReactNode = s;
    for (const tag of [...stack].reverse()) {
      if (tag === null) continue;
      node =
        tag === 'i' ? (
          <i key={k++}>{node}</i>
        ) : tag === 'b' ? (
          <b key={k++}>{node}</b>
        ) : tag === 'u' ? (
          <u key={k++}>{node}</u>
        ) : (
          <span key={k++} style={{ color: tag }}>
            {node}
          </span>
        );
    }
    nodes.push(<span key={k++}>{node}</span>);
  };
  const close = (match: (x: string | null) => boolean) => {
    for (let at = stack.length - 1; at >= 0; at--) if (match(stack[at])) return void stack.splice(at, 1);
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    push(clean.slice(last, m.index));
    last = m.index + m[0].length;
    if (stack.length >= 8 && !m[1] && !m[3]) continue; // thousands of unclosed tags would nest without end
    if (m[2]) {
      const tag = m[2].toLowerCase();
      if (m[1]) close((x) => x === tag);
      else stack.push(tag);
    } else if (m[3] !== undefined && /^<\/?font/i.test(m[0])) {
      if (m[3]) close((x) => x === null || x.startsWith('#'));
      else stack.push(normColour(/color\s*=\s*["']?([^"'\s>]+)/i.exec(m[4] ?? '')?.[1]));
    }
  }
  push(clean.slice(last));
  return { nodes, top };
}

function Overlay() {
  const cues = useApp((s) => s.doc?.cues);
  const translation = useApp((s) => s.translation);
  const display = useApp((s) => s.display);
  const idx = usePlayback((s) => (cues ? cueAt(cues, s.time) : -1));
  const frameRef = useRef<HTMLParagraphElement>(null);
  if (!cues || idx < 0) return null;
  const c = cues[idx];
  const src = renderCueText(c.text);
  const showTarget = translation && display !== 'source';
  const tgt = showTarget ? renderCueText(c.target ?? '') : null;
  return (
    <p ref={frameRef} className={`overlay ${isTop(c) ? 'top' : 'bottom'}`} style={{ fontSize: 'clamp(14px, 2.6vw, 30px)' }}>
      {translation && display === 'both' && <span className="src">{src.nodes}</span>}
      {showTarget ? tgt!.nodes : src.nodes}
    </p>
  );
}

/** Seek bar under the video: played part, one tick per subtitle, hover time, click / drag to seek. */
function Scrubber() {
  const bookmarks = useApp((s) => s.bookmarks);
  const time = usePlayback((s) => s.time);
  const duration = usePlayback((s) => s.duration);
  const cues = useApp((s) => s.doc?.cues);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playedCanvasRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; ms: number } | null>(null);
  const lastEnd = cues?.length ? cues[cues.length - 1].end : 0;
  const total = Math.max(duration, lastEnd, 1);

  // Subtitle ticks drawn on canvases: cheap even with thousands of cues.
  // Two layers with the same ticks: light on the unplayed part, dark on the played (accent) part.
  useEffect(() => {
    const layers = [
      { c: canvasRef.current, token: '--scrub-cue' },
      { c: playedCanvasRef.current, token: '--scrub-cue-played' },
    ];
    const draw = () => {
      for (const { c, token } of layers) {
        if (!c) continue;
        const w = c.clientWidth;
        const h = c.clientHeight || 6;
        const dpr = window.devicePixelRatio || 1;
        c.width = w * dpr;
        c.height = h * dpr;
        const ctx = c.getContext('2d')!;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = getComputedStyle(c).getPropertyValue(token).trim();
        for (const cue of cues ?? []) {
          const x = (cue.start / total) * w;
          const cw = Math.max(1, ((cue.end - cue.start) / total) * w);
          ctx.fillRect(x, 0, cw, h);
        }
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (canvasRef.current) ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [cues, total]);

  const msAt = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * total;
  };
  const pct = Math.min(100, (time / total) * 100);

  return (
    <div
      className="scrubber"
      ref={barRef}
      role="slider"
      tabIndex={-1}
      aria-label={t.player.seek}
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={formatTimecode(time)}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        player.seek(msAt(e.clientX));
        usePlayback.getState().setFollowPaused(false);
      }}
      onPointerMove={(e) => {
        const r = barRef.current!.getBoundingClientRect();
        setHover({ x: e.clientX - r.left, ms: msAt(e.clientX) });
        if (e.buttons === 1) player.seek(msAt(e.clientX));
      }}
      onPointerLeave={() => setHover(null)}
    >
      <div className="scrub-track">
        <div className="scrub-played" style={{ width: `${pct}%` }} />
        <canvas ref={canvasRef} className="scrub-cues" style={{ clipPath: `inset(0 0 0 ${pct}%)` }} />
        <canvas ref={playedCanvasRef} className="scrub-cues" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }} />
        <div className="scrub-knob" style={{ left: `${pct}%` }} />
      </div>
      {bookmarks.map((b) => (
        <button
          key={b.id}
          className="scrub-bookmark"
          style={{ left: `${Math.min(100, (b.time / total) * 100)}%` }}
          title={`${b.slot}. ${b.label} (${formatTimecode(b.time).slice(0, 8)})`}
          aria-label={`${b.slot}. ${b.label}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            goToBookmark(b.time);
          }}
        />
      ))}
      {hover && (
        <span className="scrub-tip tnum" style={{ left: hover.x }}>
          {formatTimecode(hover.ms).slice(0, 8)}
        </span>
      )}
    </div>
  );
}

/** Current time. Click to type a time and jump there (Enter), Escape or clicking away cancels. */
function Timecode({ time }: { time: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  if (draft === null) {
    return (
      <button className="timecode timecode-btn" title={t.player.typeTime} onClick={() => setDraft(formatTimecode(time))}>
        {formatTimecode(time)}
      </button>
    );
  }
  const go = () => {
    const ms = parseUserTime(draft);
    if (!Number.isFinite(ms)) return setBad(true);
    const end = usePlayback.getState().duration || Infinity;
    player.seek(Math.min(end, ms));
    usePlayback.getState().setFollowPaused(false);
    setDraft(null);
  };
  return (
    <input
      className={`timecode timecode-input ${bad ? 'bad' : ''}`}
      aria-label={t.player.typeTime}
      title={t.player.typeTimeHelp}
      value={draft}
      autoFocus
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        setDraft(e.target.value);
        setBad(false);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') go();
        if (e.key === 'Escape') setDraft(null);
      }}
      onBlur={() => {
        setDraft(null);
        setBad(false);
      }}
    />
  );
}

function Transport() {
  const fps = useThumbs((s) => s.fps);
  const time = usePlayback((s) => s.time);
  const duration = usePlayback((s) => s.duration);
  const rate = usePlayback((s) => s.rate);
  const cues = useApp((s) => s.doc?.cues);
  const hasVideo = useApp((s) => !!s.videoUrl);
  const translation = useApp((s) => s.translation);
  const display = useApp((s) => s.display);
  const setDisplay = useApp((s) => s.setDisplay);
  const idx = cues ? cueAt(cues, time) : -1;
  const lastEnd = cues?.length ? cues[cues.length - 1].end : 0;
  const total = Math.max(duration, lastEnd);
  const rates = [0.5, 0.75, 1, 1.25, 1.5, 2];

  return (
    <div className="transport">
      <TransportButtons />
      <div className="tnum" style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <Timecode time={time} />
        <span className="dim priority-high">/ {formatTimecode(total)}</span>
        {fps && <span className="dim priority-low">· {t.player.fps(fpsLabel(fps))}</span>}
      </div>
      <div className="spacer" />
      {cues && <span className="muted transport-count priority-medium">{idx >= 0 ? t.player.cueOf(idx + 1, cues.length) : t.player.between(cues.length)}</span>}
      {translation && (
        <select
          className="select"
          aria-label={t.player.show}
          title={t.player.showHint}
          value={display}
          onChange={(e) => setDisplay(e.target.value as typeof display)}
        >
          <option value="source">{t.player.source}</option>
          <option value="target">{t.player.target}</option>
          <option value="both">{t.player.both}</option>
        </select>
      )}
      <FindTextButton disabled={!hasVideo} />
      <LoopButton />
      <button
        className="btn sm"
        disabled={!hasVideo}
        title={t.player.speed}
        onClick={() => {
          const next = rates[(rates.indexOf(rate) + 1) % rates.length];
          usePlayback.getState().setRate(next);
          if (player.el) player.el.playbackRate = next;
        }}
      >
        {rate}×
      </button>
    </div>
  );
}

function StripSlot() {
  const show = useApp((s) => s.settings.showFilmstrip);
  const status = useThumbs((s) => s.status);
  if (!show) return null;
  if (status === 'ready') return <PlayerMiniStrip />;
  // While thumbnails are being read: keep the space empty so the layout doesn't jump when they appear.
  return status === 'reading' ? <div className="mini-strip placeholder" aria-hidden="true" /> : null;
}

export function Player() {
  const videoUrl = useApp((s) => s.videoUrl);
  const expectedVideo = useApp((s) => s.expectedVideo);
  const videoHandle = useApp((s) => s.videoHandle);
  const loadVideo = useApp((s) => s.loadVideoFile);
  const setVideoDuration = useApp((s) => s.setVideoDuration);
  const notify = useApp((s) => s.notify);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Frame-accurate time while playing: timeupdate fires only ~4×/s.
  useEffect(() => {
    const v = videoRef.current;
    player.attach(v);
    if (!v) return;
    let raf = 0;
    const tick = () => {
      usePlayback.getState().setTime(v.currentTime * 1000);
      raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      usePlayback.getState().setPlaying(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      usePlayback.getState().setPlaying(false);
      cancelAnimationFrame(raf);
      usePlayback.getState().setTime(v.currentTime * 1000);
    };
    const onSeeked = () => usePlayback.getState().setTime(v.currentTime * 1000);
    const onMeta = () => {
      const d = (v.duration || 0) * 1000;
      usePlayback.getState().setDuration(d);
      setVideoDuration(d);
      v.playbackRate = usePlayback.getState().rate;
      // Seek to where the user already is (e.g. navigated before dropping the video).
      v.currentTime = usePlayback.getState().time / 1000;
      // Chrome exposes decoded audio size; 0 after a while means the audio codec is not supported.
      setTimeout(() => {
        const anyV = v as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; mozHasAudio?: boolean };
        if (anyV.webkitAudioDecodedByteCount === 0 && !v.paused) notify(t.player.noAudio);
      }, 1500);
    };
    const onError = () => notify(t.player.unsupported);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onPause);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('error', onError);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onPause);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('error', onError);
      player.attach(null);
    };
  }, [videoUrl, notify, setVideoDuration]);

  return (
    <section className="player" aria-label={t.player.label}>
      {videoUrl ? (
        <div className="screen" onClick={() => useApp.getState().settings.clickToPlay && player.toggle()}>
          <div className="frame">
            <video ref={videoRef} src={videoUrl} preload="auto" />
            <Overlay />
            <OcrBoxes />
            <OcrPanel />
          </div>
        </div>
      ) : (
        <DropZone accept={VIDEO_ACCEPT} onFile={loadVideo} label={t.drop.video}>
          <MovieIcon color="var(--text-muted)" />
          <span className="title">{t.drop.video}</span>
          <span className="muted">
            {t.drop.videoOr} <span className="link">{t.drop.browse}</span>
          </span>
          {expectedVideo && videoHandle ? (
            <>
              <button
                className="btn primary"
                title={expectedVideo.name}
                onClick={(e) => {
                  // Not the zone's own file picker.
                  e.preventDefault();
                  e.stopPropagation();
                  void reopenVideo(() => {});
                }}
              >
                {t.drop.reopen(middleEllipsis(expectedVideo.name, 40))}
              </button>
              <span className="hint">{t.drop.reopenHint}</span>
            </>
          ) : (
            <span className="hint">{expectedVideo ? t.drop.expected(middleEllipsis(expectedVideo.name, 40)) : t.drop.videoHint}</span>
          )}
        </DropZone>
      )}
      <StripSlot />
      <Scrubber />
      <Transport />
    </section>
  );
}

/** Transport bar: read the text in the frame shown (OCR). */
function FindTextButton({ disabled }: { disabled: boolean }) {
  const phase = useOcr((s) => s.phase);
  const creating = useApp((s) => s.creatingSubs);
  return (
    <button
      className="btn sm toggle icon-toggle"
      aria-pressed={phase !== 'idle'}
      aria-label={t.ocr.button}
      title={t.ocr.buttonHint}
      disabled={disabled || creating}
      onClick={() => (phase === 'idle' ? void findTextInPicture() : closeOcr())}
    >
      {phase === 'reading' ? <Spinner /> : <FindTextIcon />}
      <AiPill corner />
    </button>
  );
}

/** Boxes on the lines of text found in the frame: click one to make a subtitle, ⇧-click to add several. */
function OcrBoxes() {
  const phase = useOcr((s) => s.phase);
  const lines = useOcr((s) => s.lines);
  const size = useOcr((s) => s.size);
  const picked = useOcr((s) => s.picked);
  const download = useOcr((s) => s.download);
  useEffect(() => {
    if (phase === 'idle') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeOcr();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [phase]);
  if (phase === 'idle' || !size) return null;
  return (
    <div className="ocr-layer" onClick={(e) => (e.stopPropagation(), e.target === e.currentTarget && closeOcr())}>
      {phase === 'reading' && (
        <ProgressBadge
          className="ocr-status"
          text={download && download.loaded < download.total ? t.ocr.downloadingModel : t.ocr.reading}
          frac={download && download.loaded < download.total ? download.loaded / download.total : undefined}
        />
      )}
      {phase === 'picking' && (
        <>
          {lines.map((l, i) => (
            <button
              key={i}
              className={`ocr-box ${picked.includes(i) ? 'picked' : ''}`}
              data-order={picked.includes(i) ? picked.indexOf(i) + 1 : undefined}
              style={{
                left: `${(l.x / size.w) * 100}%`,
                top: `${(l.y / size.h) * 100}%`,
                width: `${(l.w / size.w) * 100}%`,
                height: `${(l.h / size.h) * 100}%`,
                transform: l.angle ? `rotate(${l.angle}rad)` : undefined,
              }}
              title={l.text}
              aria-label={t.ocr.pick(l.text)}
              // ⇧-click picks lines in order; once some are picked, every click adds or removes one.
              onClick={(e) => (e.shiftKey || e.metaKey || picked.length ? togglePicked(i) : createFromLine(i))}
            />
          ))}
          {!picked.length && <div className="ocr-status">{t.ocr.hint}</div>}
        </>
      )}
    </div>
  );
}

/** Lines picked with ⇧-click: the proposed subtitle, editable, then Create. A side panel, so the picture stays visible. */
function OcrPanel() {
  const picked = useOcr((s) => s.picked);
  const draft = useOcr((s) => s.draft);
  const phase = useOcr((s) => s.phase);
  if (phase !== 'picking' || !picked.length) return null;
  return (
    <SidePanel title={t.ocr.panelTitle} className="ocr-panel" onClose={closeOcr} closeLabel={t.common.cancel}>
      <div className="dialog-body">
        <p className="note flush">{t.ocr.hintPicked(picked.length)}</p>
        <textarea
          className="input"
          rows={Math.min(5, Math.max(2, draft.split('\n').length))}
          value={draft}
          aria-label={t.ocr.draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              createFromText(draft);
            }
          }}
        />
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={closeOcr}>
          {t.common.cancel}
        </button>
        <button className="btn primary" disabled={!draft.trim()} title="⌘↩" onClick={() => createFromText(draft)}>
          {t.ocr.create}
        </button>
      </div>
    </SidePanel>
  );
}
