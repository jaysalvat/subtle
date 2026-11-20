/**
 * A subtitle's number in a list (issues, previews, Shorten with AI…): "#12" (the same everywhere), right-aligned in a
 * column wide enough for 4 digits, muted (the accent on hover when it's a button). With `onGo`, a button that goes to it.
 * Use it wherever a list shows subtitle numbers, so they all look alike.
 */
import { t } from '../i18n';

export function CueNumber({ n, onGo }: { n: number; onGo?: () => void }) {
  if (!onGo) return <span className="cue-n tnum">#{n}</span>;
  return (
    <button type="button" className="cue-n tnum" title={t.common.goTo(n)} onClick={onGo}>
      #{n}
    </button>
  );
}
