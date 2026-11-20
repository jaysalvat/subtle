import { swallowNextClick } from './Menu';
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { byTime } from '../lib/bookmarks';
import { formatTimecode } from '../lib/time';
import { useApp } from '../store/store';
import { addBookmarkHere, goToBookmark } from '../actions';
import { ChevronDown, CloseX, Plus } from './Icons';
import { Pill } from './Pill';
import { WithKeys } from './Keys';

/** "Bookmarks" menu in the top bar: list (film order), jump, rename, delete, add at the playhead. */
export function BookmarksMenu() {
  const bookmarks = useApp((s) => s.bookmarks);
  // A picture column only once some bookmark has one (bookmarks added without a video have none).
  const hasImages = bookmarks.some((b) => b.image);
  const has = useApp((s) => !!s.doc || !!s.videoUrl);
  const rename = useApp((s) => s.renameBookmark);
  const remove = useApp((s) => s.removeBookmark);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) {
        setOpen(false);
        swallowNextClick(e);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="menu" ref={wrap}>
      <button className="btn menu-trigger" aria-haspopup="dialog" aria-expanded={open} disabled={!has} onClick={() => setOpen(!open)}>
        {t.bookmarks.menu}
        {bookmarks.length > 0 && <Pill>{bookmarks.length}</Pill>}
        <ChevronDown />
      </button>
      {open && (
        <div className="menu-list bookmarks-list" role="dialog" aria-label={t.bookmarks.menu}>
          {bookmarks.length === 0 ? (
            <p className="note bookmarks-empty">
              <WithKeys text={t.bookmarks.empty} />
            </p>
          ) : (
            byTime(bookmarks).map((b) => (
              <div key={b.id} className="bookmark-row">
                <span className="bookmark-slot tnum" title={b.slot <= 9 ? t.bookmarks.keyHint(b.slot) : t.bookmarks.noKey}>
                  {b.slot <= 9 ? <kbd>{b.slot}</kbd> : <span className="dim">·</span>}
                </span>
                {hasImages && (
                  <button className="bookmark-thumb" title={t.bookmarks.jump} onClick={() => goToBookmark(b.time)}>
                    {b.image && <img src={b.image} alt="" />}
                  </button>
                )}
                <button className="sub-row-time tnum" title={t.bookmarks.jump} onClick={() => goToBookmark(b.time)}>
                  {formatTimecode(b.time).slice(0, 8)}
                </button>
                <input
                  className="bookmark-label"
                  aria-label={t.bookmarks.rename}
                  value={b.label}
                  onChange={(e) => rename(b.id, e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
                <button className="icon-btn sm" aria-label={t.bookmarks.remove} title={t.bookmarks.remove} onClick={() => remove(b.id)}>
                  <CloseX size={14} />
                </button>
              </div>
            ))
          )}
          <button className="menu-item bookmarks-add" onClick={addBookmarkHere}>
            <span>
              <Plus size={14} /> <WithKeys text={t.bookmarks.add} />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
