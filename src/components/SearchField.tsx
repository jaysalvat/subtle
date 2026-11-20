import { useRef, type KeyboardEvent } from 'react';
import { t } from '../i18n';
import { CloseX, Search } from './Icons';

/** Search box with a clear (✕) button. Escape clears too. Keys don't reach the app's shortcuts. */
export function SearchField({
  value,
  onChange,
  label,
  className = '',
  onEnter,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  className?: string;
  onEnter?: () => void;
  autoFocus?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Escape with nothing typed goes on (a window closes); otherwise keys stay here.
    if (e.key === 'Escape' && !value) return;
    e.stopPropagation();
    if (e.key === 'Enter') onEnter?.();
    if (e.key === 'Escape') onChange('');
  };
  return (
    <label className={`search ${className}`}>
      <Search />
      <input
        ref={input}
        autoFocus={autoFocus}
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {value && (
        <button
          type="button"
          className="search-clear"
          aria-label={t.common.clearSearch}
          title={t.common.clearSearch}
          onClick={(e) => {
            e.preventDefault();
            onChange('');
            input.current?.focus();
          }}
        >
          <CloseX size={14} />
        </button>
      )}
    </label>
  );
}
