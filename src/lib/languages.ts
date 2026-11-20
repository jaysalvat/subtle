/** Translation languages. The code goes in the export name (my-film.fr.srt). */

export const LANGUAGES: { code: string; name: string }[] = [
  { code: 'fr', name: 'French' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'nb', name: 'Norwegian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'pl', name: 'Polish' },
  { code: 'cs', name: 'Czech' },
  { code: 'ro', name: 'Romanian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'el', name: 'Greek' },
  { code: 'tr', name: 'Turkish' },
  { code: 'ru', name: 'Russian' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh-Hans', name: 'Chinese (Simplified)' },
  { code: 'zh-Hant', name: 'Chinese (Traditional)' },
];

/** A language code like "fr", "pt-BR" or "zh-Hans" (BCP 47, language + optional region / script). */
export const isLangCode = (code: string) => /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(code.trim());

/** ISO 639-2 codes as MKV files write them ("fre", "eng"…) → our codes. */
const ISO_639_2: Record<string, string> = {
  fre: 'fr',
  fra: 'fr',
  eng: 'en',
  spa: 'es',
  ger: 'de',
  deu: 'de',
  ita: 'it',
  por: 'pt',
  dut: 'nl',
  nld: 'nl',
  swe: 'sv',
  dan: 'da',
  nor: 'nb',
  nob: 'nb',
  fin: 'fi',
  pol: 'pl',
  cze: 'cs',
  ces: 'cs',
  rum: 'ro',
  ron: 'ro',
  hun: 'hu',
  gre: 'el',
  ell: 'el',
  tur: 'tr',
  rus: 'ru',
  ukr: 'uk',
  ara: 'ar',
  heb: 'he',
  hin: 'hi',
  jpn: 'ja',
  kor: 'ko',
  chi: 'zh',
  zho: 'zh',
};

/** A film track's language ("fre", "fr-FR", "pt-BR", "und") → a code we name and export with, or null. */
export function langFromTrack(code: string): string | null {
  const c = code.trim();
  if (!c || c === 'und') return null;
  if (LANGUAGES.some((l) => l.code === c)) return c;
  const base = c.split('-')[0].toLowerCase();
  if (ISO_639_2[base]) return ISO_639_2[base];
  return /^[a-z]{2}$/.test(base) ? base : null;
}

/** The UI's language for language names (set once at start by src/i18n). */
let nameLocale = 'en';
export const setLanguageNameLocale = (locale: string) => {
  nameLocale = locale;
};

/**
 * A language's name in the UI's language: our English list, else the browser's names ("Portugais
 * brésilien"). Prompts to an AI model are in English: they pass `'en'`.
 */
export function languageName(code: string, locale = nameLocale): string {
  const listed = LANGUAGES.find((l) => l.code === code)?.name;
  if (locale === 'en' && listed) return listed;
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language' }).of(code);
    if (name && name !== code) return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  } catch {
    /* not a code the browser knows */
  }
  return listed ?? code;
}

/**
 * Language written in a subtitle file name, e.g. "Movie.2019.fr.srt" → "fr", "film.pt-BR.vtt" → "pt-BR".
 * Two-letter codes and the codes listed above only, so "Movie.HDR.srt" isn't taken for a language.
 */
export function langFromFileName(name: string): string | null {
  const m = /\.([a-z]{2,3}(?:-[A-Za-z]{2,4})?)\.(?:srt|vtt)$/i.exec(name);
  if (!m) return null;
  const code = m[1];
  if (/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(code) || LANGUAGES.some((l) => l.code === code)) return code;
  return null;
}
