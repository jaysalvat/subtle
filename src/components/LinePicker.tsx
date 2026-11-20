import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import type { Cue } from '../lib/types';
import { SearchField } from './SearchField';
import { plainLine as plain, SubtitleRow } from './SubtitlePicker';

/**
 * Pick the line to listen for: a fixed-height list with the lines around it (context), and a search
 * box to find a line from what you hear. Each line shows where it should be in the video (`times`,
 * i.e. with the current sync applied); clicking that time jumps the video there.
 */
/** The line being looked for, in large (search results only help to pick another one). */
export function LineTarget({ text, label = t.sync2.find }: { text: string; label?: string }) {
  return (
    <div className="line-target" aria-live="polite">
      <span className="line-target-label">{label}</span>
      <span className="line-target-text">“{plain(text)}”</span>
    </div>
  );
}

export function LinePicker({
  cues,
  times,
  index,
  onPick,
  onGo,
}: {
  cues: Cue[];
  times: Cue[];
  index: number;
  onPick: (i: number) => void;
  onGo: (i: number) => void;
}) {
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const all = cues.map((_, i) => i);
    return q ? all.filter((i) => plain(cues[i].text).toLowerCase().includes(q)) : all;
  }, [cues, q]);

  // Bring the chosen line into view: centred when it's out of view (opening, search, step change),
  // left alone when it's already visible (a click doesn't move the list under the mouse).
  useEffect(() => {
    const box = list.current;
    const el = box?.querySelector<HTMLElement>(`[data-i="${index}"]`);
    if (!box || !el) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top >= b.top && r.bottom <= b.bottom) return;
    box.scrollTop += r.top - b.top - (box.clientHeight - r.height) / 2;
  }, [index, q]);

  return (
    <div className="line-picker">
      <SearchField value={query} onChange={setQuery} label={t.sync2.search} onEnter={() => rows.length && onPick(rows[0])} />
      <div className="line-list" ref={list} role="listbox" aria-label={t.sync2.lines}>
        {rows.length === 0 && <div className="note line-empty">{t.list.noMatch}</div>}
        {rows.map((i) => (
          <div
            key={cues[i].id}
            data-i={i}
            role="option"
            aria-selected={i === index}
            className={`line-row ${i === index ? 'current' : ''}`}
            onClick={() => onPick(i)}
          >
            <SubtitleRow
              n={i + 1}
              start={times[i].start}
              text={cues[i].text}
              onGo={() => {
                onPick(i);
                onGo(i);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
