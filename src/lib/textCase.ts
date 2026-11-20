/**
 * Upper case ↔ sentence case, for text typed or read (OCR) in capitals: "WHERE ARE YOU? COME IN." ↔
 * "Where are you? Come in." Tags (<i>, {\an8}) are left alone. Names lose their capital in sentence
 * case: that's the user's to fix.
 */
const TAG = /(\{\\[^}]*\}|<\/?[a-zA-Z][^>]*>)/;

/** Mostly capitals (at least 80 % of at least 2 letters). */
export function isUpperCase(text: string): boolean {
  const letters = text.replace(new RegExp(TAG.source, 'g'), '').match(/\p{L}/gu) ?? [];
  if (letters.length < 2) return false;
  const upper = letters.filter((l) => l !== l.toLowerCase() && l === l.toUpperCase()).length;
  return upper / letters.length >= 0.8;
}

const mapText = (text: string, f: (s: string) => string) =>
  text
    .split(TAG)
    .map((part, i) => (i % 2 ? part : f(part)))
    .join('');

export function toUpperCase(text: string, lang?: string): string {
  return mapText(text, (s) => s.toLocaleUpperCase(lang));
}

/** Lower case, with a capital at the start of each sentence (and each dialogue line); English "I" stays. */
export function toSentenceCase(text: string, lang?: string): string {
  let start = true;
  // A new line continues the sentence, unless it's a dialogue line ("- …").
  let lineStart = true;
  const out = mapText(text, (s) => {
    let r = '';
    for (const ch of s.toLocaleLowerCase(lang)) {
      if (ch === '\n') lineStart = true;
      else if (lineStart && /[-–—]/.test(ch)) start = true;
      else if (!/\s/.test(ch)) lineStart = false;
      if (start && /\p{L}/u.test(ch)) {
        r += ch.toLocaleUpperCase(lang);
        start = false;
        continue;
      }
      if (/[.!?…]/.test(ch)) start = true;
      else if (start && /[^\s"«»“”'‘’\-–—¿¡([]/.test(ch)) start = false; // "5:51 pm" doesn't start a sentence
      r += ch;
    }
    return r;
  });
  return !lang || lang.startsWith('en') ? out.replace(/(^|[^\p{L}'’])i(?=$|[^\p{L}]|['’](?:m|ll|d|ve)\b)/gu, '$1I') : out;
}

/** The toggle: capitals → sentence case, anything else → capitals. */
export function toggleCase(text: string, lang?: string): string {
  return isUpperCase(text) ? toSentenceCase(text, lang) : toUpperCase(text, lang);
}
