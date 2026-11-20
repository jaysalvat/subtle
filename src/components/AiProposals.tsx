/**
 * The AI's proposals to review (Shorten, Review, Check the translation): one row each — the
 * original when there's one (quiet, like the list), the text with the change marked in it (words
 * removed struck, words added highlighted), then the kind and a short reason; its number (go
 * there) and ▶ to hear it in a loop. Texts on one line: what's checked is the words, not the line
 * breaks. Tick what to keep, then apply all of it at once. Every AI text proposal uses this.
 */
import { useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { editableText } from '../lib/markup';
import { wordDiff } from '../lib/wordDiff';
import { startLoop, stopLoop, useLoop } from '../store/loop';
import { player } from '../store/playback';
import { useApp } from '../store/store';
import { CueNumber } from './CueNumber';
import { Play } from './Icons';

export interface AiProposalItem {
  id: string;
  /** Checking a translation: the original it translates, shown first. */
  original?: string;
  before: string;
  after: string;
  /** "Misheard?", "Spelling"… */
  tag?: string;
  reason?: string;
  /** On the right, under the number (e.g. the reading speed). */
  meta?: ReactNode;
  /** Ticked to begin with (default: yes). */
  on?: boolean;
}

/** A subtitle's text on one line (line breaks and markup aside). */
const oneLine = (s: string) =>
  editableText(s)
    .replace(/\s*\n\s*/g, ' ')
    .trim();

export function AiProposals({
  items,
  intro,
  applyLabel,
  onApply,
  onCancel,
}: {
  items: AiProposalItem[];
  /** Above the list (what was found, tokens used…). */
  intro?: ReactNode;
  applyLabel: (n: number) => string;
  onApply: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set(items.filter((i) => i.on !== false).map((i) => i.id)));
  const toggle = (id: string) => setAccepted((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const looping = useLoop((s) => (s.loop && 'cue' in s.loop ? s.loop.cue : null));
  const index = (id: string) => (useApp.getState().doc?.cues.findIndex((c) => c.id === id) ?? -1) + 1;
  const go = (id: string) => {
    const c = useApp.getState().doc?.cues.find((x) => x.id === id);
    if (!c) return;
    useApp.setState({ selection: [id] });
    player.seek(c.start);
  };
  // ▶ plays the subtitle over and over (to hear what was really said); again: stop.
  const listen = (id: string) => (looping === id ? stopLoop() : (useApp.setState({ selection: [id] }), startLoop({ cue: id })));
  const ids = items.map((i) => i.id).filter((id) => accepted.has(id));

  return (
    <>
      <div className="dialog-body">
        {intro}
        {items.length > 0 && (
          <div className="proposal-list">
            {items.map((p, i) => (
              <div key={p.id} className={`proposal ${accepted.has(p.id) ? 'on' : ''} ${i % 2 ? 'alt' : ''}`}>
                <label className="check">
                  <input type="checkbox" checked={accepted.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="proposal-text">
                    {p.original !== undefined && <span className="proposal-original">{oneLine(p.original)}</span>}
                    <span className="proposal-change">
                      {wordDiff(oneLine(p.before), oneLine(p.after)).map((d, k) =>
                        d.kind === 'del' ? <del key={k}>{d.text}</del> : d.kind === 'add' ? <ins key={k}>{d.text}</ins> : d.text,
                      )}
                    </span>
                    {(p.tag || p.reason) && (
                      <span className="proposal-why">
                        {p.tag && <span className="proposal-tag">{p.tag}</span>}
                        {p.reason}
                      </span>
                    )}
                  </span>
                </label>
                <span className="proposal-meta">
                  <span className="proposal-go">
                    <button
                      type="button"
                      // A real button, like the timeline's action bar.
                      className="btn sm toggle icon-toggle"
                      aria-pressed={looping === p.id}
                      aria-label={t.proposals.listen}
                      title={t.proposals.listen}
                      onClick={() => listen(p.id)}
                    >
                      <Play size={14} />
                    </button>
                    <CueNumber n={index(p.id)} onGo={() => go(p.id)} />
                  </span>
                  {p.meta}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="dialog-foot">
        <button className="btn" onClick={onCancel}>
          {t.common.cancel}
        </button>
        <button className="btn primary" disabled={!ids.length} onClick={() => onApply(ids)}>
          {applyLabel(ids.length)}
        </button>
      </div>
    </>
  );
}
