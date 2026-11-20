/**
 * An offset in time: − and + on each side (0.1 s, with ⇧ 1 s, held: repeats), the value in the
 * middle shown as "+1.5 s" and typed in seconds ("1,5", "-0.4", "1500 ms", "1:20.5"). Enter in it
 * reads what's typed, then `onEnter` with that value (e.g. apply).
 */
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { formatOffset, parseOffset } from '../lib/sync';

const STEP = 100;
const BIG_STEP = 1000;

export function OffsetInput({
  value,
  onChange,
  onEnter,
  label,
}: {
  value: number;
  onChange: (ms: number) => void;
  onEnter?: (ms: number) => void;
  label: string;
}) {
  const [text, setText] = useState<string | null>(null); // null: not being typed in
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const timer = useRef(0);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Changed from elsewhere (slider, guess, −/+) while not typed in: show the new value.
  useEffect(() => {
    if (document.activeElement !== field.current) setText(null);
  }, [value]);

  /** One step now, then again and again while the button is held. */
  const hold = (dir: 1 | -1, big: boolean) => {
    const step = () => latest.current.onChange(latest.current.value + dir * (big ? BIG_STEP : STEP));
    step();
    const again = (delay: number) => {
      timer.current = window.setTimeout(() => {
        step();
        again(70);
      }, delay);
    };
    again(400);
  };
  const release = () => clearTimeout(timer.current);
  const read = () => {
    if (text === null) return;
    const ms = parseOffset(text);
    if (ms !== null) onChange(ms);
    setText(null);
  };
  const stepper = (dir: 1 | -1) => (
    <button
      type="button"
      className="btn offset-step"
      aria-label={dir < 0 ? t.shift.earlier : t.shift.later}
      title={t.shift.stepHint}
      onPointerDown={(e) => {
        e.preventDefault();
        hold(dir, e.shiftKey);
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onChange(value + dir * (e.shiftKey ? BIG_STEP : STEP)))}
    >
      {dir < 0 ? '−' : '+'}
    </button>
  );

  return (
    <div className="offset-input">
      {stepper(-1)}
      <input
        ref={field}
        className="input tnum"
        aria-label={label}
        value={text ?? (value ? formatOffset(value) : '0 s')}
        onFocus={(e) => {
          setText(value ? String(value / 1000) : '');
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={read}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const ms = text === null ? value : parseOffset(text);
          read();
          if (ms !== null) onEnter?.(ms);
        }}
      />
      {stepper(1)}
    </div>
  );
}
