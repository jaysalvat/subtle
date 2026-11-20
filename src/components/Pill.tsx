/**
 * A small rounded bubble: a count next to a title or on a button (subtitles, bookmarks), or a mark
 * (`accent`: the AI). `corner`: small, on an icon button's top-right corner. Styles: `.pill` in base.css.
 * Every feature that uses AI shows `AiPill` (what sells it): use it for each new one.
 */
import type { ReactNode } from 'react';
import { t } from '../i18n';

export function Pill({ children, accent, corner }: { children: ReactNode; accent?: boolean; corner?: boolean }) {
  return <span className={`pill${accent ? ' accent' : ''}${corner ? ' corner' : ''}`}>{children}</span>;
}

/** The AI mark. */
export const AiPill = ({ corner }: { corner?: boolean }) => (
  <Pill accent corner={corner}>
    {t.common.ai}
  </Pill>
);
