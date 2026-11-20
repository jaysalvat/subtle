/** Settings: editing rules, display, export, storage, AI service and model. */
import { HEAVY_BYTES } from '../../lib/bytes';
import {
  browserLanguage,
  UI_LANGUAGE_INFO,
  languageOf,
  setUiLanguageChoice,
  UI_LANGUAGES,
  uiLanguage,
  uiLanguageChoice,
  type UiLanguageChoice,
} from '../../i18n';
import { Alert } from '../Alert';
import { installApp, useInstall } from '../../store/install';
import { FORMAT_INFO } from '../../lib/formats';
import { clearModel, clearWaveformCache, formatBytes, storageInfo, type StorageInfo } from '../../store/storage';
import { showProjects, useProjects } from '../../store/projects';
import { FEATURES } from '../../features';
import { ComboBox } from '../ComboBox';
import { NumberInput } from '../NumberInput';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { AiPill } from '../Pill';
import { listModels } from '../../mt/models';
import { isCloudModel, type AiModel } from '../../lib/mtAi';
import { DEFAULT_SETTINGS, type AiProvider, CLOUD_PROVIDERS, type Settings, type SubtitleFormat } from '../../lib/types';
import { useApp } from '../../store/store';
import { close, Dialog } from './Dialog';

/** A stored size, in red from 100 MB: worth noticing (e.g. the speech recognition models). */
export function Size({ bytes }: { bytes: number }) {
  return <span className={`tnum ${bytes >= HEAVY_BYTES ? 'size-heavy' : ''}`}>{formatBytes(bytes)}</span>;
}

/** Settings › Storage › Projects: how many, their size, and the Projects page (where they're managed). */
export function ProjectsStorage() {
  const list = useProjects((s) => s.list);
  const tp = t.projects;
  const bytes = list.reduce((n, p) => n + (p.bytes ?? 0), 0);
  return (
    <>
      <div className="group-title">{tp.storageTitle}</div>
      <div className="storage-row">
        <span>{tp.storageCount(list.length)}</span>
        <span className="storage-size">{list.length > 0 && <Size bytes={bytes} />}</span>
        <button
          className="btn sm"
          onClick={() => {
            close();
            showProjects(true);
          }}
        >
          {tp.manage}
        </button>
      </div>
    </>
  );
}

/** Settings › Storage: what Subtle keeps in this browser, with a way to free it. */
export function StoragePanel() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const refresh = () => void storageInfo().then(setInfo);
  useEffect(refresh, []);
  const st = t.settings.storage;
  if (!info) return <p className="note">{st.loading}</p>;
  return (
    <>
      <p className="note flush">{st.intro}</p>
      <div className="group-title">{st.filmsTitle}</div>
      <div className="storage-row">
        <span>
          {st.films(info.films)}
          <br />
          <span className="note">{st.filmsNote}</span>
        </span>
        <span className="storage-size">{info.films > 0 && <Size bytes={info.filmBytes} />}</span>
        <button
          className="btn sm"
          disabled={!info.films}
          onClick={async () => {
            await clearWaveformCache();
            useApp.getState().notify(st.filmsCleared);
            refresh();
          }}
        >
          {st.clear}
        </button>
      </div>
      <ProjectsStorage />
      <div className="group-title">{st.modelsTitle}</div>
      {!info.models.length && <p className="note flush">{st.none}</p>}
      {info.models.map((m) => (
        <div key={m.id} className="storage-row">
          <span>
            {st.models[m.id].name}
            <br />
            <span className="note">{st.models[m.id].note}</span>
          </span>
          <span className="storage-size">
            <Size bytes={m.bytes} />
          </span>
          <button
            className="btn sm"
            onClick={async () => {
              await clearModel(m.id);
              useApp.getState().notify(st.modelCleared(st.models[m.id].name));
              refresh();
            }}
          >
            {st.clear}
          </button>
        </div>
      ))}
      {info.totalBytes !== null && (
        <>
          <div className="group-title">{st.totalTitle}</div>
          <div className="storage-row">
            <span className="note">{st.totalNote}</span>
            <span className="storage-size">
              <Size bytes={info.totalBytes} />
            </span>
            <span />
          </div>
        </>
      )}
    </>
  );
}

export function SettingsDialog() {
  const s = useApp((st) => st.settings);
  const set = useApp((st) => st.setSettings);
  const reset = useApp((st) => st.resetSettings);
  const [tab, setTab] = useState<'general' | 'translation' | 'storage' | 'credits'>('general');
  const ts = t.settings;
  const num = (key: keyof Settings, label: string, unit: string, opts: { step?: number; scale?: number } = {}) => {
    const scale = opts.scale ?? 1;
    return (
      <div className="field">
        <label>{label}</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <NumberInput
            value={(s[key] as number) / scale}
            step={opts.step}
            min={0}
            label={label}
            onChange={(v) => set({ [key]: Math.round(v * scale) } as Partial<Settings>)}
          />
          <span className="dim">{unit}</span>
        </div>
      </div>
    );
  };
  return (
    <Dialog
      title={t.tools.settings}
      footer={
        <>
          <button className="btn" style={{ marginRight: 'auto' }} onClick={reset}>
            {t.settings.restoreDefaults}
          </button>
          <button className="btn primary" onClick={close}>
            {t.settings.done}
          </button>
        </>
      }
    >
      {
        <div className="tabs" role="tablist">
          {(FEATURES.translation ? (['general', 'translation', 'storage', 'credits'] as const) : (['general', 'storage', 'credits'] as const)).map((id) => (
            <button key={id} role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {t.settings.tabs[id]}
            </button>
          ))}
        </div>
      }
      <div className="settings-body">
        {tab === 'general' ? (
          <>
            <InstallSetting />
            <div className="group-title">{ts.groups.timing}</div>
            {num('minDurationMs', ts.minDuration, t.common.s, {
              step: 0.1,
              scale: 1000,
            })}
            <label className="check">
              <input type="checkbox" checked={s.cpsBasedMinDuration} onChange={(e) => set({ cpsBasedMinDuration: e.target.checked })} />
              <span>{t.minDuration.cpsBased}</span>
            </label>
            {num('minGapMs', ts.minGap, t.common.ms, {
              step: 10,
            })}
            {num('floorDurationMs', ts.floorDuration, t.common.ms, {
              step: 50,
            })}
            <div className="group-title">{ts.groups.editing}</div>
            {num('nudgeStepMs', ts.nudgeStep, t.common.ms, { step: 10 })}
            <label className="check">
              <input type="checkbox" checked={s.snapping} onChange={(e) => set({ snapping: e.target.checked })} />
              <span>{ts.snapping}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={s.spotTypeNow} onChange={(e) => set({ spotTypeNow: e.target.checked })} />
              <span>
                {t.spot.settingTypeNow}
                <br />
                <span className="note">{t.spot.settingTypeNowHint}</span>
              </span>
            </label>
            <div className="group-title">{ts.groups.readability}</div>
            {num('maxCps', ts.maxCps, ts.cpsUnit)}
            {num('maxLineLength', ts.maxLineLength, ts.charsUnit)}
            <div className="group-title">{ts.groups.navigation}</div>
            <label className="check">
              <input type="checkbox" checked={s.autoPlayOnJump} onChange={(e) => set({ autoPlayOnJump: e.target.checked })} />
              <span>{ts.autoPlayOnJump}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={s.clickToPlay} onChange={(e) => set({ clickToPlay: e.target.checked })} />
              <span>{ts.clickToPlay}</span>
            </label>
            <div className="group-title">{ts.groups.export}</div>
            <div className="field">
              <label>{ts.defaultFormat}</label>
              <select
                className="select"
                value={s.exportFormat}
                onChange={(e) =>
                  set({
                    exportFormat: e.target.value as Settings['exportFormat'],
                  })
                }
              >
                <option value="same">{ts.sameFormat}</option>
                {(Object.keys(FORMAT_INFO) as SubtitleFormat[]).map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_INFO[f].label}
                  </option>
                ))}
              </select>
            </div>
            <label className="check">
              <input type="checkbox" checked={s.exportBom} onChange={(e) => set({ exportBom: e.target.checked })} />
              <span>
                {ts.bom}
                <br />
                <span className="note">{ts.bomNote}</span>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={s.qualityOnExport} onChange={(e) => set({ qualityOnExport: e.target.checked })} />
              <span>
                {t.quality.settingOnExport}
                <br />
                <span className="note">{t.quality.settingOnExportHint}</span>
              </span>
            </label>
          </>
        ) : tab === 'storage' ? (
          <StoragePanel />
        ) : tab === 'credits' ? (
          <CreditsPanel />
        ) : (
          <>
            <div className="engine-list" role="radiogroup" aria-label={t.mt.settingsTitle}>
              {(['chrome', 'ai', 'local'] as const).map((id) => {
                const e = t.mt.engines[id];
                const chromeMissing = id === 'chrome' && typeof (globalThis as { Translator?: unknown }).Translator === 'undefined';
                return (
                  <label key={id} className="engine">
                    <input type="radio" name="engine" checked={s.translationEngine === id} onChange={() => set({ translationEngine: id })} />
                    <span>
                      <span className="engine-name">
                        <strong>{e.name}</strong>
                        {id !== 'chrome' && <AiPill />}
                      </span>
                      <span className="note">{chromeMissing ? t.mt.chromeMissing : e.help}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {s.translationEngine === 'ai' && <AiSettings />}
            {s.translationEngine === 'local' && <LocalSettings />}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** package.json's version, filled in by Vite (define in vite.config.ts). */
declare const __APP_VERSION__: string;

const REPO_URL = 'https://github.com/jaysalvat/subtle';

/** The open source projects Subtle runs on (what ships to the browser, models included). */
const CREDITS: { id: keyof typeof t.settings.credits.roles; name: string; url: string; licence: string }[] = [
  { id: 'react', name: 'React', url: 'https://react.dev', licence: 'MIT' },
  { id: 'zustand', name: 'Zustand', url: 'https://github.com/pmndrs/zustand', licence: 'MIT' },
  { id: 'mediabunny', name: 'Mediabunny', url: 'https://mediabunny.dev', licence: 'MPL-2.0' },
  { id: 'transformers', name: 'Transformers.js', url: 'https://github.com/huggingface/transformers.js', licence: 'Apache-2.0' },
  { id: 'whisper', name: 'Whisper', url: 'https://github.com/openai/whisper', licence: 'MIT' },
  { id: 'onnx', name: 'ONNX Runtime Web', url: 'https://onnxruntime.ai', licence: 'MIT' },
  { id: 'silero', name: 'Silero VAD', url: 'https://github.com/snakers4/silero-vad', licence: 'MIT' },
  { id: 'paddle', name: 'PaddleOCR', url: 'https://github.com/PaddlePaddle/PaddleOCR', licence: 'Apache-2.0' },
  { id: 'anthropic', name: 'Anthropic SDK', url: 'https://github.com/anthropics/anthropic-sdk-typescript', licence: 'Apache-2.0' },
  { id: 'iconoir', name: 'Iconoir', url: 'https://iconoir.com', licence: 'MIT' },
  { id: 'sonner', name: 'Sonner', url: 'https://sonner.emilkowal.ski', licence: 'MIT' },
  { id: 'idb', name: 'idb-keyval', url: 'https://github.com/jakearchibald/idb-keyval', licence: 'Apache-2.0' },
  { id: 'roboto', name: 'Roboto', url: 'https://fonts.google.com/specimen/Roboto', licence: 'OFL-1.1' },
];

/** Settings › Credits: who made Subtle, and what it is built on. */
function CreditsPanel() {
  const tc = t.settings.credits;
  return (
    <div className="credits">
      <p className="credits-author">
        {tc.madeBy}{' '}
        <a href="https://jaysalvat.com" target="_blank" rel="noopener noreferrer">
          Jay Salvat
        </a>
      </p>
      <p className="note">
        {tc.version(__APP_VERSION__)} · {tc.source}{' '}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        <br />
        {tc.intro}
      </p>
      <ul className="credits-list">
        {CREDITS.map((c) => (
          <li key={c.id}>
            <a href={c.url} target="_blank" rel="noopener noreferrer">
              {c.name}
            </a>
            <span className="dim">{tc.roles[c.id]}</span>
            <span className="dim credits-licence">{c.licence}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const LOCAL_SERVERS = {
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
} as const;
type LocalServer = keyof typeof LOCAL_SERVERS | 'custom';
export const serverOf = (url: string): LocalServer =>
  (Object.keys(LOCAL_SERVERS) as (keyof typeof LOCAL_SERVERS)[]).find((k) => LOCAL_SERVERS[k] === url.replace(/\/+$/, '')) ?? 'custom';

/** AI service (Claude, ChatGPT): provider, API key and model. */
export function AiSettings() {
  const s = useApp((st) => st.settings);
  const set = useApp((st) => st.setSettings);
  const p = s.aiProvider;
  const a = t.mt.ai;
  return (
    <div className="ai-settings">
      <div className="field">
        <label htmlFor="ai-provider">{a.provider}</label>
        <ComboBox
          inputId="ai-provider"
          ariaLabel={a.provider}
          value={p}
          options={CLOUD_PROVIDERS.map((id) => ({ value: id, label: a.providers[id] }))}
          onChange={(v) => set({ aiProvider: v as typeof p })}
        />
      </div>
      <div className="field">
        <label htmlFor="ai-key">{a.key}</label>
        <input
          id="ai-key"
          className="input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={a.keyPlaceholder[p]}
          value={s.aiKeys[p]}
          onChange={(e) => set({ aiKeys: { ...s.aiKeys, [p]: e.target.value.trim() } })}
        />
      </div>
      <p className="note">
        {a.keyHelp[p].before}
        <a href={a.keyHelp[p].url} target="_blank" rel="noreferrer">
          {a.keyHelp[p].site}
        </a>
        {a.keyHelp[p].after}
      </p>
      <ModelPicker provider={p} />
      <p className="note">{a.sent}</p>
    </div>
  );
}

/** Local AI model: the app serving it, its address (filled in, editable for another port) and the model. */
export function LocalSettings() {
  const url = useApp((st) => st.settings.aiBaseUrl);
  const model = useApp((st) => st.settings.aiModels.local);
  const set = useApp((st) => st.setSettings);
  const server = serverOf(url);
  const a = t.mt.ai;
  const address = useRef<HTMLInputElement>(null);
  const pick = (v: LocalServer) => {
    if (v === server) return;
    // Another app has other models: the first one is picked once listed.
    set({
      aiBaseUrl: v === 'custom' ? '' : LOCAL_SERVERS[v],
      aiModels: { ...useApp.getState().settings.aiModels, local: '' },
    });
    // Other: an address to type.
    if (v === 'custom') setTimeout(() => address.current?.focus(), 0);
  };
  return (
    <div className="ai-settings">
      <div className="field">
        <label htmlFor="ai-server">{a.server}</label>
        <ComboBox
          inputId="ai-server"
          ariaLabel={a.server}
          value={server}
          options={(['ollama', 'lmstudio', 'custom'] as const).map((id) => ({ value: id, label: a.servers[id] }))}
          onChange={(v) => pick(v as LocalServer)}
        />
      </div>
      <div className="field">
        <label htmlFor="ai-url">{a.address}</label>
        <input
          id="ai-url"
          ref={address}
          className="input"
          spellCheck={false}
          value={url}
          placeholder={server === 'custom' ? a.addressExample : LOCAL_SERVERS.ollama}
          onChange={(e) => set({ aiBaseUrl: e.target.value.trim() })}
        />
      </div>
      <p className="note">{a.serverHelp[server]}</p>
      <ModelPicker provider="local" />
      {isCloudModel(model) ? <Alert>{a.sentCloud}</Alert> : <p className="note">{a.sentLocal}</p>}
    </div>
  );
}

/**
 * Model list from the provider (asked with the key), searchable, with the saved model kept if it
 * isn't listed; any other name can be typed.
 */
export function ModelPicker({ provider }: { provider: AiProvider }) {
  const apiKey = useApp((st) => st.settings.aiKeys[provider] ?? '');
  const baseUrl = useApp((st) => st.settings.aiBaseUrl);
  const models = useApp((st) => st.settings.aiModels);
  const set = useApp((st) => st.setSettings);
  const value = models[provider] ?? '';
  const [list, setList] = useState<AiModel[] | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const a = t.mt.ai;

  useEffect(() => {
    setList(null);
    if (provider === 'local' ? !baseUrl : !apiKey) return setState('idle');
    let live = true;
    setState('loading');
    const timer = setTimeout(() => {
      listModels(provider, {
        aiKeys: useApp.getState().settings.aiKeys,
        aiBaseUrl: baseUrl,
      })
        .then((l) => {
          if (!live) return;
          setList(l);
          setState('idle');
          // Local: nothing chosen yet → the first installed model.
          const st = useApp.getState().settings;
          if (provider === 'local' && !st.aiModels.local && l[0]) useApp.getState().setSettings({ aiModels: { ...st.aiModels, local: l[0].id } });
        })
        .catch(() => live && setState('error'));
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [provider, apiKey, baseUrl]);

  const choose = (id: string) => set({ aiModels: { ...models, [provider]: id } });
  const options: AiModel[] = list ? [...list] : [];
  for (const id of [value, DEFAULT_SETTINGS.aiModels[provider]]) if (id && !options.some((m) => m.id === id)) options.unshift({ id, name: id, created: 0 });
  const label = (m: AiModel) => m.name + (m.id === DEFAULT_SETTINGS.aiModels[provider] ? ` · ${a.recommended}` : '');

  return (
    <>
      <div className="field">
        <label htmlFor="ai-model">{a.model}</label>
        <ComboBox
          inputId="ai-model"
          ariaLabel={a.model}
          value={value}
          options={options.map((m) => ({ value: m.id, label: label(m), hint: m.name !== m.id ? m.id : undefined }))}
          onChange={choose}
          placeholder={a.pickModel}
          // Any name the provider knows, even when it isn't listed (new models, local tags).
          custom={(typed) => (/^\S+$/.test(typed) ? typed : null)}
          customLabel={a.useModel}
        />
      </div>
      {state !== 'idle' && <p className="note">{state === 'loading' ? a.modelsLoading : provider === 'local' ? a.serverError : a.modelsError}</p>}
      {state === 'idle' && provider === 'local' && list?.length === 0 && <Alert>{a.noLocalModel}</Alert>}
    </>
  );
}

/** Settings › App: install Subtle (Chrome's offer on a button), or how to, or that it is. */
export function InstallSetting() {
  const offer = useInstall((s) => s.offer);
  const installed = useInstall((s) => s.installed);
  const sounds = useApp((s) => s.settings.sounds);
  const proMode = useApp((s) => s.settings.proMode);
  const ti = t.install;
  return (
    <>
      {/* Not installed yet: an invitation first, framed, its button the tab's only primary one. */}
      {!installed && (
        <div className="install-card">
          <span>
            <strong>{ti.cardTitle}</strong>
            <span className="note">{offer ? ti.cardText : `${ti.cardText} ${ti.how}`}</span>
          </span>
          {offer && (
            <button className="btn primary" onClick={() => void installApp()}>
              {ti.button}
            </button>
          )}
        </div>
      )}
      <div className="group-title">{ti.title}</div>
      <LanguageSetting />
      {installed && (
        <div className="field">
          <label>{ti.label}</label>
          <span className="note">{ti.installed}</span>
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={sounds} onChange={(e) => useApp.getState().setSettings({ sounds: e.target.checked })} />
        <span>
          {t.settings.sounds}
          <br />
          <span className="note">{t.settings.soundsHint}</span>
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={proMode} onChange={(e) => useApp.getState().setSettings({ proMode: e.target.checked })} />
        <span>
          {t.settings.proMode}
          <br />
          <span className="note">{t.settings.proModeHint}</span>
        </span>
      </label>
    </>
  );
}

function LanguageSetting() {
  const [choice, setChoice] = useState<UiLanguageChoice>(uiLanguageChoice);
  // Each language by its own name; a new one in src/i18n's UI_LANGUAGE_INFO shows here.
  const options = [
    { value: 'auto', label: t.settings.languageAuto(UI_LANGUAGE_INFO[browserLanguage()].name) },
    ...UI_LANGUAGES.map((l) => ({ value: l, label: UI_LANGUAGE_INFO[l].name })),
  ];
  return (
    <div className="field">
      <label htmlFor="ui-language">{t.settings.language}</label>
      {/* A native select: a few choices, and a ComboBox would take the focus (and select its text) on opening. */}
      <select
        id="ui-language"
        className="select"
        value={choice}
        onChange={(e) => {
          const next = e.target.value as UiLanguageChoice;
          setChoice(next);
          setUiLanguageChoice(next);
          if (languageOf(next) !== uiLanguage)
            useApp.getState().notify(t.settings.languageReload, { stay: true, action: { label: t.install.reload, onClick: () => location.reload() } });
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
