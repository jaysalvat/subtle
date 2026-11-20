/**
 * Scene notes in the timeline: a bubble on the ruler where a scene starts, a coloured band under the
 * ruler as far as the scene goes (to the next bubble, or the end), and the note's window: what the
 * AI should know about the scene, where it ends, and (while translating) translate it again.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';
import { cuesInScene, sceneEnd, sceneSpans, sortNotes, type SceneNote } from '../lib/sceneNotes';
import { formatTimecode } from '../lib/time';
import { player } from '../store/playback';
import { openNote, useNoteEditor } from '../store/sceneNoteEditor';
import { useApp } from '../store/store';
import { aiProblem } from '../mt/ai';
import { AutoTranslate } from './AutoTranslate';
import { CloseX, NoteIcon } from './Icons';

const NO_CUES: never[] = [];

interface View {
  viewStart: number;
  visibleMs: number;
  totalMs: number;
  xOf: (ms: number) => number;
  msOf: (clientX: number) => number;
}

/** Bubbles (on the ruler) and scene bands (under it). */
export function SceneNoteMarks({ viewStart, visibleMs, totalMs, xOf, msOf }: View) {
  const notes = useApp((s) => s.sceneNotes);
  const openId = useNoteEditor((s) => s.id);
  const sorted = sortNotes(notes);
  const end = viewStart + visibleMs;

  // Drag a bubble to move its scene's start; a click without moving opens the note.
  const drag = useRef<{ id: string; x: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent, n: SceneNote) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = { id: n.id, x: e.clientX, moved: false };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      if (!d.moved && Math.abs(ev.clientX - d.x) < 3) return;
      d.moved = true;
      useApp.getState().setSceneNote(d.id, { time: msOf(ev.clientX) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up, true);
      const d = drag.current;
      drag.current = null;
      if (d && !d.moved) openNote(openId === d.id ? null : d.id);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, true);
  };

  return (
    <>
      {sceneSpans(notes, totalMs)
        .filter((s) => s.to >= viewStart && s.from <= end)
        .map((s) => {
          const left = Math.max(0, xOf(s.from));
          return (
            <div
              key={`band-${s.note.id}`}
              className={`tl-scene ${s.alt ? 'b' : 'a'}`}
              style={{ left, width: Math.max(2, xOf(Math.min(s.to, end + 1000)) - left) }}
            />
          );
        })}
      {sorted
        .filter((n) => n.time >= viewStart - 2000 && n.time <= end)
        .map((n) => (
          <button
            key={n.id}
            className={`tl-note ${n.text.trim() ? '' : 'empty'} ${openId === n.id ? 'open' : ''}`}
            style={{ left: xOf(n.time) }}
            data-note={n.id}
            title={n.text.trim() || t.notes.emptyTitle}
            aria-label={t.notes.open}
            onPointerDown={(e) => onDown(e, n)}
          >
            <NoteIcon size={12} />
          </button>
        ))}
    </>
  );
}

/** The scenes over the whole film, on the colour strip under the video (same colours as the timeline). */
export function SceneStripBands({ totalMs }: { totalMs: number }) {
  const notes = useApp((s) => s.sceneNotes);
  return (
    <>
      {sceneSpans(notes, totalMs).map((s) => (
        <div
          key={s.note.id}
          className={`strip-scene ${s.alt ? 'b' : 'a'}`}
          style={{ left: `${(s.from / totalMs) * 100}%`, width: `${Math.max(0.2, ((s.to - s.from) / totalMs) * 100)}%` }}
          title={s.note.text.trim()}
        />
      ))}
    </>
  );
}

/** The open note's window, under its bubble. */
export function SceneNoteEditor() {
  const id = useNoteEditor((s) => s.id);
  const note = useApp((s) => s.sceneNotes.find((n) => n.id === id) ?? null);
  const notes = useApp((s) => s.sceneNotes);
  // A constant when there are no subtitles (a video alone): a new [] each time loops React.
  const cues = useApp((s) => s.doc?.cues ?? NO_CUES);
  const translating = useApp((s) => !!s.translation);
  // Only an AI model reads the notes (the one set up, even when Chrome translates): else they're notes for the user.
  const ai = useApp((s) => !aiProblem(s.settings));
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Under the bubble (it may move while dragged or scrolled).
  useLayoutEffect(() => {
    if (!id) return;
    const place = () => {
      const b = document.querySelector(`[data-note="${id}"]`)?.getBoundingClientRect();
      if (!b) return;
      const w = 480;
      const left = Math.min(Math.max(8, b.left - 24), window.innerWidth - w - 8);
      // Above the bubble (the timeline is low, the picture is above), under it when there's no room.
      const h = box.current?.offsetHeight ?? 320;
      const top = b.top - 10 - h >= 8 ? b.top - 10 - h : Math.min(b.bottom + 10, window.innerHeight - h - 8);
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
    };
    // At once (animation frames don't run in a background tab), then following the bubble.
    place();
    let raf = requestAnimationFrame(function follow() {
      place();
      raf = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(raf);
  }, [id]);

  // A click elsewhere or Escape closes it (the text is kept as typed).
  useEffect(() => {
    if (!id) return;
    // Not while the scene is being translated: closing would stop it.
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element;
      if (useApp.getState().autoTranslating) return;
      if (!box.current?.contains(el) && !el.closest?.('.tl-note')) openNote(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useApp.getState().autoTranslating) {
        e.stopPropagation();
        openNote(null);
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [id]);

  // The footer spot where AutoTranslate puts "Translate this scene again".
  const [startSlot, setStartSlot] = useState<HTMLSpanElement | null>(null);
  if (!note || !pos) return null;
  const until = sceneEnd(notes, note);
  const scene = note.text.trim() ? cuesInScene(cues, notes, note) : [];
  const set = (text: string) => useApp.getState().setSceneNote(note.id, { text });
  return createPortal(
    <div ref={box} className="note-pop" role="dialog" aria-label={t.notes.title} style={{ left: pos.left, top: pos.top }}>
      <div className="note-pop-head">
        <strong>{t.notes.title}</strong>
        <button className="link-btn tnum" title={t.notes.goHint} onClick={() => player.seek(note.time)}>
          {formatTimecode(note.time).slice(0, 8)}
        </button>
        <span className="muted">→</span>
        {until === null ? (
          <span className="muted">{t.notes.toEnd}</span>
        ) : (
          <button className="link-btn tnum" title={t.notes.goHint} onClick={() => player.seek(until)}>
            {formatTimecode(until).slice(0, 8)}
          </button>
        )}
        <span className="spacer" />
        <button className="icon-btn" aria-label={t.common.close} onClick={() => openNote(null)}>
          <CloseX />
        </button>
      </div>
      <textarea
        className="input"
        rows={6}
        autoFocus
        value={note.text}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          // Enter: done (the note is kept as typed); Shift+Enter: a new line.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            openNote(null);
          }
        }}
      />
      <p className="note">{note.text.trim() ? t.notes.help(until === null, ai) : t.notes.emptyHelp}</p>
      {translating && ai && note.text.trim() && scene.length > 0 && <AutoTranslate compact ai only={scene.map((c) => c.id)} startIn={startSlot} />}
      <div className="note-pop-foot">
        <button
          className="btn sm danger"
          onClick={() => {
            useApp.getState().removeSceneNote(note.id);
            openNote(null);
          }}
        >
          {t.notes.remove}
        </button>
        <span className="spacer" />
        <span ref={setStartSlot} className="start-slot" />
        <button className="btn sm primary" onClick={() => openNote(null)}>
          {t.notes.done}
        </button>
      </div>
    </div>,
    document.body,
  );
}
