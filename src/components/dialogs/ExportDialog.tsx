/** Export a copy (format, name, BOM, quality note). */
import { FORMAT_INFO } from '../../lib/formats';
import { Alert } from '../Alert';
import { audit, FIXABLE, profileFromSettings } from '../../lib/audit';
import { cleanFileName, defaultExportName } from '../../lib/filename';
import { useMemo, useState } from 'react';
import { t } from '../../i18n';
import { type SubtitleFormat } from '../../lib/types';
import { useApp } from '../../store/store';
import { close, Dialog } from './Dialog';

export function ExportDialog() {
  const doc = useApp((s) => s.doc)!;
  const settings = useApp((s) => s.settings);
  const translation = useApp((s) => s.translation);
  const exportFile = useApp((s) => s.exportFile);
  const [format, setFormat] = useState<SubtitleFormat>(settings.exportFormat === 'same' ? doc.format : settings.exportFormat);
  const [which, setWhich] = useState<'source' | 'target'>(translation ? 'target' : 'source');
  const videoName = useApp((s) => s.video?.name ?? s.expectedVideo?.name ?? null);
  const subtitleName = useApp((s) => s.subtitleName);
  const suggested = defaultExportName({
    video: videoName,
    subtitles: subtitleName,
    lang: which === 'target' && translation ? translation.targetLang : (doc.lang ?? null),
  });
  // Your own name wins; until you type one, it follows the suggestion (e.g. when switching to the translation).
  const [typed, setTyped] = useState<string | null>(null);
  const name = typed ?? suggested;
  const doExport = () => {
    exportFile(format, which, cleanFileName(name, format));
    close();
  };
  // Problems Check quality could fix, with the current rules (a reminder, never a block).
  const problems = useMemo(() => {
    if (!settings.qualityOnExport) return 0;
    const r = audit(doc.cues, profileFromSettings(settings), null);
    return FIXABLE.reduce((n, k) => n + (r.ids[k]?.length ?? 0), 0);
  }, [doc.cues, settings]);
  return (
    <Dialog
      title={t.tools.export}
      alert={
        problems > 0 && (
          <Alert
            actions={
              <>
                <button className="btn sm" onClick={() => useApp.getState().openDialog('quality')}>
                  {t.tools.quality}
                </button>
                <button className="link-btn" onClick={() => useApp.getState().setSettings({ qualityOnExport: false })}>
                  {t.quality.exportDontRemind}
                </button>
              </>
            }
          >
            {t.quality.exportNote(problems)}
          </Alert>
        )
      }
      footer={
        <>
          <button className="btn" onClick={close}>
            {t.common.cancel}
          </button>
          <button className="btn primary" onClick={doExport}>
            {t.export.button(FORMAT_INFO[format].label)}
          </button>
        </>
      }
    >
      <div className="field">
        <label>{t.export.format}</label>
        <div className="format-list" role="radiogroup" aria-label={t.export.format}>
          {(Object.keys(FORMAT_INFO) as SubtitleFormat[]).map((f) => (
            <label key={f}>
              <input type="radio" checked={format === f} onChange={() => setFormat(f)} />
              <span>{FORMAT_INFO[f].label}</span>
              <span className="muted">{t.formats.uses[f]}</span>
            </label>
          ))}
        </div>
      </div>
      {t.formats.lossy[format] && <p className="note flush">{t.formats.lossy[format]}</p>}
      {translation && (
        <div className="field">
          <label>{t.export.text}</label>
          <div className="radio-row">
            <label>
              <input type="radio" checked={which === 'target'} onChange={() => setWhich('target')} /> {t.export.translation(translation.targetLang)}
            </label>
            <label>
              <input type="radio" checked={which === 'source'} onChange={() => setWhich('source')} /> {t.export.source}
            </label>
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor="export-name">{t.export.fileName}</label>
        <div className="file-name">
          <input
            id="export-name"
            className="input"
            value={name}
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doExport()}
          />
          <span className="muted tnum">.{format}</span>
        </div>
      </div>
      <p className="note flush">
        {videoName && typed === null ? t.export.namedAfterVideo : null} {t.export.note(settings.exportBom, doc.cues.length)}
      </p>
    </Dialog>
  );
}
