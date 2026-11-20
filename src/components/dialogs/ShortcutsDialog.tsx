/** Keyboard shortcuts, with search. */
import { SearchField } from '../SearchField';
import { useState } from 'react';
import { t } from '../../i18n';
import { close, Dialog } from './Dialog';

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const keyLabel = (k: string) =>
  k === 'Mod' ? (IS_MAC ? '⌘' : 'Ctrl') : k === 'Alt' && IS_MAC ? '⌥' : k === 'Shift' && IS_MAC ? '⇧' : (t.shortcuts.keyNames[k] ?? k);

export function ShortcutsDialog() {
  const s = t.shortcuts;
  const [query, setQuery] = useState('');
  // What it does, or its keys ("split", "alt", "⌘"); accents and case ignored.
  const fold = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const q = fold(query.trim());
  const groups = s.groups
    .map((g) => ({
      ...g,
      items: q
        ? g.items.filter(([keys, what]) => fold(`${what} ${keys.join(' ')} ${keys.flatMap((k) => k.split(/\+(?!$)/).map(keyLabel)).join(' ')}`).includes(q))
        : g.items,
    }))
    .filter((g) => g.items.length);
  return (
    <Dialog
      wide
      className="shortcuts-dialog"
      title={s.title}
      footer={
        <button className="btn primary" onClick={close}>
          {s.close}
        </button>
      }
    >
      <div className="shortcut-search-bar">
        <SearchField value={query} onChange={setQuery} label={s.search} className="shortcut-search" autoFocus />
      </div>
      {groups.length === 0 && <p className="note">{t.common.noMatch}</p>}
      <div className="shortcut-groups">
        {groups.map((g) => (
          <section key={g.title}>
            <div className="group-title">{g.title}</div>
            <dl className="shortcut-list">
              {g.items.map(([keys, what]) => (
                <div key={what}>
                  <dt>
                    {keys.map((combo, i) => (
                      <span key={combo} className="combo">
                        {i > 0 && <span className="or">{s.or}</span>}
                        {combo.split(/\+(?!$)/).map((k, j) => (
                          <span key={k} className="combo">
                            {j > 0 && <span className="plus">+</span>}
                            <kbd>{keyLabel(k)}</kbd>
                          </span>
                        ))}
                      </span>
                    ))}
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="note flush">{s.note}</p>
    </Dialog>
  );
}
