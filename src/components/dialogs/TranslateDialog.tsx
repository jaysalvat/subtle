/** Translate: language pair, automatic translation, Keep only. Retranslate the selection with an instruction. */
import { ask, choose } from '../Confirm';
import { Alert } from '../Alert';
import { canSaveInPlace, saveOriginal } from '../../store/file';
import { isLangCode, langFromFileName, languageName } from '../../lib/languages';
import { decodeSubtitleBytes } from '../../lib/encoding';
import { middleEllipsis } from '../../lib/filename';
import { parseSubtitles } from '../../lib/formats';
import type { Cue } from '../../lib/types';
import { DropZone, SUBS_ACCEPT, isSubtitleFile } from '../DropZone';
import { FileIcon } from '../Icons';
import { matchTranslation, sameSource, sourceLang, untranslatedCount } from '../../lib/translation';
import { LanguagePicker } from '../LanguagePicker';
import { AiPill } from '../Pill';
import { AutoTranslate, canTranslate, useEngineState } from '../AutoTranslate';
import { useMemo, useState } from 'react';
import { t, uiLanguage } from '../../i18n';
import { useApp } from '../../store/store';
import { close, Dialog } from './Dialog';

export function TranslateDialog() {
  const translation = useApp((s) => s.translation);
  const enable = useApp((s) => s.enableTranslation);
  const setTargetLang = useApp((s) => s.setTranslationLang);
  const setSource = useApp((s) => s.setTranslationSource);
  const adoptAll = useApp((s) => s.useTranslation);
  const notify = useApp((s) => s.notify);
  const disable = useApp((s) => s.disableTranslation);
  const engineId = useApp((s) => s.settings.translationEngine);
  const doc = useApp((s) => s.doc)!;
  const [from, setFrom] = useState(doc.lang ?? 'en');
  // Into the UI's language when it isn't the film's (a Spanish UI translates into Spanish), else French / English.
  const [to, setTo] = useState(translation?.targetLang ?? (uiLanguage !== 'en' && uiLanguage !== doc.lang ? uiLanguage : doc.lang === 'fr' ? 'en' : 'fr'));
  const [how, setHow] = useState<'auto' | 'copy' | 'empty' | 'file' | null>(null);
  // "Start from a file": the translation file, lined up on the original by time.
  const [file, setFile] = useState<{ name: string; cues: Cue[] } | null>(null);
  const match = useMemo(() => (file ? matchTranslation(doc.cues, file.cues) : null), [doc.cues, file]);
  const openFile = async (f: File) => {
    const cues = isSubtitleFile(f) ? parseSubtitles(f.name, decodeSubtitleBytes(await f.arrayBuffer()).text).cues : [];
    if (!cues.length) return useApp.getState().notify(t.syncRef.notSubs(f.name), { tone: 'warning' });
    setFile({ name: f.name, cues });
    const lang = langFromFileName(f.name);
    if (lang && lang !== from) setTo(lang);
  };
  // Set when "Translate automatically" was chosen: the follow-up view starts translating at once.
  const [autoStart, setAutoStart] = useState(false);
  // Another target language chosen with translations there: translate everything again into it.
  const [redoStart, setRedoStart] = useState(false);
  const engineState = useEngineState(from, to);
  const translated = doc.cues.filter((c) => c.target && c.target.trim()).length;
  const running = useApp((s) => s.autoTranslating);

  if (translation) {
    const left = untranslatedCount(doc.cues);
    // While an automatic translation runs, the window is about that only: its own title, and one way
    // out (closing stops it, what's done is kept). Same tree, so the run goes on.
    const busy = !!running;
    return (
      <Dialog
        title={busy ? t.translate.runningTitle(languageName(translation.targetLang)) : t.tools.finishTitle}
        footer={
          busy ? (
            <button className="btn danger" onClick={() => useApp.getState().openDialog(null)}>
              {t.mt.closeConfirm.ok}
            </button>
          ) : (
            <>
              <button
                className="btn danger"
                style={{ marginRight: 'auto' }}
                disabled={!!running}
                onClick={async () => {
                  if (translated === 0 || (await ask({ ...t.translate.discardConfirm(translated), danger: true }))) {
                    disable();
                    close();
                  }
                }}
              >
                {t.translate.discard}
              </button>
              <button className="btn" onClick={close}>
                {t.common.close}
              </button>
              <button
                className="btn primary"
                disabled={translated === 0 || !!running}
                onClick={async () => {
                  // Guard: the original's unsaved corrections would leave the editor with it.
                  const st = useApp.getState();
                  if (!sameSource(st.savedCues, st.doc!.cues)) {
                    const original = languageName(translation.sourceLang ?? (st.doc!.lang && st.doc!.lang !== translation.targetLang ? st.doc!.lang : 'en'));
                    const g = t.translate.keepGuard(original, languageName(translation.targetLang), st.savedCues === null && !st.fileHandle);
                    const c = await choose(canSaveInPlace ? g : { title: g.title, text: g.text, ok: g.alt, danger: true });
                    if (!c) return;
                    if (c === 'ok' && canSaveInPlace && !(await saveOriginal())) return;
                  }
                  adoptAll();
                  notify(t.translate.used(languageName(translation.targetLang)), {
                    undo: true,
                    tone: 'success',
                  });
                  close();
                }}
              >
                {t.translate.use(languageName(translation.targetLang))}
              </button>
            </>
          )
        }
      >
        {/* State first; what's needed now in the middle; the rest folded away. */}
        <p className="translate-status">
          <strong className="tnum">{t.translate.status(translated, doc.cues.length, languageName(translation.targetLang))}</strong>
          {left > 0 && <span className="muted tnum"> · {t.translate.left(left)}</span>}
        </p>
        {(left > 0 || autoStart || running === 'remaining') && <AutoTranslate compact autoStart={autoStart} />}
        {!busy && (
          <p className="note flush">
            {t.translate.useShort(languageName(translation.targetLang))} {left > 0 && translated > 0 && !running ? t.translate.untranslatedNote(left) : ''}
          </p>
        )}
        {running !== 'remaining' && (
          <details className="more-options">
            <summary>{t.translate.more}</summary>
            {/* The two languages together, then translating everything again. */}
            <div className="field">
              <label>{t.mt.from}</label>
              <LanguagePicker value={sourceLang(doc.lang, translation)} onChange={setSource} label={t.translate.sourceLanguage} />
            </div>
            <div className="field">
              <label>{t.translate.to}</label>
              <LanguagePicker
                value={translation.targetLang}
                onChange={async (next) => {
                  if (next === translation.targetLang) return;
                  // Translations there are in the old language: changing the name alone would
                  // label them wrongly. Offer to translate them again into the new one.
                  if (translated > 0) {
                    const r = t.translate.retarget;
                    const c = await choose({
                      title: r.title(languageName(next)),
                      text: r.text(translated, languageName(translation.targetLang)),
                      ok: r.ok(languageName(next)),
                      alt: r.alt,
                    });
                    if (!c) return;
                    setTargetLang(next);
                    if (c === 'ok') setRedoStart(true);
                    return;
                  }
                  setTargetLang(next);
                }}
              />
            </div>
            <p className="note flush">{t.translate.changeNote(translation.targetLang)}</p>
            <AutoTranslate autoStart={redoStart} />
          </details>
        )}
      </Dialog>
    );
  }

  const autoOk = canTranslate(engineState) && from !== to;
  // Default: automatic when the engine can do it, else start empty.
  const choice = how ?? (autoOk ? 'auto' : engineState === 'checking' ? null : 'empty');
  const engineName = t.mt.engines[engineId].name;
  return (
    <Dialog
      alert={
        from === to ? (
          <Alert>{t.translate.sameLang}</Alert>
        ) : choice === 'file' && match ? (
          match.unmatched ? (
            <Alert>{t.translate.fileLost(match.unmatched)}</Alert>
          ) : (
            <Alert tone="success">{t.translate.fileAll(match.matched)}</Alert>
          )
        ) : null
      }
      title={t.translate.title}
      footer={
        <>
          <button className="btn" onClick={close}>
            {t.common.cancel}
          </button>
          <button
            className="btn primary"
            disabled={
              !isLangCode(to) || !isLangCode(from) || from === to || !choice || (choice === 'auto' && !autoOk) || (choice === 'file' && !match?.matched)
            }
            onClick={() => {
              enable(to, choice === 'file' && match ? match.targets : choice === 'copy', from);
              if (choice === 'auto') setAutoStart(true);
              else close();
            }}
          >
            {choice === 'auto' ? t.translate.startAuto : t.translate.start}
          </button>
        </>
      }
    >
      <p className="flush">{t.translate.intro}</p>
      <div className="field">
        <label>{t.mt.from}</label>
        <LanguagePicker value={from} onChange={setFrom} label={t.translate.sourceLanguage} />
      </div>
      <div className="field">
        <label>{t.translate.to}</label>
        <LanguagePicker value={to} onChange={setTo} />
      </div>
      <div className="group-title">{t.translate.how}</div>
      <div className="engine-list" role="radiogroup" aria-label={t.translate.how}>
        <label className="engine">
          <input type="radio" name="how" checked={choice === 'empty'} onChange={() => setHow('empty')} />
          <span>
            <strong>{t.translate.howEmpty}</strong>
          </span>
        </label>
        <label className="engine">
          <input type="radio" name="how" checked={choice === 'file'} onChange={() => setHow('file')} />
          <span>
            <strong>{t.translate.howFile}</strong>
            <span className="note">{t.translate.howFileHelp}</span>
          </span>
        </label>
        {choice === 'file' && (
          <DropZone accept={SUBS_ACCEPT} onFile={(f) => void openFile(f)} className="subs translate-drop" label={t.translate.fileDrop} own>
            <FileIcon color="var(--text-muted)" />
            {file ? (
              <>
                <span className="title">{middleEllipsis(file.name, 36)}</span>
                <span className="muted">
                  {t.projects.cueCount(file.cues.length)} · <span className="link">{t.syncRef.change}</span>
                </span>
              </>
            ) : (
              <>
                <span className="title">{t.translate.fileDrop}</span>
                <span className="muted">
                  {t.drop.subsOr} <span className="link">{t.drop.subsBrowse}</span>
                </span>
              </>
            )}
          </DropZone>
        )}
        <label className="engine">
          <input type="radio" name="how" checked={choice === 'copy'} onChange={() => setHow('copy')} />
          <span>
            <strong>{t.translate.howCopy}</strong>
            <span className="note">{t.translate.howCopyHelp}</span>
          </span>
        </label>
        <label className={`engine ${autoOk ? '' : 'later'}`}>
          <input type="radio" name="how" disabled={!autoOk} checked={choice === 'auto'} onChange={() => setHow('auto')} />
          <span>
            <span className="engine-name">
              <strong>{t.translate.howAuto}</strong>
              <AiPill />
            </span>
            <span className="note">
              {engineName} · {engineState === 'checking' ? t.mt.checking : t.mt.state[engineState]}
            </span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}

/** Tools › Retranslate the selection: the AI model again on the selected subtitles, with an instruction. */
export function RetranslateDialog() {
  const selection = useApp((s) => s.selection);
  const [instruction, setInstruction] = useState('');
  // The footer spot where AutoTranslate puts its start button.
  const [startSlot, setStartSlot] = useState<HTMLSpanElement | null>(null);
  return (
    <Dialog
      title={t.retranslate.title}
      footer={
        <>
          <button className="btn" onClick={close}>
            {t.common.cancel}
          </button>
          <span ref={setStartSlot} className="start-slot" />
        </>
      }
    >
      <div className="field stack">
        <label htmlFor="retranslate-instruction">{t.retranslate.instruction}</label>
        <textarea
          id="retranslate-instruction"
          className="input"
          rows={2}
          autoFocus
          placeholder={t.retranslate.placeholder}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
      </div>
      <AutoTranslate
        compact
        ai
        only={selection}
        instruction={instruction}
        startIn={startSlot}
        startLabel={t.retranslate.start(selection.length)}
        closeWhenDone
      />
    </Dialog>
  );
}
