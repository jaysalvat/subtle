/**
 * A subtitle's look, as buttons: bold (Pro mode), italics, capitals, colour (Pro mode), top / bottom.
 * Shared by the selected row of the list and the blocks of Sign the subtitles.
 */
import { t } from '../i18n';
import { useApp } from '../store/store';
import { ColourPicker } from './ColourPicker';
import { BoldIcon, CaseIcon, ItalicIcon, TopIcon } from './Icons';

export interface FormatState {
  bold: boolean;
  italic: boolean;
  upper: boolean;
  colour: string | null;
  top: boolean;
}

export interface FormatActions {
  onBold: () => void;
  onItalic: () => void;
  onCase: () => void;
  onColour: (colour: string | null) => void;
  onTop: () => void;
}

export function FormatButtons({
  bold,
  italic,
  upper,
  colour,
  top,
  onBold,
  onItalic,
  onCase,
  onColour,
  onTop,
  ownColours,
}: FormatState & FormatActions & { ownColours?: boolean }) {
  const proMode = useApp((s) => s.settings.proMode);
  return (
    <>
      {proMode && (
        <button
          className={`icon-btn sm ${bold ? 'pressed' : ''}`}
          aria-pressed={bold}
          aria-label={t.list.bold}
          title={bold ? t.list.boldOffHint : t.list.boldOnHint}
          onClick={onBold}
        >
          <BoldIcon />
        </button>
      )}
      <button
        className={`icon-btn sm ${italic ? 'pressed' : ''}`}
        aria-pressed={italic}
        aria-label={t.list.italic}
        title={italic ? t.list.italicOffHint : t.list.italicOnHint}
        onClick={onItalic}
      >
        <ItalicIcon />
      </button>
      <button className="icon-btn sm" aria-label={t.list.textCase} title={upper ? t.list.toSentenceHint : t.list.toUpperHint} onClick={onCase}>
        <CaseIcon />
      </button>
      {proMode && <ColourPicker colour={colour} onPick={onColour} recolour={!ownColours} />}
      <button
        className={`icon-btn sm ${top ? 'pressed' : ''}`}
        aria-pressed={top}
        aria-label={t.list.toTop}
        title={top ? t.list.toBottomHint : t.list.toTopHint}
        onClick={onTop}
      >
        <TopIcon />
      </button>
    </>
  );
}
