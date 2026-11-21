/**
 * Tools › Check quality: pick a profile (its rules become the app's), see the problems per kind,
 * fix them one kind at a time or all at once (one undo step each), and the things only worth a look.
 * A side panel, so the list and the video stay usable while checking.
 */
import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';
import { AiPill } from './Pill';
import {
  audit,
  CONVENTIONS,
  FIXABLE,
  fixAll,
  fixFor,
  profileFor,
  profileFromSettings,
  TO_CHECK,
  type AuditKind,
  type Profile,
  type ProfileId,
} from '../lib/audit';
import { useThumbs } from '../store/thumbs';
import { player, usePlayback } from '../store/playback';
import { editField, toolSide, useApp } from '../store/store';
import { openToolOn } from '../store/toolRequest';
import { restoreTargets, viewOf } from '../lib/translation';
import { useWaveform } from '../store/waveform';
import { SidePanel } from './SidePanel';
import { ShortenAi } from './ShortenAi';
import { useShortenRequest } from '../store/shorten';
import { aiProblem } from '../mt/ai';

const close = () => useApp.getState().openDialog(null);

const NO_IDS: string[] = [];

/** Each problem's own tool (same pure function as Fix): Adjust opens it on the subtitles that have it. */
const TOOL_OF: Partial<Record<AuditKind, { dialog: 'spaceOut' | 'minDuration' | 'balance' | 'hi'; name: string }>> = {
  overlap: { dialog: 'spaceOut', name: t.tools.spaceOut },
  gap: { dialog: 'spaceOut', name: t.tools.spaceOut },
  tooShort: { dialog: 'minDuration', name: t.tools.minDuration },
  tooFast: { dialog: 'minDuration', name: t.tools.minDuration },
  lines: { dialog: 'balance', name: t.tools.balance },
  hi: { dialog: 'hi', name: t.tools.cleanHi },
};

export function QualityPanel() {
  const doc = useApp((s) => s.doc)!;
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const commit = useApp((s) => s.commit);
  const spans = useWaveform((s) => s.dialogue?.spans ?? null);
  // While translating: the language edited (the original's checks when editing it).
  const side = useApp(toolSide);
  const seen = useMemo(() => viewOf(doc.cues, side), [doc.cues, side]);
  const tq = t.quality;

  const fps = useThumbs((s) => s.fps);
  // The convention last chosen, while the settings still follow it ("mine" once changed by hand).
  const saved = settings.qualityProfile as ProfileId;
  const convention = saved !== 'mine' ? CONVENTIONS[saved as Exclude<ProfileId, 'mine'>] : undefined;
  const follows = (p: Profile) =>
    p.maxCps === settings.maxCps &&
    p.maxLineLength === settings.maxLineLength &&
    p.minDurationMs === settings.minDurationMs &&
    p.minGapMs === settings.minGapMs;
  const current: ProfileId = convention && follows(profileFor(convention, settings.qualityChildren, fps, settings)) ? saved : 'mine';

  /** A convention's rules become the app's (warnings in the list and timeline follow them too). */
  const pick = (id: ProfileId, children = settings.qualityChildren) => {
    if (id === 'mine') return setSettings({ qualityProfile: 'mine' });
    const p = profileFor(CONVENTIONS[id], children, fps, settings);
    setSettings({
      qualityProfile: id,
      qualityChildren: children,
      maxCps: p.maxCps,
      maxLineLength: p.maxLineLength,
      minDurationMs: p.minDurationMs,
      minGapMs: p.minGapMs,
    });
  };
  const chosen = current !== 'mine' ? CONVENTIONS[current] : undefined;
  // The settings' rules, plus what only a convention says (white text only).
  const whiteOnly = !!chosen?.whiteOnly;
  // The language checked, so long lines are cut with its words.
  const lang = useApp((s) => (editField(s) === 'target' ? s.translation?.targetLang : s.doc?.lang));
  const profile = useMemo(() => ({ ...profileFromSettings(settings), whiteOnly, lang }), [settings, whiteOnly, lang]);
  const report = useMemo(() => audit(seen, profile, spans), [seen, profile, spans]);
  // The gap is in frames: when the video's frame rate becomes known, the chosen convention follows it.
  useEffect(() => {
    if (saved !== 'mine' && convention && !follows(profileFor(convention, settings.qualityChildren, fps, settings))) {
      const was = profileFor(convention, settings.qualityChildren, null, settings);
      if (follows(was)) pick(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fps]);

  // Show goes through the cases one by one: per kind, the last one shown (reset when the report changes).
  const [shown, setShown] = useState<Partial<Record<AuditKind, number>>>({});
  useEffect(() => setShown({}), [report]);
  const show = (k: AuditKind) => {
    const n = count(k);
    if (!n) return;
    const i = ((shown[k] ?? -1) + 1) % n;
    setShown({ [k]: i });
    if (k === 'speechOnly') player.seek(report.speechOnly[i][0]);
    else {
      const ids = report.ids[k]!;
      const cue = doc.cues.find((c) => c.id === ids[i]);
      // All of this kind stay selected (highlighted in the list and timeline); the playhead goes to this one.
      useApp.setState({ selection: ids });
      if (cue) player.seek(cue.start);
    }
    usePlayback.getState().setFollowPaused(false);
  };

  /** Apply a fix, then say what it did and what's left (fixes are limited by the room around). */
  const apply = (kinds: AuditKind[], next: typeof doc.cues, label: string) => {
    const problemsIn = (r: typeof report) => kinds.reduce((n, k) => n + (r.ids[k]?.length ?? 0), 0);
    const before = problemsIn(report);
    commit(next, label);
    const left = problemsIn(audit(viewOf(next, side), profile, spans));
    const fixed = Math.max(0, before - left);
    const notify = useApp.getState().notify;
    if (!left) notify(tq.fixedAll(fixed), { undo: true, tone: 'success' });
    else if (!fixed) notify(tq.fixedNone(left), { tone: 'warning' });
    // Some fixed, some left: a summary worth keeping until closed.
    else notify(tq.fixedSome(fixed, left), { undo: true, tone: 'warning', stay: true });
  };
  const fix = (kind: AuditKind) => apply([kind], restoreTargets(fixFor(kind)!(seen, profile), doc.cues), tq.kinds[kind].fixUndo);

  const count = (k: AuditKind) => (k === 'speechOnly' ? report.speechOnly.length : (report.ids[k]?.length ?? 0));
  const problems = FIXABLE.reduce((n, k) => n + count(k), 0);
  // Fix all: the subtitles it touches (one with two problems counts once).
  const toFix = new Set(FIXABLE.flatMap((k) => report.ids[k] ?? [])).size;
  // Shorten with AI: the model of Settings › Translation; the ids being shortened while reviewing.
  const aiMissing = aiProblem(settings);
  // Opened from Tools › Shorten with AI…: start on the review, and close when it's done (the report
  // wasn't asked for). From the report's own button: back to the report.
  const [fromMenu] = useState(() => {
    const asked = !!useShortenRequest.getState().ids;
    useShortenRequest.setState({ ids: null });
    // From the menu with subtitles selected: those first; else (and from the report) the too fast ones.
    return asked ? { preferSelection: useApp.getState().selection.length > 0 } : null;
  });
  const [shortening, setShortening] = useState<{ preferSelection: boolean } | null>(fromMenu);

  // `i`: its place in the list (every other row lighter).
  const row = (k: AuditKind, fixable: boolean, i: number) => {
    const n = count(k);
    return (
      <div key={k} className={`quality-row ${n ? '' : 'ok'} ${i % 2 ? 'alt' : ''}`}>
        <span className="quality-count tnum">{n}</span>
        <span className="quality-text">
          <strong>{tq.kinds[k].name}</strong>
          <span className="note">{tq.kinds[k].help(profile)}</span>
        </span>
        {n > 0 && (
          <span className="quality-actions">
            <button className="btn sm tnum" title={tq.showHint} onClick={() => show(k)}>
              {shown[k] !== undefined && n > 1 ? tq.showAt(shown[k]! + 1, n) : tq.show}
            </button>
            {TOOL_OF[k] && (
              <button className="btn sm" title={tq.adjustHint(TOOL_OF[k].name)} onClick={() => openToolOn(TOOL_OF[k]!.dialog, report.ids[k] ?? [])}>
                {tq.adjust}
              </button>
            )}
            {fixable && (
              <button className="btn sm primary-soft" onClick={() => fix(k)}>
                {tq.fix}
              </button>
            )}
            {k === 'tooFast' && (
              <button
                className="btn sm"
                disabled={!!aiMissing}
                title={aiMissing ? tq.shorten.needsAi : tq.shorten.hint}
                onClick={() => setShortening({ preferSelection: false })}
              >
                {tq.shorten.button} <AiPill />
              </button>
            )}
          </span>
        )}
      </div>
    );
  };

  const title = shortening ? t.quality.shorten.button : t.tools.quality;

  return (
    <SidePanel title={title} onClose={close} className="quality-panel">
      {shortening ? (
        <ShortenAi
          tooFast={report.ids.tooFast ?? NO_IDS}
          preferSelection={shortening.preferSelection}
          onDone={() => (fromMenu ? close() : setShortening(null))}
        />
      ) : (
        <>
          <div className="dialog-body">
            <div className="field">
              <label htmlFor="quality-profile">{tq.profile}</label>
              <select id="quality-profile" className="select" value={current} onChange={(e) => pick(e.target.value as ProfileId)}>
                {(Object.keys(tq.profiles) as ProfileId[]).map((id) => (
                  <option key={id} value={id}>
                    {tq.profiles[id]}
                  </option>
                ))}
              </select>
            </div>
            {chosen?.childrenCps && (
              <label className="check">
                <input type="checkbox" checked={settings.qualityChildren} onChange={(e) => pick(current, e.target.checked)} />
                <span>{tq.children(chosen.childrenCps)}</span>
              </label>
            )}
            <p className="note flush">
              {tq.rules(profile, fps)}
              {chosen?.lastResortCps && ` ${tq.lastResort(chosen.lastResortCps)}`}
            </p>

            <div className="group-title">{problems ? tq.problems(problems) : tq.noProblem}</div>
            <div className="quality-list">{FIXABLE.filter((k) => k !== 'colour' || whiteOnly).map((k, i) => row(k, !!fixFor(k), i))}</div>

            <div className="group-title">{tq.toCheck}</div>
            <p className="note flush">{tq.toCheckHelp}</p>
            <div className="quality-list">{TO_CHECK.filter((k) => k !== 'speechOnly' || spans).map((k, i) => row(k, false, i))}</div>
            {!spans && <p className="note flush">{tq.noAudio}</p>}
          </div>
          <div className="dialog-foot">
            <button className="btn" onClick={close}>
              {t.common.close}
            </button>
            <button className="btn primary" disabled={!problems} onClick={() => apply(FIXABLE, restoreTargets(fixAll(seen, profile), doc.cues), tq.fixAllUndo)}>
              {tq.fixAll(toFix)}
            </button>
          </div>
        </>
      )}
    </SidePanel>
  );
}
