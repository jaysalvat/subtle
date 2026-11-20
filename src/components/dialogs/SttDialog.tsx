/** Create subtitles from the audio (Whisper in the browser). */
import { ComboBox } from '../ComboBox';
import { Alert } from '../Alert';
import { ProgressBand } from '../Progress';
import { isModelCached, spaceLeft, startStt, stopStt, useStt } from '../../store/stt';
import { STT_MODELS, type SttModelId } from '../../lib/stt';
import { useWaveform } from '../../store/waveform';
import { languageName, LANGUAGES } from '../../lib/languages';
import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { useApp } from '../../store/store';
import { close, Dialog } from './Dialog';

/** Whisper's languages: "detect" first, then ours by their base code (pt-BR and pt are the same to it). */
const languageOptions = [
  { value: '', label: t.stt.detect },
  ...LANGUAGES.filter((l, i, all) => all.findIndex((o) => o.code.split('-')[0] === l.code.split('-')[0]) === i).map((l) => ({
    value: l.code.split('-')[0],
    label: languageName(l.code),
    hint: l.code.split('-')[0],
  })),
];

export function SttDialog() {
  const phase = useStt((s) => s.phase);
  const download = useStt((s) => s.download);
  const error = useStt((s) => s.error);
  const audio = useWaveform((s) => (s.status === 'reading' ? Math.round(s.progress * 100) : s.status));
  const [model, setModel] = useState<SttModelId>('fast');
  const existing = useApp((s) => s.doc?.cues.length ?? 0);
  const [language, setLanguage] = useState('');
  const [cached, setCached] = useState<Record<SttModelId, boolean>>({ fast: false, accurate: false });
  const [space, setSpace] = useState<number | null>(null);
  const ts = t.stt;
  useEffect(() => {
    void Promise.all([isModelCached('fast'), isModelCached('accurate')]).then(([fast, accurate]) => {
      setCached({ fast, accurate });
      // Accurate already downloaded: no reason to pick the lesser one.
      if (accurate) setModel('accurate');
    });
    void spaceLeft().then(setSpace);
  }, []);
  // Closing the window while the model loads cancels it (once transcribing, the window is gone).
  useEffect(() => () => void (useStt.getState().phase === 'loading' && stopStt()), []);

  const mb = STT_MODELS[model].mb;
  const noSpace = !cached[model] && space !== null && space < mb * 1024 * 1024 * 1.1;
  const loading = phase === 'loading';
  const mbText = (b: number) => `${Math.round(b / 1048576)} MB`;

  return (
    <Dialog
      title={ts.title}
      alert={
        (noSpace || error) && (
          <>
            {noSpace && <Alert>{ts.noSpace(ts.size(mb))}</Alert>}
            {error && <Alert>{ts.error(error)}</Alert>}
          </>
        )
      }
      footer={
        <>
          <button
            className="btn"
            onClick={() => {
              if (loading) stopStt();
              close();
            }}
          >
            {ts.cancel}
          </button>
          <button className="btn primary" disabled={loading || noSpace || typeof audio === 'number'} onClick={() => void startStt(model, language)}>
            {ts.start}
          </button>
        </>
      }
    >
      <p className="flush">{ts.intro}</p>
      <div className="group-title">{ts.model}</div>
      <div className="engine-list" role="radiogroup" aria-label={ts.model}>
        {(['fast', 'accurate'] as const).map((id) => (
          <label key={id} className="engine">
            <input type="radio" name="stt-model" checked={model === id} disabled={loading} onChange={() => setModel(id)} />
            <span>
              <span>
                <strong>{ts.models[id].name}</strong>
                <span className="muted"> · {cached[id] ? ts.downloaded : ts.toDownload(ts.size(STT_MODELS[id].mb))}</span>
              </span>
              <span className="note">{ts.models[id].help}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="field">
        <label htmlFor="stt-lang">{ts.language}</label>
        <ComboBox inputId="stt-lang" ariaLabel={ts.language} value={language} disabled={loading} onChange={setLanguage} options={languageOptions} />
      </div>
      {existing > 0 && <p className="note flush">{ts.continueNote(existing)}</p>}
      {typeof audio === 'number' && <p className="note flush">{ts.waitDialogue(audio)}</p>}
      {loading && (
        <ProgressBand
          title={
            download?.total && download.loaded < download.total
              ? cached[model]
                ? ts.loadingPct(Math.round((download.loaded / download.total) * 100))
                : ts.downloading(mbText(download.loaded), mbText(download.total))
              : ts.loading
          }
          done={download?.loaded ?? 0}
          total={download?.total ?? 0}
          show={{ text: '' }}
          variant="plain"
        />
      )}
    </Dialog>
  );
}
