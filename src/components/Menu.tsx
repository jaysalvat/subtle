import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from './Icons';
import { Pill } from './Pill';
import { WithKeys } from './Keys';
import { menuColumns } from '../lib/menu';

export interface MenuItem {
  label: string;
  hint?: string;
  /** Starts a new section with this title (a line above it, except at the top). */
  section?: string;
  /** Greyed, can't be picked. */
  disabled?: boolean;
  /** A line above it (a group without a title). */
  divider?: boolean;
  /** Destructive (Delete): in red. */
  danger?: boolean;
  /** A small bubble after the name ("AI"). */
  pill?: string;
  onSelect: () => void;
}

/**
 * A click outside an open menu only closes it: the click that follows that pointerdown is dropped,
 * so it doesn't also play / pause the video or move the playhead. Clicks on buttons and fields still
 * go through (open another menu straight away, press a button).
 */
export function swallowNextClick(e: PointerEvent) {
  if ((e.target as Element | null)?.closest?.('button, a, input, select, textarea, [role=menuitem], [role=slider]')) return;
  const drop = (c: MouseEvent) => {
    c.stopPropagation();
    c.preventDefault();
  };
  window.addEventListener('click', drop, { capture: true, once: true });
  // No click after all (a drag): forget it.
  window.addEventListener('pointerdown', () => window.removeEventListener('click', drop, true), { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', drop, true), 1000);
}

/** Dropdown menu: a button that opens a list of actions. Escape or a click outside closes it. */
export function Menu({
  label,
  icon,
  items,
  disabled,
  iconOnly,
  alignRight,
  columns = 1,
  noChevron,
}: {
  label: string;
  icon?: ReactNode;
  items: MenuItem[];
  disabled?: boolean;
  /** Just the icon (the label as tooltip): for a tight bar. */ iconOnly?: boolean;
  /** The list opens towards the left (a menu near the window's right edge). */ alignRight?: boolean;
  /** A wide menu: its sections side by side, in this many columns. */ columns?: number;
  /** No ⌄ after the icon (an icon that says it's a menu, like ⋯). */ noChevron?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // A wide menu stays inside the window: moved back by what would stick out on either side.
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) return setShift(0);
    const r = list.current?.getBoundingClientRect();
    if (!r) return;
    const left = r.left - shift;
    const right = r.right - shift;
    // Lined up with the top bar's content (its right padding), measured without a scrollbar.
    const gap = 12;
    setShift(left < gap ? gap - left : Math.min(0, document.documentElement.clientWidth - gap - right));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) {
        setOpen(false);
        swallowNextClick(e);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const items = Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') ?? []);
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'Escape') setOpen(false);
      else if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
      else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && wrap.current?.querySelector('.menu-col')) {
        // Wide menu: the item at the same height in the next column.
        const cols = Array.from(wrap.current.querySelectorAll<HTMLElement>('.menu-col'));
        const col = cols.findIndex((c) => c.contains(document.activeElement));
        const next = cols[col + (e.key === 'ArrowRight' ? 1 : -1)];
        if (!next) return;
        const y = (document.activeElement as HTMLElement).getBoundingClientRect().top;
        const there = Array.from(next.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)'));
        there.reduce((a, b) => (Math.abs(b.getBoundingClientRect().top - y) < Math.abs(a.getBoundingClientRect().top - y) ? b : a), there[0])?.focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const entry = (it: MenuItem) => [
    it.divider && !it.section && <div key={`d-${it.label}`} className="menu-divider" role="separator" />,
    it.section && (
      <div key={`s-${it.section}`} className="menu-section" role="presentation">
        {it.section}
      </div>
    ),
    <button
      key={it.label}
      role="menuitem"
      disabled={it.disabled}
      className={`menu-item ${it.danger ? 'danger' : ''}`}
      onClick={() => {
        setOpen(false);
        it.onSelect();
      }}
    >
      {it.pill && <Pill accent>{it.pill}</Pill>}
      <span className="menu-label">
        <WithKeys text={it.label} />
      </span>
      {it.hint && (
        <span className="menu-hint">
          <WithKeys text={it.hint} />
        </span>
      )}
    </button>,
  ];

  return (
    <div className="menu" ref={wrap}>
      <button
        className={`btn menu-trigger ${iconOnly ? 'icon-menu' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {icon} {!iconOnly && label} {!noChevron && <ChevronDown />}
      </button>
      {open && (
        <div
          ref={list}
          className={`menu-list ${alignRight ? 'right' : ''} ${columns > 1 ? 'wide' : ''}`}
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
          role="menu"
          aria-label={label}
        >
          {columns > 1
            ? menuColumns(items, columns).map((col, c) => (
                <div key={c} className="menu-col">
                  {col.flat().map(entry)}
                </div>
              ))
            : items.map(entry)}
        </div>
      )}
    </div>
  );
}
