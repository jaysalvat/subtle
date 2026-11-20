/** The shell every window shares (title, ✕, body, footer, Escape), and pieces several use. */
import { ask } from '../Confirm';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { type ShiftScope } from '../../lib/tools';
import { formatTimecode, parseTimestamp } from '../../lib/time';
import { player } from '../../store/playback';
import { useApp } from '../../store/store';
import { CloseX } from '../Icons';
import { CueNumber } from '../CueNumber';
import type { Cue } from '../../lib/types';

export function Dialog({
  title,
  children,
  footer,
  wide,
  className = '',
  onClose = close,
  onEnter,
  alert,
}: {
  title: string;
  /** Warnings / good news (Alert), first in the body, under the title. */
  alert?: ReactNode;
  children: ReactNode;
  /** Buttons at the bottom; none: no footer. */
  footer?: ReactNode;
  wide?: boolean;
  /** Extra class on the window (e.g. a fixed height). */
  className?: string;
  /** What ✕, Escape and a click outside do: close the app's window (store `dialog`) by default. */
  onClose?: () => void;
  /** Enter in a field (not a list to pick from): the main action, e.g. apply. */
  onEnter?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    // The first field or main button; else the window itself, so Escape reaches it.
    (ref.current?.querySelector<HTMLElement>('input, textarea, select, button.primary') ?? ref.current)?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`dialog ${wide ? 'wide' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          const el = e.target as HTMLElement;
          if (e.key === 'Enter' && onEnter && el.tagName === 'INPUT' && !el.closest('.combo')) {
            e.preventDefault();
            onEnter();
          }
          e.stopPropagation();
        }}
      >
        <div className="dialog-head">
          <h2>{title}</h2>
          <span className="spacer" />
          <button className="icon-btn" aria-label={t.common.close} onClick={onClose}>
            <CloseX />
          </button>
        </div>
        <div className="dialog-body">
          {alert}
          {children}
        </div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Close the dialog; while a translation is running, ask first (closing stops it). */
export async function close() {
  if (useApp.getState().autoTranslating && !(await ask({ ...t.mt.closeConfirm, danger: true }))) return;
  useApp.getState().openDialog(null);
}

export function Scope({ value, onChange, allowFrom }: { value: ShiftScope; onChange: (s: ShiftScope) => void; allowFrom?: boolean }) {
  const n = useApp((s) => s.selection.length);
  return (
    <>
      <div className="group-title">{t.common.applyTo}</div>
      <div className="radio-row" role="radiogroup" aria-label={t.common.applyTo}>
        <label>
          <input type="radio" checked={value === 'all'} onChange={() => onChange('all')} /> {t.common.all}
        </label>
        <label>
          <input type="radio" disabled={!n} checked={value === 'selection'} onChange={() => onChange('selection')} /> {t.common.selection} ({n})
        </label>
        {allowFrom && (
          <label>
            <input type="radio" disabled={!n} checked={value === 'fromSelected'} onChange={() => onChange('fromSelected')} /> {t.common.fromSelected}
          </label>
        )}
      </div>
    </>
  );
}

export function TimeField({ label, value, onChange }: { label: string; value: number; onChange: (ms: number) => void }) {
  const [text, setText] = useState(formatTimecode(value));
  useEffect(() => setText(formatTimecode(value)), [value]);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        className="input tnum"
        style={{ width: 130 }}
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = parseTimestamp(text);
          if (Number.isFinite(v)) onChange(v);
          else setText(formatTimecode(value));
        }}
      />
      <button className="btn sm" onClick={() => onChange(Math.round(player.now()))}>
        {t.common.usePlayhead}
      </button>
    </div>
  );
}

const NO_CUES: Cue[] = [];

/** Each subtitle's number (1, 2…) by its id, for previews and lists. */
export function useCueNumbers(): Map<string, number> {
  const cues = useApp((s) => s.doc?.cues ?? NO_CUES);
  return useMemo(() => new Map(cues.map((c, i) => [c.id, i + 1])), [cues]);
}

/** Before → after for the subtitles a tool changes (the first 300), numbered. */
export function DiffPreview({
  items,
  show = (s) => s,
  removed,
  className = '',
}: {
  items: { id: string; before: string; after: string }[];
  /** How a text is shown (e.g. with its spaces made visible). */
  show?: (text: string) => ReactNode;
  /** Ids that become empty and go: "Deleted" instead of the after. */
  removed?: Set<string>;
  className?: string;
}) {
  const numbers = useCueNumbers();
  if (!items.length) return null;
  return (
    <div className={`diff ${className}`} aria-label={t.common.preview}>
      {items.slice(0, 300).map((c) => (
        <div className="diff-row" key={c.id}>
          <CueNumber n={numbers.get(c.id)!} />
          <span className="before">{show(c.before)}</span>
          <span className={`after ${removed?.has(c.id) ? 'removed' : ''}`}>{removed?.has(c.id) ? t.common.deleted : show(c.after)}</span>
        </div>
      ))}
    </div>
  );
}
