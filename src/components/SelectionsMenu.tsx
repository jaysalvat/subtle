/**
 * "Selections" menu in the top bar, beside Bookmarks: groups of subtitles kept with the project
 * (a scene, a character's lines, the ones to check), selected again in one click. Rename, delete,
 * save the current selection. Pure parts: lib/selections.ts.
 */
import { useCallback, useRef, useState } from 'react';
import { t } from '../i18n';
import { liveIds } from '../lib/selections';
import { useApp } from '../store/store';
import { saveSelection, selectSaved } from '../actions';
import { ChevronDown, CloseX } from './Icons';
import { useCloseOutside } from './Menu';
import { Pill } from './Pill';

export function SelectionsMenu() {
  const selections = useApp((s) => s.selections);
  const cues = useApp((s) => s.doc?.cues);
  const selected = useApp((s) => s.selection.length);
  const rename = useApp((s) => s.renameSelection);
  const remove = useApp((s) => s.removeSelection);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const wrap = useRef<HTMLDivElement>(null);
  useCloseOutside(wrap, open, close);
  const ts = t.selections;

  return (
    <div className="menu" ref={wrap}>
      <button className="btn menu-trigger" aria-haspopup="dialog" aria-expanded={open} disabled={!cues} onClick={() => setOpen(!open)}>
        {ts.menu}
        {selections.length > 0 && <Pill>{selections.length}</Pill>}
        <ChevronDown />
      </button>
      {open && cues && (
        <div className="menu-list bookmarks-list" role="dialog" aria-label={ts.menu}>
          {selections.length === 0 ? (
            <p className="note bookmarks-empty">{ts.empty}</p>
          ) : (
            selections.map((x) => {
              const n = liveIds(x, cues).length;
              return (
                <div key={x.id} className="bookmark-row">
                  <button className="btn sm primary tnum selection-count" title={ts.select} disabled={!n} onClick={() => selectSaved(x)}>
                    {n}
                  </button>
                  <input
                    className="bookmark-label"
                    aria-label={ts.rename}
                    value={x.label}
                    onChange={(e) => rename(x.id, e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                  />
                  <button className="icon-btn sm" aria-label={ts.remove} title={ts.remove} onClick={() => remove(x.id)}>
                    <CloseX size={14} />
                  </button>
                </div>
              );
            })
          )}
          <button className="menu-item bookmarks-add" disabled={!selected} onClick={saveSelection}>
            <span>{ts.save(selected)}</span>
          </button>
        </div>
      )}
    </div>
  );
}
