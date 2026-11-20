import { swallowNextClick } from './Menu';
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { CueNumber } from './CueNumber';
import { ISSUE_KINDS, cueIssues, nextSamePlace, type IssueKind } from '../lib/tools';
import { formatDuration, formatTimecode } from '../lib/time';
import type { Cue, Settings } from '../lib/types';
import { useApp } from '../store/store';
import { goToCue } from '../actions';

export function issueText(k: IssueKind, s: Settings): string {
  switch (k) {
    case 'overlap':
      return t.issues.overlap;
    case 'cps':
      return t.issues.cps(s.maxCps);
    case 'lineLength':
      return t.issues.lineLength(s.maxLineLength);
    case 'tooManyLines':
      return t.issues.tooManyLines;
    case 'tooShort':
      return t.issues.tooShort(formatDuration(s.minDurationMs));
    case 'tooLong':
      return t.issues.tooLong;
    case 'hi':
      return t.issues.hi;
  }
}

/** Issue count badge in the list header; opens an index of every issue to jump to. */
export function IssuesButton({ cues, issues }: { cues: Cue[]; issues: Map<string, IssueKind[]> }) {
  const settings = useApp((s) => s.settings);
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
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const count = issues.size;
  if (count === 0 && settings.hiddenIssueKinds.length === 0) return null;

  return (
    <div className="issues-wrap" ref={wrap}>
      <button
        className={`badge badge-btn ${settings.showIssues ? '' : 'off'} ${count === 0 ? 'zero' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={t.issuesPanel.open}
        onClick={() => setOpen(!open)}
      >
        {t.list.issues(count)}
      </button>
      {open && <IssuesPanel cues={cues} issues={issues} onPick={() => setOpen(false)} />}
    </div>
  );
}

/** A pick goes to the subtitle and closes the panel, so it can be seen and fixed. */
function IssuesPanel({ cues, issues, onPick }: { cues: Cue[]; issues: Map<string, IssueKind[]>; onPick: () => void }) {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const selection = useApp((s) => s.selection);
  const hidden = new Set(settings.hiddenIssueKinds);

  // Counts per kind, ignoring the user's filter so turned-off kinds still show how many there are.
  const counts = useMemo(() => {
    const m = new Map<IssueKind, number>();
    cues.forEach((c, i) => {
      for (const k of cueIssues(c, nextSamePlace(cues, i), settings)) m.set(k, (m.get(k) ?? 0) + 1);
    });
    return m;
  }, [cues, settings]);

  const rows = cues.map((c, i) => [c, i] as const).filter(([c]) => issues.has(c.id));
  const toggleKind = (k: IssueKind) =>
    setSettings({ hiddenIssueKinds: hidden.has(k) ? settings.hiddenIssueKinds.filter((x) => x !== k) : [...settings.hiddenIssueKinds, k] });

  return (
    <div className="issues-panel" role="dialog" aria-label={t.issuesPanel.title}>
      <label className="check issues-show">
        <input type="checkbox" checked={settings.showIssues} onChange={(e) => setSettings({ showIssues: e.target.checked })} />
        {t.issuesPanel.show}
      </label>
      {!settings.showIssues && <p className="issues-note">{t.issuesPanel.hiddenNote}</p>}
      <div className="issues-kinds" role="group" aria-label={t.issuesPanel.check}>
        {ISSUE_KINDS.map((k) => (
          <button key={k} className="kind-chip" aria-pressed={!hidden.has(k)} onClick={() => toggleKind(k)}>
            {t.issuesPanel.kinds[k]} <span className="tnum">{counts.get(k) ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="issues-rows">
        {rows.length === 0 && <div className="issues-none">{t.issuesPanel.none}</div>}
        {rows.map(([c, i]) => (
          <button key={c.id} className={`issue-row ${selection.includes(c.id) ? 'selected' : ''}`} onClick={() => (goToCue(c.id), onPick())}>
            <CueNumber n={i + 1} />
            <span className="time tnum">{formatTimecode(c.start).slice(0, 8)}</span>
            <span className="what">
              <span className="kinds">
                {issues
                  .get(c.id)!
                  .map((k) => issueText(k, settings))
                  .join('. ')}
              </span>
              <span className="text">{(c.target?.trim() ? c.target : c.text).replace(/\n/g, ' ')}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
