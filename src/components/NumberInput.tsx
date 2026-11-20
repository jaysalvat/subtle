/**
 * A number field with our own ▲ ▼ (the browser's spinners are hidden: they can't be styled).
 * Click steps once; holding repeats. ↑ ↓ in the field step too (the browser does it).
 */
import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import { ChevronDown, ChevronUp } from './Icons';

interface Props {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
  label: string;
  width?: number;
}

/** Decimals of the step, so 0.1 + 0.2 shows 0.3. */
const decimals = (step: number) => (String(step).split('.')[1] ?? '').length;

export function NumberInput({ value, onChange, step = 1, min, max, label, width }: Props) {
  // Latest value and onChange for the repeating timer.
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const timer = useRef<number | undefined>(undefined);
  const stop = () => window.clearTimeout(timer.current);
  useEffect(() => stop, []);

  const bump = (dir: 1 | -1) => {
    const v = Number.isFinite(latest.current.value) ? latest.current.value : 0;
    let n = Number((v + dir * step).toFixed(decimals(step)));
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    if (n !== v) latest.current.onChange(n);
  };
  const press = (dir: 1 | -1) => {
    bump(dir);
    const again = (delay: number) => {
      timer.current = window.setTimeout(() => {
        bump(dir);
        again(60);
      }, delay);
    };
    again(400);
  };
  const stepper = (dir: 1 | -1) => (
    <button
      type="button"
      tabIndex={-1}
      className="num-step"
      aria-label={dir > 0 ? t.common.increase : t.common.decrease}
      disabled={dir > 0 ? max !== undefined && value >= max : min !== undefined && value <= min}
      onPointerDown={(e) => {
        e.preventDefault();
        press(dir);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
    >
      {dir > 0 ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
    </button>
  );

  return (
    <span className="num-field" style={width ? { width } : undefined}>
      <input
        className="input num"
        type="number"
        aria-label={label}
        value={Number.isFinite(value) ? value : ''}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="num-steps">
        {stepper(1)}
        {stepper(-1)}
      </span>
    </span>
  );
}
