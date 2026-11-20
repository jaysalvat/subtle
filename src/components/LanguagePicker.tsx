import { useMemo } from 'react';
import { t } from '../i18n';
import { isLangCode, languageName, LANGUAGES } from '../lib/languages';
import { ComboBox } from './ComboBox';

/** Language list with search; any other code can be typed (nl, pt-BR, zh-Hans…). */
export function LanguagePicker({ value, onChange, label = t.translate.language }: { value: string; onChange: (code: string) => void; label?: string }) {
  const options = useMemo(() => {
    const list = LANGUAGES.map((l) => ({ value: l.code, label: languageName(l.code), hint: l.code }));
    // A code typed before (not in the list) stays shown as the choice.
    return value && !LANGUAGES.some((l) => l.code === value) ? [...list, { value, label: value }] : list;
  }, [value]);
  return (
    <ComboBox
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel={label}
      placeholder={t.translate.search}
      custom={(typed) => (isLangCode(typed) ? typed : null)}
      customLabel={t.translate.useCode}
    />
  );
}
