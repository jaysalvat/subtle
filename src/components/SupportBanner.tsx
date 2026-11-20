/**
 * Under the top bar when this browser misses something the work depends on (lib/support): what
 * won't work, Details (the full list), and a way to close it for good.
 */
import { t } from '../i18n';
import { worthTelling } from '../lib/support';
import { useApp } from '../store/store';
import { closeSupportBanner, useSupport } from '../store/support';
import { CloseX } from './Icons';

export function SupportBanner() {
  const missing = useSupport((s) => s.missing);
  const closed = useSupport((s) => s.bannerClosed);
  if (closed || !worthTelling(missing)) return null;
  // What the work depends on (installing is in Details).
  const what = missing
    .filter((f) => f !== 'install')
    .map((f) => t.support.short[f])
    .join(', ');
  return (
    <div className="support-banner" role="status">
      <span>{t.support.banner(what)}</span>
      <button className="btn sm" onClick={() => useApp.getState().openDialog('support')}>
        {t.support.details}
      </button>
      <span className="spacer" />
      <button className="icon-btn" aria-label={t.support.close} title={t.support.close} onClick={closeSupportBanner}>
        <CloseX />
      </button>
    </div>
  );
}
