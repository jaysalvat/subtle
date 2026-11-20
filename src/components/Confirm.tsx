/**
 * Our own confirm box, in place of the browser's confirm(): `if (await ask({...})) …`. With a second
 * way to go on (`alt`), `choose` says which button: 'ok', 'alt' or null (cancelled).
 * Shown above any open dialog; Enter confirms, Escape cancels, other keys don't reach the app.
 */
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { t } from '../i18n';

export interface Ask {
  title: string;
  text?: string;
  /** The confirm button: says what it does ("Discard the translation"). */
  ok: string;
  cancel?: string;
  /** Red confirm button, for something that deletes or stops. */
  danger?: boolean;
  /** A second way to go on, between Cancel and the confirm button. */
  alt?: string;
}

type Choice = 'ok' | 'alt' | null;
const useConfirm = create<{ ask: (Ask & { resolve: (c: Choice) => void }) | null }>(() => ({ ask: null }));

export function choose(a: Ask): Promise<Choice> {
  useConfirm.getState().ask?.resolve(null);
  return new Promise((resolve) => useConfirm.setState({ ask: { ...a, resolve } }));
}

export const ask = (a: Ask): Promise<boolean> => choose(a).then((c) => c === 'ok');

export function ConfirmHost() {
  const a = useConfirm((s) => s.ask);
  const okRef = useRef<HTMLButtonElement>(null);

  const done = (c: Choice) => {
    useConfirm.setState({ ask: null });
    a?.resolve(c);
  };

  useEffect(() => {
    if (!a) return;
    const prev = document.activeElement as HTMLElement | null;
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Capture phase: nothing else (shortcuts, the dialog below) sees the key.
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        done(null);
      } else if (e.key === 'Enter' && document.activeElement === okRef.current) {
        e.preventDefault();
        done('ok');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a]);

  if (!a) return null;
  return (
    <div className="backdrop confirm-backdrop" onPointerDown={(e) => e.target === e.currentTarget && done(null)}>
      <div className="dialog confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-text">
        <div className="confirm-body">
          <h2 id="confirm-title">{a.title}</h2>
          {a.text && <p id="confirm-text">{a.text}</p>}
        </div>
        <div className="dialog-foot">
          <button className="btn" onClick={() => done(null)}>
            {a.cancel ?? t.common.cancel}
          </button>
          {a.alt && (
            <button className="btn" onClick={() => done('alt')}>
              {a.alt}
            </button>
          )}
          <button ref={okRef} className={`btn ${a.danger ? 'danger-solid' : 'primary'}`} onClick={() => done('ok')}>
            {a.ok}
          </button>
        </div>
      </div>
    </div>
  );
}
