/**
 * A small rounded bubble: a count next to a title or on a button (subtitles, bookmarks), or a mark
 * (`ai`: the AI mark, in the AI colour). `corner`: small, on an icon button's top-right corner. Styles: `.pill` in base.css.
 * Every feature that uses AI shows `AiPill` (what sells it): use it for each new one.
 */
import type { ReactNode } from 'react';
import { t } from '../i18n';

export function Pill({ children, ai, corner }: { children: ReactNode; ai?: boolean; corner?: boolean }) {
  return <span className={`pill${ai ? ' ai' : ''}${corner ? ' corner' : ''}`}>{children}</span>;
}

/** The AI mark. */
export const AiPill = ({ corner }: { corner?: boolean }) => (
  <Pill ai corner={corner}>
    {t.common.ai}
  </Pill>
);
