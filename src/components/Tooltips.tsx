/**
 * Our own tooltips, for every `title` in the app (the browser's are slow, small and hard to read).
 * Mounted once: on hover, the element's `title` is set aside (so the browser's doesn't show too) and
 * put back when the pointer leaves. Shown after a short wait, at once when moving from one to the
 * next; above the element, below when there's no room, kept inside the window. A click, a key, a
 * scroll or the wheel hides it. Remove the component and the browser's tooltips come back.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { WithKeys } from './Keys';

const WAIT_MS = 350;
/** Moving to the next one within this time: no wait. */
const WARM_MS = 400;
const GAP = 6;
const MARGIN = 8;

interface Tip {
  text: string;
  box: DOMRect;
}

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let target: HTMLElement | null = null;
    let timer = 0;
    let hiddenAt = 0;
    let shown = false;

    const restore = () => {
      if (target?.dataset.tip !== undefined) {
        // React may have set a newer title meanwhile: keep that one.
        if (!target.hasAttribute('title')) target.setAttribute('title', target.dataset.tip);
        delete target.dataset.tip;
      }
      target = null;
    };
    const hide = () => {
      window.clearTimeout(timer);
      if (shown) hiddenAt = performance.now();
      shown = false;
      restore();
      setTip(null);
    };

    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const found = (e.target as Element | null)?.closest?.<HTMLElement>('[title], [data-tip]');
      if (found === target) return;
      hide();
      if (!found) return;
      const text = found.getAttribute('title') ?? found.dataset.tip ?? '';
      if (!text.trim()) return;
      target = found;
      found.dataset.tip = text;
      found.removeAttribute('title');
      const show = () => {
        if (target !== found || !found.isConnected) return;
        shown = true;
        setTip({ text, box: found.getBoundingClientRect() });
      };
      if (performance.now() - hiddenAt < WARM_MS) show();
      else timer = window.setTimeout(show, WAIT_MS);
    };
    const out = (e: PointerEvent) => {
      if (target && !target.contains(e.relatedTarget as Node | null)) hide();
    };

    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    document.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      document.removeEventListener('wheel', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Placed once its size is known: above, else below; centred, inside the window.
  useLayoutEffect(() => {
    if (!tip || !el.current) return;
    // Measured at the window's corner: where the last one was (near an edge), the text would wrap more.
    el.current.style.left = '0px';
    el.current.style.top = '0px';
    const { width, height } = el.current.getBoundingClientRect();
    const b = tip.box;
    const above = b.top - GAP - height;
    const top = above >= MARGIN ? above : b.bottom + GAP;
    const left = Math.min(Math.max(MARGIN, b.left + b.width / 2 - width / 2), window.innerWidth - width - MARGIN);
    // Set here, before it's painted (not through React: a same position twice wouldn't be written back).
    el.current.style.left = `${left}px`;
    el.current.style.top = `${top}px`;
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={el} className="tooltip" role="tooltip">
      <WithKeys text={tip.text} />
    </div>,
    document.body,
  );
}
