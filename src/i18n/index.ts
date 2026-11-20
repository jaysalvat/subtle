/**
 * The UI's texts in the chosen language (Settings › General › App › Language, else the browser's):
 * picked once at start, a change applies after a reload. Every component imports `t` from here.
 *
 * English (en.ts) is always there and complete: it gives the shape and fills whatever another
 * language lacks, phrase by phrase (`fillFrom`), so a language can ship half translated. TypeScript
 * still refuses a key English doesn't have; the tests list what each language lacks. Any other language is its own file, downloaded only when it's the
 * UI's language (≈ 15 KB each), before the app draws (top-level await). The offline cache keeps only
 * the one used (vite.config.ts leaves languages out of the precache).
 *
 * Adding a language: write xx.ts (`export const xx: Translation = { … }`), add a line to UI_LANGUAGE_INFO.
 */
import { setLanguageNameLocale } from '../lib/languages';
import { setNumberLocale } from '../lib/locale';
import { fillFrom, type DeepPartial } from '../lib/partial';
import { en, type Strings } from './en';

/** Another language's texts: any phrase may be missing (English shows instead). */
export type Translation = DeepPartial<Strings>;

interface UiLanguageInfo {
  /** Its name in itself, recognisable whatever the UI shows ("Français"). */
  name: string;
  load: () => Promise<Translation>;
}

export const UI_LANGUAGE_INFO = {
  en: { name: 'English', load: async () => en },
  fr: { name: 'Français', load: async () => (await import('./fr')).fr },
} satisfies Record<string, UiLanguageInfo>;

export type UiLanguage = keyof typeof UI_LANGUAGE_INFO;
export type UiLanguageChoice = 'auto' | UiLanguage;
export const UI_LANGUAGES = Object.keys(UI_LANGUAGE_INFO) as UiLanguage[];
const isUiLanguage = (v: unknown): v is UiLanguage => typeof v === 'string' && v in UI_LANGUAGE_INFO;
const KEY = 'subtle.uiLanguage';

export function uiLanguageChoice(): UiLanguageChoice {
  try {
    const v = localStorage.getItem(KEY);
    return isUiLanguage(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function setUiLanguageChoice(choice: UiLanguageChoice) {
  try {
    if (choice === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* private mode */
  }
}

/** The browser's first preferred language Subtle speaks ("fr-CA" → fr), else English. */
export function browserLanguage(): UiLanguage {
  const prefs = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  for (const p of prefs) {
    const base = p?.toLowerCase().split('-')[0];
    if (isUiLanguage(base)) return base;
  }
  return 'en';
}

/** The language a choice gives. */
export const languageOf = (choice: UiLanguageChoice): UiLanguage => (choice === 'auto' ? browserLanguage() : choice);

export const uiLanguage: UiLanguage = languageOf(uiLanguageChoice());
/** The texts, missing phrases in English. A language that fails to load (offline before it was ever used) is all English. */
export const t = fillFrom<Strings>(en, await UI_LANGUAGE_INFO[uiLanguage].load().catch(() => en));

setLanguageNameLocale(uiLanguage);
setNumberLocale(uiLanguage);
if (typeof document !== 'undefined') document.documentElement.lang = uiLanguage;
