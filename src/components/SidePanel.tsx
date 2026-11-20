/**
 * The side panel for tools you use with the video (Check quality, Review with AI, Convert frame
 * rate, Sync by ear): as wide as the subtitle list, docked over it on the right — or on the left,
 * over the picture's side, so the subtitle you go to stays visible. The ⇄ button moves it; the
 * side is remembered. Escape closes it. Use it for any non-modal tool panel.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { t } from '../i18n';
import { useApp } from '../store/store';
import { CloseX, SwapIcon } from './Icons';

/** As wide as the list (never under 380 px); on the right over it, or on the left edge. */
function usePanelBox(side: 'right' | 'left'): CSSProperties | undefined {
  const [box, setBox] = useState<{ listRight: number; width: number } | null>(null);
  useEffect(() => {
    const measure = () => {
      const r = document.querySelector('.list')?.getBoundingClientRect();
      setBox(r ? { listRight: r.right, width: Math.max(r.width - 16, 380) } : null);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  if (!box) return side === 'left' ? { left: 16, right: 'auto' } : undefined;
  return { width: box.width, right: 'auto', left: side === 'right' ? box.listRight - 8 - box.width : 16 };
}

export function SidePanel({
  title,
  onClose,
  closeLabel = t.common.close,
  className = '',
  children,
}: {
  title: string;
  onClose: () => void;
  closeLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const side = useApp((s) => s.settings.panelSide);
  const style = usePanelBox(side);
  const other = side === 'right' ? 'left' : 'right';
  return (
    // Clicks stay in the panel (one over the picture would play / pause the video).
    <aside
      className={`side-panel ${className}`}
      style={style}
      role="dialog"
      aria-label={title}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <span className="spacer" />
        <button
          className="icon-btn"
          aria-label={t.sidePanel.move[other]}
          title={t.sidePanel.move[other]}
          onClick={() => useApp.getState().setSettings({ panelSide: other })}
        >
          <SwapIcon />
        </button>
        <button className="icon-btn" aria-label={closeLabel} onClick={onClose}>
          <CloseX />
        </button>
      </div>
      {children}
    </aside>
  );
}
