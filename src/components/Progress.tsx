/**
 * Progress for anything that takes a while. Two shapes, same parts (spinner, %, time left):
 * ProgressBand for long jobs with a Stop; ProgressBadge for background work shown inline
 * (dialogue and images in the timeline, OCR). Always use these.
 *
 * The one progress band for long jobs (subtitles from the audio, automatic translation, Shorten with
 * AI, model downloads): spinner, title, Stop, a bar, "n of N" or a percentage, the time left from
 * the pace so far (ticking every second), and an optional note under it. Always use this one.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { formatLeft, timeLeft } from '../lib/time';

interface Props {
  title: string;
  /** Work done and to do, any unit. */
  done: number;
  total: number;
  /** How to show the count: "12 of 80" (items), a percentage, or a text of its own. */
  show?: 'count' | 'percent' | { text: string };
  /** When the work started (ms): gives the time left once some is done. */
  startedAt?: number;
  onStop?: () => void;
  stopLabel?: string;
  note?: ReactNode;
  /** band: a strip under a header (the subtitle list); flush: the same at the top of a panel's body; plain: inline in a window. */
  variant?: 'band' | 'flush' | 'plain';
}

export const Spinner = () => <span className="spinner" aria-hidden="true" />;

/** Ticks every second while `on`: for times left that move. */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

/**
 * A small pill: spinner, text, the percentage (fixed width, so it doesn't grow from 9 % to 10 %)
 * and the time left once some is done. `frac` 0…1, omitted when unknown.
 */
export function ProgressBadge({ text, frac, startedAt, className = '' }: { text: string; frac?: number; startedAt?: number; className?: string }) {
  const now = useNow(startedAt !== undefined && frac !== undefined);
  const left = startedAt !== undefined && frac !== undefined ? timeLeft(startedAt, now, frac, 1) : null;
  return (
    <span className={`progress-badge ${className}`} role="status">
      <Spinner />
      {text}
      {frac !== undefined && <span className="badge-pct tnum">{Math.round(frac * 100)} %</span>}
      {left !== null && <span className="tnum">· {formatLeft(left)}</span>}
    </span>
  );
}

export function ProgressBand({ title, done, total, show = 'count', startedAt, onStop, stopLabel, note, variant = 'band' }: Props) {
  const now = useNow(startedAt !== undefined);
  const frac = total > 0 ? Math.min(1, done / total) : 0;
  const left = startedAt !== undefined ? timeLeft(startedAt, now, done, total) : null;
  const count = typeof show === 'object' ? show.text : show === 'percent' ? `${Math.round(frac * 100)} %` : t.progress.of(done, total);
  return (
    <div className={`progress-band ${variant}`} role="status">
      <div className="progress-head">
        <Spinner />
        <strong>{title}</strong>
        <span className="spacer" />
        {onStop && (
          <button className="btn sm" onClick={onStop}>
            {stopLabel ?? t.progress.stop}
          </button>
        )}
      </div>
      <div className="progress-line">
        <div className="bar">
          <div style={{ width: `${Math.max(2, frac * 100)}%` }} />
        </div>
        <span className="tnum muted">
          {count}
          {left !== null && ` · ${t.progress.left(formatLeft(left))}`}
        </span>
      </div>
      {note && <span className="note">{note}</span>}
    </div>
  );
}
