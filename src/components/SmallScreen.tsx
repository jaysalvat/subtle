/**
 * Phones and small windows: Subtle isn't made for them (no responsive layout, on purpose). A clean
 * screen over the app says so; CSS shows it (`.small-screen` in pages.css), so nothing unmounts when
 * a desktop window is only narrowed for a moment.
 */
import { t } from '../i18n';
import { Logo } from './Icons';

export function SmallScreen() {
  return (
    <div className="small-screen" role="alertdialog" aria-label={t.smallScreen.title}>
      <Logo size={72} />
      <h1>{t.app}</h1>
      <p className="small-screen-title">{t.smallScreen.title}</p>
      <p className="muted">{t.smallScreen.text}</p>
      <p className="small-screen-url">{location.host}</p>
    </div>
  );
}
