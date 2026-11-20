/**
 * A select you can type in: the field shows the choice; focus or click opens the list, typing
 * filters it (name or value, accents and case ignored), ↑ ↓ Enter pick, Escape closes. Optionally
 * a value that isn't in the list (`custom`: e.g. any language code). The list is drawn over
 * everything (portal), so a window's scrolling body never cuts it. Use it for long lists.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';
import { ChevronDown } from './Icons';

export interface ComboOption {
  value: string;
  label: string;
  /** Shown dimmed on the right (a code, a size…), searched too. */
  hint?: string;
}

interface Props {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  /** For a <label htmlFor>. */
  inputId?: string;
  placeholder?: string;
  /** Typed text → a value to offer when it isn't in the list (null: not valid). */
  custom?: (typed: string) => string | null;
  /** "Use “pt-PT”". */
  customLabel?: (value: string) => string;
  /** Greyed, can't be changed (e.g. while a model loads). */
  disabled?: boolean;
  /** How an option is drawn in the list (default: its label, and hint on the right). */
  renderOption?: (o: ComboOption) => ReactNode;
  /** Extra class on the list (e.g. wider rows). */
  listClassName?: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

let ids = 0;

export function ComboBox({
  value,
  options,
  onChange,
  ariaLabel,
  inputId,
  placeholder,
  custom,
  customLabel,
  disabled,
  renderOption,
  listClassName = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number; up: boolean; max: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [id] = useState(() => `combo-${++ids}`);

  const current = options.find((o) => o.value === value);
  const shown = current ? current.label : value;

  // Matches: those starting with the text first, then the ones containing it.
  const items = useMemo(() => {
    const q = fold(query.trim());
    const found = !q
      ? options
      : options
          .map((o) => {
            const text = fold(`${o.label} ${o.hint ?? ''} ${o.value}`);
            const starts = fold(o.label).startsWith(q) || fold(o.value) === q;
            return { o, rank: starts ? 0 : text.includes(q) ? 1 : 2 };
          })
          .filter((x) => x.rank < 2)
          .sort((a, b) => a.rank - b.rank)
          .map((x) => x.o);
    const extra = custom && query.trim() ? custom(query.trim()) : null;
    return extra && !options.some((o) => o.value === extra) ? [...found, { value: extra, label: customLabel?.(extra) ?? extra, custom: true }] : found;
  }, [query, options, custom, customLabel]);

  const place = () => {
    const r = input.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 8;
    const up = below < 200 && r.top > below;
    const next = { left: r.left, width: r.width, top: up ? r.top - 4 : r.bottom + 4, up, max: Math.min(300, (up ? r.top : below) - 8) };
    setBox((b) => (b && b.left === next.left && b.top === next.top && b.width === next.width && b.max === next.max ? b : next));
  };
  // Follows the field while open: scrolling, resizing, or the window around it changing height.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    let raf = requestAnimationFrame(function follow() {
      place();
      raf = requestAnimationFrame(follow);
    });
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // A click anywhere else closes it (and leaves the text as the choice).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!input.current?.contains(n) && !list.current?.contains(n)) close();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  // Keep the highlighted one in view.
  useEffect(() => {
    list.current?.querySelector(`#${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open, id]);

  const openList = () => {
    if (open) return;
    setQuery('');
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const pick = (v: string) => {
    if (v !== value) onChange(v);
    close();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'ArrowDown') setActive((i) => Math.min(items.length - 1, i + 1));
    else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(items.length - 1);
    else if (e.key === 'Enter') items[active] && pick(items[active].value);
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') return close();
    else return;
    // Handled here: not by the window (Escape would close it) nor the page.
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className={`combo ${open ? 'open' : ''}`}>
      <input
        ref={input}
        id={inputId}
        disabled={disabled}
        className="input combo-input"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && items[active] ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        placeholder={open ? shown || placeholder : placeholder}
        value={open ? query : shown}
        onChange={(e) => {
          const v = e.target.value;
          // Typed while closed: the shown name was there, keep only what was typed.
          setQuery(open ? v : v.startsWith(shown) ? v.slice(shown.length) : v);
          setActive(0);
          if (!open) setOpen(true);
        }}
        // Typing replaces the shown name (it doesn't add to it); the list opens on a click, a key or typing, not on Tab.
        onFocus={(e) => e.target.select()}
        onClick={openList}
        onKeyDown={onKey}
      />
      <ChevronDown className="combo-chevron" aria-hidden="true" />
      {open &&
        box &&
        createPortal(
          <div
            ref={list}
            id={`${id}-list`}
            role="listbox"
            className={`combo-list ${listClassName}`}
            style={{ left: box.left, width: box.width, maxHeight: box.max, ...(box.up ? { bottom: window.innerHeight - box.top } : { top: box.top }) }}
            // Keep the focus in the field while clicking an item.
            onPointerDown={(e) => e.preventDefault()}
          >
            {items.length === 0 && <div className="combo-empty">{t.common.noMatch}</div>}
            {items.map((o, i) => (
              <div
                key={o.value + ('custom' in o ? '+' : '')}
                id={`${id}-${i}`}
                role="option"
                aria-selected={o.value === value}
                className={`combo-option ${i === active ? 'active' : ''} ${o.value === value ? 'chosen' : ''}`}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(o.value)}
              >
                {renderOption && !('custom' in o) ? (
                  renderOption(o)
                ) : (
                  <>
                    <span>{o.label}</span>
                    {'hint' in o && o.hint && <span className="combo-hint tnum">{o.hint}</span>}
                  </>
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
