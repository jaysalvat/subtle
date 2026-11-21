/** The open window or side panel (store `dialog`), each in its own file under ./dialogs. */
import { SpaceOutPanel } from './SpaceOutPanel';
import { BalancePanel } from './BalancePanel';
import { AlignPanel } from './AlignPanel';
import { SyncRefPanel } from './SyncRefPanel';
import { useApp } from '../store/store';
import { FrameRatePanel } from './FrameRate';
import { QualityPanel } from './QualityPanel';
import { ReviewPanel } from './ReviewAi';
import { SyncAssistant } from './SyncAssistant';
import { ExportDialog } from './dialogs/ExportDialog';
import { AddSubsDialog, FilmSubsDialog, SupportDialog, ZipSubsDialog } from './dialogs/MiscDialogs';
import { SettingsDialog } from './dialogs/SettingsDialog';
import { ShortcutsDialog } from './dialogs/ShortcutsDialog';
import { SttDialog } from './dialogs/SttDialog';
import { HiDialog, PunctuationDialog, ReplaceDialog } from './dialogs/TextDialogs';
import { SignPanel } from './SignPanel';
import { MinDurationPanel } from './MinDurationPanel';
import { SyncTwoPanel } from './SyncTwoPanel';
import { ShiftPanel } from './ShiftPanel';
import { RetranslateDialog, TranslateDialog } from './dialogs/TranslateDialog';

export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  const hasDoc = useApp((s) => !!s.doc);
  if (!dialog) return null;
  if (dialog === 'settings') return <SettingsDialog />;
  if (dialog === 'shortcuts') return <ShortcutsDialog />;
  if (dialog === 'stt') return <SttDialog />;
  if (dialog === 'filmSubs') return <FilmSubsDialog />;
  if (dialog === 'zipSubs') return <ZipSubsDialog />;
  if (dialog === 'support') return <SupportDialog />;
  if (!hasDoc) return null;
  switch (dialog) {
    case 'shift':
      return <ShiftPanel />;
    case 'sync':
      return <SyncTwoPanel />;
    case 'fps':
      return <FrameRatePanel />;
    case 'quality':
      return <QualityPanel />;
    case 'review':
      return <ReviewPanel />;
    case 'checkTranslation':
      return <ReviewPanel check />;
    case 'syncAssistant':
      return <SyncAssistant />;
    case 'addSubs':
      return <AddSubsDialog />;
    case 'minDuration':
      return <MinDurationPanel />;
    case 'sign':
      return <SignPanel />;
    case 'align':
      return <AlignPanel />;
    case 'syncRef':
      return <SyncRefPanel />;
    case 'hi':
      return <HiDialog />;
    case 'balance':
      return <BalancePanel />;
    case 'spaceOut':
      return <SpaceOutPanel />;
    case 'punctuation':
      return <PunctuationDialog />;
    case 'replace':
      return <ReplaceDialog />;
    case 'translate':
      return <TranslateDialog />;
    case 'retranslate':
      return <RetranslateDialog />;
    case 'export':
      return <ExportDialog />;
  }
}
