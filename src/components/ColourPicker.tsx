/**
 * The selected subtitle's colour (Pro mode, in its row): a dot showing the colour, a click opens
 * five colours readable over a picture (WebVTT's, so they're kept exactly in every format), then
 * Others — the colours this file already uses, picked again in one click, and + for the system's
 * picker (VTT keeps its nearest of 8) —, then No colour.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { recolourEverywhere, setCueColour } from '../actions';
import { usedColours } from '../lib/colour';
import { useApp } from '../store/store';
import { Plus } from './Icons';

export const PALETTE = { yellow: '#FFFF00', cyan: '#00FFFF', green: '#00FF00', magenta: '#FF00FF', red: '#FF0000' } as const;

/** `onPick`: what a colour does (the selected subtitles by default); `recolour`: ⇧-click on Others recolours the file. */
export function ColourPicker({
  colour,
  onPick = setCueColour,
  recolour: canRecolour = true,
}: {
  colour: string | null;
  onPick?: (c: string | null) => void;
  recolour?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // The file's own colours, read when the palette opens.
  const others = useMemo(() => {
    if (!open) return [];
    const cues = useApp.getState().doc?.cues ?? [];
    return usedColours(
      cues.flatMap((c) => [c.text, c.target ?? '']),
      Object.values(PALETTE),
    );
  }, [open]);
  const wrap = useRef<HTMLDivElement>(null);
  const other = useRef<HTMLInputElement>(null);
  /** ⇧-click on one of Others: the system's picker set on it, the new colour put everywhere it's used. */
  const recolour = useRef<HTMLInputElement>(null);
  const recolouring = useRef<string | null>(null);
  useEffect(() => {
    const el = recolour.current;
    if (!el) return;
    const done = () => {
      const from = recolouring.current;
      recolouring.current = null;
      if (from && el.value.toUpperCase() !== from) recolourEverywhere(from, el.value);
      setOpen(false);
    };
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  });
  const startRecolour = (c: string) => {
    const el = recolour.current;
    if (!el) return;
    recolouring.current = c;
    el.value = c.toLowerCase();
    if (el.showPicker) el.showPicker();
    else el.click();
  };
  // The system picker: applied once it's chosen ("change"), not at every move (one undo step).
  useEffect(() => {
    const el = other.current;
    if (!el) return;
    const done = () => pick(el.value);
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  });
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false));
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  const pick = (c: string | null) => {
    onPick(c);
    setOpen(false);
  };
  return (
    <div className="colour-picker" ref={wrap}>
      <button
        className={`icon-btn sm ${colour ? 'pressed' : ''}`}
        aria-label={t.list.colour}
        aria-expanded={open}
        title={t.list.colourHint}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`colour-dot ${colour ? '' : 'none'}`} style={colour ? { background: colour } : undefined} />
      </button>
      {open && (
        <div className="menu-list right colour-pop" role="menu" aria-label={t.list.colour}>
          <div className="colour-swatches">
            {(Object.keys(PALETTE) as (keyof typeof PALETTE)[]).map((k) => (
              <button
                key={k}
                role="menuitemradio"
                aria-checked={colour === PALETTE[k]}
                className={`colour-swatch ${colour === PALETTE[k] ? 'on' : ''}`}
                style={{ background: PALETTE[k] }}
                aria-label={t.list.colourNames[k]}
                title={t.list.colourNames[k]}
                onClick={() => pick(PALETTE[k])}
              />
            ))}
          </div>
          <div className="menu-section colour-section">{t.list.otherColours}</div>
          <div className="colour-swatches">
            {others.map((c) => (
              <button
                key={c}
                role="menuitemradio"
                aria-checked={colour === c}
                className={`colour-swatch ${colour === c ? 'on' : ''}`}
                style={{ background: c }}
                aria-label={c}
                title={canRecolour ? t.list.recolourHint(c) : c}
                onClick={(e) => (e.shiftKey && canRecolour ? startRecolour(c) : pick(c))}
              />
            ))}
            <input ref={recolour} type="color" className="colour-recolour" tabIndex={-1} aria-hidden="true" />
            <label className="colour-swatch colour-add" title={t.list.otherColour}>
              <Plus />
              <input ref={other} type="color" defaultValue={colour ?? '#FFFFFF'} aria-label={t.list.otherColour} />
            </label>
          </div>
          <button className="menu-item" role="menuitem" disabled={!colour} onClick={() => pick(null)}>
            <span className="colour-dot none" />
            <span className="menu-label">{t.list.noColour}</span>
          </button>
        </div>
      )}
    </div>
  );
}
