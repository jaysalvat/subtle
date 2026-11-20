/** Smaller windows: what works in this browser, subtitles inside the film, add subtitles from a file. */
import { ProgressBand } from '../Progress';
import { Alert } from '../Alert';
import { countOverlaps, looksForced, prepareIncoming } from '../../lib/merge';
import { useState, type ReactNode } from 'react';
import { t } from '../../i18n';
import { useApp } from '../../store/store';
import { openFilmTrack, useFilmSubs } from '../../store/filmSubs';
import { trackLabel } from '../../lib/mkv';
import { langFromFileName, languageName } from '../../lib/languages';
import { middleEllipsis } from '../../lib/filename';
import { openZipSub, useZipSubs } from '../../store/zipSubs';
import { useSupport } from '../../store/support';
import { close, Dialog } from './Dialog';

/** What works in this browser (lib/support): each feature, what it gives, here or not. */
export function SupportDialog() {
  const missing = useSupport((s) => s.missing);
  const ts = t.support;
  return (
    <Dialog
      title={ts.title}
      footer={
        <button className="btn primary" onClick={close}>
          {t.common.close}
        </button>
      }
    >
      <p className="flush">{ts.intro}</p>
      <div className="support-list">
        {(['codecs', 'files', 'gpu', 'install'] as const).map((f) => {
          const ok = !missing.includes(f);
          return (
            <div key={f} className={`support-row ${ok ? 'ok' : 'no'}`}>
              <strong>{ts.features[f].name}</strong>
              <span className={ok ? 'support-ok' : 'support-no'}>{ok ? ts.ok : ts.missing}</span>
              <span className="note">{ts.features[f].gives}</span>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}

/** One choice in a list of subtitles to open: a track of the film, a file of a zip. */
interface SubsChoice {
  key: string;
  label: string;
  /** Muted after the label: "default", a language, a count. */
  note?: string;
  disabled?: boolean;
  /** Tooltip (a track's codec, why it can't open). */
  title?: string;
}

/**
 * Pick subtitles to open among several (the film's tracks, a zip's files): a radio list, Not now /
 * Open; `busy` (a progress band) takes the intro's place while reading.
 */
function PickSubsDialog({
  title,
  intro,
  busy,
  items,
  pick,
  onPick,
  onOpen,
}: {
  title: string;
  intro: string;
  busy?: ReactNode;
  items: SubsChoice[];
  pick: string;
  onPick: (key: string) => void;
  onOpen: () => void;
}) {
  const chosen = items.find((it) => it.key === pick && !it.disabled);
  return (
    <Dialog
      title={title}
      footer={
        <>
          <button className="btn" onClick={close}>
            {t.filmSubs.notNow}
          </button>
          <button className="btn primary" disabled={!chosen || !!busy} onClick={onOpen}>
            {t.filmSubs.open}
          </button>
        </>
      }
    >
      {/* At the top, in place of the intro: a long list would push it out of view. */}
      {busy || <p className="flush">{intro}</p>}
      {/* Cards like the other choices (speech to text model, translation engine). */}
      <div className="engine-list" role="radiogroup" aria-label={title}>
        {items.map((it) => (
          <label key={it.key} className={`engine ${it.disabled ? 'disabled' : ''}`} title={it.title}>
            <input type="radio" name="pick-subs" disabled={it.disabled || !!busy} checked={it.key === pick} onChange={() => onPick(it.key)} />
            <span>
              <strong>{it.label}</strong>
              {it.note && <span className="note">{it.note}</span>}
            </span>
          </label>
        ))}
      </div>
    </Dialog>
  );
}

/** Subtitle tracks inside the film (MKV): pick one, it opens like a .srt (add or replace if some are open). */
export function FilmSubsDialog() {
  const info = useFilmSubs((s) => s.info);
  const reading = useFilmSubs((s) => s.reading);
  const opening = useFilmSubs((s) => s.opening);
  const tracks = info?.tracks ?? [];
  const text = tracks.filter((tr) => tr.text);
  // "Default" means something only if not every track says it (Matroska's flag is on when absent).
  const marked = text.filter((tr) => tr.isDefault).length < text.length;
  const [pick, setPick] = useState(() => String(((marked && text.find((tr) => tr.isDefault)) || text[0])?.number ?? ''));
  const chosen = text.find((tr) => String(tr.number) === pick);
  return (
    <PickSubsDialog
      title={t.filmSubs.title}
      intro={t.filmSubs.intro(text.length)}
      busy={
        reading && (
          <ProgressBand
            title={opening ? t.filmSubs.opening : t.filmSubs.reading}
            done={reading.done}
            total={reading.total}
            show="percent"
            startedAt={reading.startedAt}
            variant="plain"
          />
        )
      }
      items={tracks.map((tr) => ({
        key: String(tr.number),
        label: trackLabel(tr),
        note: !tr.text ? t.filmSubs.picture : marked && tr.isDefault ? t.filmSubs.isDefault : undefined,
        disabled: !tr.text,
        title: tr.text ? tr.codec : t.filmSubs.picture,
      }))}
      pick={pick}
      onPick={setPick}
      onOpen={() => chosen && void openFilmTrack(chosen)}
    />
  );
}

/** Several subtitle files in a zip: pick one, it opens like a dropped .srt. */
export function ZipSubsDialog() {
  const { name, subs } = useZipSubs();
  const [pick, setPick] = useState(() => subs[0]?.path ?? '');
  const chosen = subs.find((z) => z.path === pick);
  return (
    <PickSubsDialog
      title={t.zipSubs.title}
      intro={t.zipSubs.intro(subs.length, name)}
      items={subs.map((z) => {
        const lang = langFromFileName(z.file.name);
        return { key: z.path, label: middleEllipsis(z.path, 48), note: [lang && languageName(lang), t.projects.cueCount(z.cues)].filter(Boolean).join(' · ') };
      })}
      pick={pick}
      onPick={setPick}
      onOpen={() => chosen && void openZipSub(chosen)}
    />
  );
}

export function AddSubsDialog() {
  const doc = useApp((s) => s.doc)!;
  const pending = useApp((s) => s.pendingSubs);
  const add = useApp((s) => s.addPendingSubs);
  const replace = useApp((s) => s.replaceWithPendingSubs);
  const forcedName = pending ? looksForced(pending.name) : false;
  const [top, setTop] = useState(forcedName);
  const [offsetS, setOffsetS] = useState('0');
  if (!pending) return null;
  const offsetMs = Math.round((Number(offsetS.replace(',', '.')) || 0) * 1000);
  const added = prepareIncoming(pending.doc.cues, {
    top,
    offsetMs,
    format: doc.format,
  });
  const overlaps = countOverlaps(doc.cues, added);
  const cancel = () => {
    useApp.setState({ pendingSubs: null });
    close();
  };
  return (
    <Dialog
      title={t.merge.title(pending.name)}
      alert={
        <>
          {pending.lost && <Alert>{t.formats.assLost(pending.lost)}</Alert>}
          {overlaps > 0 ? (
            <Alert>
              <strong className="tnum">{overlaps}</strong> {t.merge.overlaps(overlaps, top)}
            </Alert>
          ) : (
            <Alert tone="success">{t.merge.noOverlap}</Alert>
          )}
        </>
      }
      footer={
        <>
          <button className="btn danger" style={{ marginRight: 'auto' }} title={t.merge.replaceHint} onClick={replace}>
            {t.merge.replace}
          </button>
          <button className="btn" onClick={cancel}>
            {t.common.cancel}
          </button>
          <button className="btn primary" onClick={() => add({ top, offsetMs })}>
            {t.merge.add}
          </button>
        </>
      }
    >
      <p className="flush">{t.merge.intro(pending.doc.cues.length, doc.cues.length)}</p>
      <div className="field">
        <label htmlFor="merge-offset">{t.merge.offset}</label>
        <div className="offset-row">
          <input id="merge-offset" className="input tnum" title={t.merge.offsetHint} value={offsetS} onChange={(e) => setOffsetS(e.target.value)} />
          <span className="muted">{t.merge.seconds}</span>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={top} onChange={(e) => setTop(e.target.checked)} />
        <span>{t.merge.top}</span>
      </label>
      <p className="note flush">{t.merge.after}</p>
    </Dialog>
  );
}
