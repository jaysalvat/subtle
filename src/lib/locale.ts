/** Numbers as the UI's language writes them ("2.4" / "2,4"): set once at start by src/i18n. */
let numberLocale = 'en-US';
export const setNumberLocale = (lang: string) => {
  numberLocale = lang === 'fr' ? 'fr-FR' : 'en-US';
};

/** `x` with exactly `digits` decimals, the UI's decimal mark. */
export const decimal = (x: number, digits: number) =>
  x.toLocaleString(numberLocale, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
