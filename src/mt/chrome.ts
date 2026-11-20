/**
 * Chrome's built-in translation (Translator API): on-device models, one per language pair, downloaded
 * once by Chrome. Chrome only. Some Chromium builds declare the API but never answer: guarded by a timeout.
 */
import { engineLangCandidates } from '../lib/mt';
import type { Engine, EngineState, Session } from './engine';

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
interface ChromeTranslator {
  translate(text: string, opts?: { signal?: AbortSignal }): Promise<string>;
  destroy?(): void;
}
interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
  create(o: { sourceLanguage: string; targetLanguage: string; signal?: AbortSignal; monitor?: (m: EventTarget) => void }): Promise<ChromeTranslator>;
}

const api = () => (globalThis as unknown as { Translator?: TranslatorStatic }).Translator;
const ANSWER_MS = 6000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);
}

/** First language pair (with fallbacks like pt-BR → pt) Chrome offers, and its availability. */
async function findPair(source: string, target: string): Promise<{ s: string; t: string; a: Availability } | 'timeout' | null> {
  const T = api()!;
  for (const s of engineLangCandidates(source))
    for (const t of engineLangCandidates(target)) {
      const a = await withTimeout(
        T.availability({ sourceLanguage: s, targetLanguage: t }).catch(() => 'unavailable' as const),
        ANSWER_MS,
      );
      if (a === 'timeout') return 'timeout';
      if (a !== 'unavailable') return { s, t, a };
    }
  return null;
}

export const chromeEngine: Engine = {
  id: 'chrome',

  async status(source, target): Promise<EngineState> {
    if (!api()) return 'unsupported';
    const p = await findPair(source, target);
    if (p === 'timeout') return 'noanswer';
    if (!p) return 'pair';
    return p.a === 'available' ? 'ready' : 'download';
  },

  async open(source, target, _settings, { onDownload, signal }): Promise<Session> {
    if (!api()) throw new Error('This browser has no built-in translation.');
    const p = await findPair(source, target);
    if (p === 'timeout') throw new Error('Chrome didn’t answer.');
    if (!p) throw new Error(`Chrome can’t translate ${source} to ${target}.`);
    const tr = await api()!.create({
      sourceLanguage: p.s,
      targetLanguage: p.t,
      signal,
      monitor: (m) => m.addEventListener('downloadprogress', (e) => onDownload?.((e as ProgressEvent).loaded)),
    });
    return {
      translate: (text) => tr.translate(text, { signal }),
      close: () => tr.destroy?.(),
    };
  },
};
