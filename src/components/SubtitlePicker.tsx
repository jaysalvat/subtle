/**
 * Choosing a subtitle, the same way everywhere: each line shows its number, its time and its text,
 * and the time is a button that takes the video there (to hear it) without choosing it.
 * - `SubtitleRow`: one such line (also in Sync by ear's always-open list, LinePicker).
 * - `SubtitlePicker`: a field that opens the list under it, typing filters it (text, number, time),
 *   ↑ ↓ Enter pick — the app's ComboBox with these rows.
 */
import { useMemo } from 'react';
import { t } from '../i18n';
import { formatTimecode } from '../lib/time';
import type { Cue } from '../lib/types';
import { ComboBox } from './ComboBox';
import { CueNumber } from './CueNumber';

/** A subtitle's text on one line, markup aside. */
export const plainLine = (s: string) => s.replace(/<[^>]+>|\{\\[^}]*\}/g, '').replace(/\s*\n\s*/g, ' ');
const time = (ms: number) => formatTimecode(ms).slice(0, 8);

export function SubtitleRow({ n, start, text, onGo }: { n: number; start: number; text: string; onGo?: () => void }) {
  return (
    <span className="sub-row">
      <CueNumber n={n} />
      {onGo ? (
        <button
          type="button"
          className="sub-row-time tnum"
          title={t.sync2.goThere}
          onClick={(e) => {
            e.stopPropagation();
            onGo();
          }}
        >
          {time(start)}
        </button>
      ) : (
        <span className="sub-row-time tnum">{time(start)}</span>
      )}
      <span className="sub-row-text">{plainLine(text)}</span>
    </span>
  );
}

export function SubtitlePicker({
  cues,
  times = cues,
  index,
  onChange,
  onGo,
  ariaLabel,
}: {
  cues: Cue[];
  /** Where each one is in the video now (e.g. with a sync preview); the text comes from `cues`. */
  times?: Cue[];
  index: number;
  onChange: (index: number) => void;
  /** The time clicked: take the video there. */
  onGo?: (index: number) => void;
  ariaLabel: string;
}) {
  const at = useMemo(() => new Map(cues.map((c, i) => [c.id, i])), [cues]);
  const options = useMemo(
    () => cues.map((c, i) => ({ value: c.id, label: `#${i + 1} · ${time(times[i]?.start ?? c.start)} · ${plainLine(c.text)}` })),
    [cues, times],
  );
  return (
    <ComboBox
      value={cues[index]?.id ?? ''}
      options={options}
      onChange={(id) => onChange(at.get(id) ?? index)}
      ariaLabel={ariaLabel}
      listClassName="sub-picker-list"
      renderOption={(o) => {
        const i = at.get(o.value)!;
        return <SubtitleRow n={i + 1} start={times[i]?.start ?? cues[i].start} text={cues[i].text} onGo={onGo && (() => onGo(i))} />;
      }}
    />
  );
}
