import { aiProblem } from '../mt/ai';
import { showProjects, useProjects } from '../store/projects';
import { viewOf } from '../lib/translation';
import { middleEllipsis } from '../lib/filename';
import { audit, profileFromSettings } from '../lib/audit';
import { hasColour } from '../lib/colour';
import { removeAllColours } from '../actions';
import { useShortenRequest } from '../store/shorten';
import { canSaveInPlace, isDirty, pickSubtitleFile, pickVideoFile, reopenVideo, saveFile } from '../store/file';
import { FEATURES } from '../features';
import { useRef } from 'react';
import { t, uiLanguage } from '../i18n';
import { sortInSections } from '../lib/menu';
import { SUBS_ACCEPT, VIDEO_ACCEPT } from './DropZone';
import { toolSide, useApp } from '../store/store';
import { ProjectsIcon, Gear, Keyboard, Logo, Redo, Undo } from './Icons';
import { Menu } from './Menu';
import { languageName } from '../lib/languages';
import { BookmarksMenu } from './BookmarksMenu';
import { useFilmSubs } from '../store/filmSubs';
import { useSupport } from '../store/support';

export function TopBar() {
  const doc = useApp((s) => s.doc);
  const subtitleName = useApp((s) => s.subtitleName);
  const video = useApp((s) => s.video);
  const expectedVideo = useApp((s) => s.expectedVideo);
  const videoHandle = useApp((s) => s.videoHandle);
  const translation = useApp((s) => s.translation);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const undoLabel = useApp((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useApp((s) => s.future[0]?.label);
  const open = useApp((s) => s.openDialog);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const has = !!doc;
  const videoInput = useRef<HTMLInputElement>(null);
  const subsInput = useRef<HTMLInputElement>(null);
  const creating = useApp((s) => s.creatingSubs);
  const aiMissing = useApp((s) => aiProblem(s.settings));
  const fileName = useApp((s) => (s.fileHandle ? s.fileHandle.name : null));
  // While translating, Save writes the translation (its own file).
  const translating = useApp((s) => !!s.translation);
  // Remove colours only when there's something to remove (a boolean: no new object per change).
  const coloured = useApp((s) => !!s.doc?.cues.some((c) => hasColour(c.text) || (!!c.target && hasColour(c.target))));
  const selected = useApp((s) => s.selection.length > 0);
  const targetName = useApp((s) => (s.targetHandle ? s.targetHandle.name : null));
  // Text subtitle tracks inside the film (MKV).
  const filmTracks = useFilmSubs((s) => s.info?.tracks.filter((tr) => tr.text).length ?? 0);

  const pageOpen = useProjects((s) => s.pageOpen);
  const decodes = useSupport((s) => !s.missing.includes('codecs'));

  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        {t.app}
      </div>
      <button className="btn toggle" aria-pressed={pageOpen} title={t.projects.pageHint} onClick={() => showProjects(!pageOpen)}>
        <ProjectsIcon /> {t.projects.page}
      </button>
      <div className="chips">
        <input
          ref={videoInput}
          type="file"
          accept={VIDEO_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) useApp.getState().loadVideoFile(f);
            e.target.value = '';
          }}
        />
        <input
          ref={subsInput}
          type="file"
          accept={SUBS_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void useApp.getState().offerSubtitleFile(f);
            e.target.value = '';
          }}
        />
        {video && (
          <button
            className="chip chip-btn"
            title={`${video.name}\n${t.files.replaceVideo}`}
            onClick={() => void pickVideoFile(() => videoInput.current?.click())}
          >
            {middleEllipsis(video.name)}
          </button>
        )}
        {!video && expectedVideo && (
          <button className="chip missing chip-btn" title={expectedVideo.name} onClick={() => void reopenVideo(() => videoInput.current?.click())}>
            {videoHandle ? t.reopenVideo(middleEllipsis(expectedVideo.name, 24)) : t.dropVideoAgain(middleEllipsis(expectedVideo.name, 20))}
          </button>
        )}
        {subtitleName && (
          <button
            className="chip chip-btn"
            title={`${subtitleName}\n${t.files.replaceSubs}`}
            onClick={() => void pickSubtitleFile(() => subsInput.current?.click())}
          >
            {middleEllipsis(subtitleName)}
          </button>
        )}
        {has && <SaveStatus />}
      </div>
      <div className="spacer" />
      <nav className="tools" aria-label={t.tools.menu}>
        <BookmarksMenu />
        <Menu
          label={t.tools.menu}
          columns={2}
          disabled={!(has || video) || creating}
          items={sortInSections(
            [
              // Sections: Quality, Timing, Text, File; in each, A to Z in the app's language.
              { section: t.tools.sections.quality, label: t.tools.quality, hint: t.tools.qualityHint, disabled: !has, onSelect: () => open('quality') },
              {
                section: t.tools.sections.timing,
                label: t.tools.syncAssistant,
                hint: t.tools.syncAssistantHint,
                disabled: !has,
                onSelect: () => open('syncAssistant'),
              },
              { label: t.tools.sync, hint: t.tools.syncHint, disabled: !has, onSelect: () => open('sync') },
              { label: t.tools.shift, hint: t.tools.shiftHint, disabled: !has, onSelect: () => open('shift') },
              { label: t.tools.syncRef, hint: t.tools.syncRefHint, disabled: !has, onSelect: () => open('syncRef') },
              { label: t.tools.align, hint: t.tools.alignHint, pill: t.common.ai, disabled: !has, onSelect: () => open('align') },
              { label: t.tools.fps, hint: t.tools.fpsHint, disabled: !has, onSelect: () => open('fps') },
              { label: t.tools.minDuration, hint: t.tools.minDurationHint, disabled: !has, onSelect: () => open('minDuration') },
              { section: t.tools.sections.text, label: t.tools.cleanHi, hint: t.tools.cleanHiHint, disabled: !has, onSelect: () => open('hi') },
              { label: t.tools.balance, hint: t.tools.balanceHint, disabled: !has, onSelect: () => open('balance') },
              { label: t.tools.punctuation, hint: t.tools.punctuationHint, disabled: !has, onSelect: () => open('punctuation') },
              { label: t.tools.replace, hint: t.tools.replaceHint, disabled: !has, onSelect: () => open('replace') },
              {
                label: t.tools.removeColours,
                hint: coloured ? t.tools.removeColoursHint : t.tools.removeColoursNone,
                disabled: !coloured,
                onSelect: removeAllColours,
              },
              { label: t.tools.sign, hint: t.tools.signHint, disabled: !has, onSelect: () => open('sign') },
              {
                label: t.tools.shorten,
                pill: t.common.ai,
                hint: aiMissing && has ? t.quality.shorten.needsAi : t.tools.shortenHint,
                disabled: !has || !!aiMissing,
                onSelect: () => {
                  // The selected subtitles, else every one too fast to read with the current rules.
                  const st = useApp.getState();
                  const ids = st.selection.length
                    ? st.selection
                    : (audit(viewOf(st.doc!.cues, toolSide(st)), profileFromSettings(st.settings), null).ids.tooFast ?? []);
                  if (!ids.length) return st.notify(t.tools.shortenNone);
                  useShortenRequest.setState({ ids });
                  open('quality');
                },
              },
              {
                label: t.tools.review,
                pill: t.common.ai,
                hint: aiMissing && has ? t.quality.shorten.needsAi : t.tools.reviewHint,
                disabled: !has || !!aiMissing,
                onSelect: () => open('review'),
              },
              ...(translating
                ? [
                    {
                      label: t.tools.retranslate,
                      pill: t.common.ai,
                      hint: aiMissing ? t.quality.shorten.needsAi : selected ? t.tools.retranslateHint : t.tools.retranslateNone,
                      disabled: !!aiMissing || !selected,
                      onSelect: () => open('retranslate'),
                    },
                    {
                      label: t.tools.checkTranslation,
                      pill: t.common.ai,
                      hint: aiMissing ? t.quality.shorten.needsAi : t.tools.checkTranslationHint,
                      disabled: !!aiMissing,
                      onSelect: () => open('checkTranslation'),
                    },
                  ]
                : []),
              {
                section: t.tools.sections.file,
                label: t.filmSubs.menu,
                hint: filmTracks ? t.filmSubs.menuHint : t.filmSubs.menuNone,
                disabled: !filmTracks,
                onSelect: () => open('filmSubs'),
              },
              { label: t.merge.menu, hint: t.merge.menuHint, disabled: !has, onSelect: () => void pickSubtitleFile(() => subsInput.current?.click()) },
              {
                label: t.stt.entry,
                pill: t.common.ai,
                hint: decodes ? t.stt.entryHint : t.support.needsChrome,
                disabled: !video || !decodes,
                onSelect: () => open('stt'),
              },
            ],
            uiLanguage,
          )}
        />
        {FEATURES.translation && (
          <button
            className="btn toggle"
            aria-pressed={!!translation}
            disabled={!has || creating}
            title={translation ? t.tools.finishTip(languageName(translation.targetLang)) : undefined}
            onClick={() => open('translate')}
          >
            {translation ? t.tools.finish : t.tools.translate}
          </button>
        )}
      </nav>
      <div className="vsep" />
      <div className="tools">
        <button
          className="icon-btn"
          aria-label={t.tools.undo}
          title={undoLabel ? `${t.tools.undo}: ${undoLabel}` : t.tools.undo}
          disabled={!canUndo || creating}
          onClick={undo}
        >
          <Undo />
        </button>
        <button
          className="icon-btn"
          aria-label={t.tools.redo}
          title={redoLabel ? `${t.tools.redo}: ${redoLabel}` : t.tools.redo}
          disabled={!canRedo || creating}
          onClick={redo}
        >
          <Redo />
        </button>
        <button className="icon-btn" aria-label={t.shortcuts.title} title={t.shortcuts.open} onClick={() => open('shortcuts')}>
          <Keyboard />
        </button>
        <button className="icon-btn" aria-label={t.tools.settings} title={`${t.tools.settings} (⌘,)`} onClick={() => open('settings')}>
          <Gear />
        </button>
      </div>
      {canSaveInPlace && has ? (
        <>
          <button className="btn" disabled={creating} title={t.save.exportCopyHint} onClick={() => open('export')}>
            {t.save.exportCopy}
          </button>
          <button
            className="btn primary"
            disabled={creating}
            title={
              translating
                ? targetName
                  ? t.save.saveTranslationHint(targetName)
                  : t.save.saveTranslationNewHint
                : fileName
                  ? t.save.saveHint(fileName)
                  : t.save.saveAsHint
            }
            onClick={() => void saveFile()}
          >
            {t.save.save}
          </button>
        </>
      ) : (
        <button className="btn primary" disabled={!has || creating} onClick={() => open('export')}>
          {t.tools.export}
        </button>
      )}
    </header>
  );
}

/** Next to the file names: "Saved" / "Unsaved changes" against the file, else "Saved locally". */
function SaveStatus() {
  const hasFile = useApp((s) => !!s.fileHandle);
  const dirty = useApp(isDirty);
  if (!canSaveInPlace || (!hasFile && !dirty)) return <span className="dim">{t.savedLocally}</span>;
  return dirty ? (
    <span className="save-status unsaved" title={t.save.statusUnsavedHint}>
      {t.save.statusUnsaved}
    </span>
  ) : (
    <span className="dim">{t.save.statusSaved}</span>
  );
}
