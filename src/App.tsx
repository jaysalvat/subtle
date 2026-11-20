import { droppedHandles, saveFile } from './store/file';
import { spotCancel, spotEnd, spotStart } from './store/spot';
import { usePlayback } from './store/playback';
import { ConfirmHost } from './components/Confirm';
import { Tooltips } from './components/Tooltips';
import { Toaster } from 'sonner';
import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { Player } from './components/Player';
import { CueList } from './components/CueList';
import { focusField } from './store/caret';
import { Timeline } from './components/Timeline';
import { Dialogs } from './components/Dialogs';
import { editField, NON_MODAL, useApp } from './store/store';
import { ProjectsPage } from './components/ProjectsPage';
import { SmallScreen } from './components/SmallScreen';
import { SupportBanner } from './components/SupportBanner';
import { initProjects, useProjects } from './store/projects';
import { handleLaunchFiles, registerServiceWorker } from './store/install';
import { player } from './store/playback';
import './store/selectionFollow';
import { toggleLoop } from './store/loop';
import {
  addSceneNoteHere,
  switchEditSide,
  moveSelected,
  deleteSelected,
  goMark,
  goNext,
  goPrev,
  insertAtPlayhead,
  mergeSelected,
  nudge,
  setEdgeToNow,
  splitSelected,
  addBookmarkHere,
  goToBookmarkSlot,
  openDroppedFile,
  toggleBold,
  toggleItalic,
  togglePosition,
} from './actions';

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/**
 * ⌘S saves into the file (Save as… for new subtitles), ⇧⌘S exports a copy. Listened to first
 * (capture, on the window), whatever has the focus, so the browser's own "Save page" never runs.
 */
function useSaveShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.code !== 'KeyS') return;
      e.preventDefault();
      e.stopPropagation();
      const st = useApp.getState();
      if (!st.doc || st.creatingSubs) return;
      // Text being typed is only kept when its field loses focus: do that first, so it's saved too.
      const el = document.activeElement as HTMLElement | null;
      if (el?.tagName === 'TEXTAREA') el.blur();
      setTimeout(() => {
        if (e.shiftKey) useApp.getState().openDialog('export');
        else void saveFile();
      }, 0);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

function useShortcuts() {
  useEffect(() => {
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Enter') spotEnd();
    };
    // Focus lost while holding (another window): don't leave a subtitle half spotted.
    const onBlur = () => spotCancel();
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState();
      const mod = e.metaKey || e.ctrlKey;
      // ⌘← / ⌘→ is the browser's Back / Forward: one slip and the film is gone. Off here (in a text
      // field it still moves to the line's start / end).
      if (mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isTyping(e)) {
        e.preventDefault();
        return;
      }
      if (mod && e.key === ',') {
        e.preventDefault();
        st.openDialog('settings');
        return;
      }
      // ⌥T while translating: edit the other language, even while typing (the text box does it then).
      if (e.altKey && e.code === 'KeyT' && st.translation && !(st.dialog && !NON_MODAL.includes(st.dialog))) {
        e.preventDefault();
        switchEditSide();
        return;
      }
      // ⌥Space: play / pause, even while typing in a field.
      if (e.altKey && e.code === 'Space' && !(st.dialog && !NON_MODAL.includes(st.dialog))) {
        e.preventDefault();
        player.toggle();
        return;
      }
      // The Projects page: the editor's keys are off (Escape closes it, ProjectsPage).
      if (isTyping(e) || (st.dialog && !NON_MODAL.includes(st.dialog)) || useProjects.getState().pageOpen) return;
      // Side panels preview changes without history: undo / redo there is theirs.
      if (mod && st.dialog && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        toggleItalic();
        return;
      }
      // Bold: Pro mode only (Lite leaves ⌘B to the browser).
      if (mod && e.key.toLowerCase() === 'b' && st.settings.proMode) {
        e.preventDefault();
        toggleBold();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        st.setSelection(st.doc?.cues.map((c) => c.id) ?? []);
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod) return;
      // Spotting, while playing: Enter held = a subtitle from press to release. Paused, Enter types in
      // the selected subtitle (below).
      if (e.key === 'Enter' && usePlayback.getState().playing) {
        e.preventDefault();
        if (!e.repeat) spotStart();
        return;
      }
      switch (e.key) {
        case ' ':
          e.preventDefault();
          player.toggle();
          break;
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault();
          const sign = e.key === 'ArrowRight' ? 1 : -1;
          if (e.altKey && e.shiftKey) moveSelected(sign as 1 | -1);
          else if (e.altKey) nudge(sign as 1 | -1);
          else player.seek(player.now() + sign * (e.shiftKey ? 1000 : 100));
          break;
        }
        case 'ArrowUp':
        case ',':
          e.preventDefault();
          // ⌥: lines of dialogue · ⇧: bookmarks · ⌥⇧: scene notes (the least used).
          if (e.altKey && e.shiftKey) goMark('note', -1);
          else if (e.altKey) goMark('speech', -1);
          else if (e.shiftKey) goMark('bookmark', -1);
          else goPrev();
          break;
        case 'ArrowDown':
        case '.':
          e.preventDefault();
          // ⌥: lines of dialogue · ⇧: bookmarks · ⌥⇧: scene notes (the least used).
          if (e.altKey && e.shiftKey) goMark('note', 1);
          else if (e.altKey) goMark('speech', 1);
          else if (e.shiftKey) goMark('bookmark', 1);
          else goNext();
          break;
        case '[':
          setEdgeToNow('start');
          break;
        case ']':
          setEdgeToNow('end');
          break;
        case 'i':
        case 'I':
          insertAtPlayhead();
          break;
        case 's':
        case 'S':
          splitSelected();
          break;
        case 'm':
        case 'M':
          mergeSelected();
          break;
        case 'Backspace':
        case 'Delete':
          deleteSelected();
          break;
        case 'Escape':
          st.select(null);
          break;
        case '?':
          st.openDialog('shortcuts');
          break;
        case 'l':
        case 'L':
          toggleLoop();
          break;
        case 'b':
        case 'B':
          addBookmarkHere();
          break;
        case 'p':
        case 'P':
          // A tool side panel open (Check quality, Review with AI…): move it to the other side.
          if (st.dialog && NON_MODAL.includes(st.dialog)) st.setSettings({ panelSide: st.settings.panelSide === 'right' ? 'left' : 'right' });
          break;
        case 'n':
        case 'N':
          // Not typed into the note's text box, which opens and takes the focus right away.
          e.preventDefault();
          addSceneNoteHere();
          break;
        case 'Enter':
          // Start typing in the selected subtitle (its translation when translating).
          if (!st.dialog && st.selection.length === 1) {
            e.preventDefault();
            focusField(editField(st));
          }
          break;
        case 't':
        case 'T':
          togglePosition();
          break;
        default:
          if (/^[1-9]$/.test(e.key)) goToBookmarkSlot(Number(e.key));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Files dropped anywhere: route them by type. */
function useGlobalDrop() {
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      // Handles must be asked for during the event (to save into a dropped subtitle file later).
      void droppedHandles(e).then((handles) => files.forEach((f, i) => openDroppedFile(f, handles[i] ?? null)));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);
}

export default function App() {
  useShortcuts();
  useGlobalDrop();
  useSaveShortcut();
  const pageOpen = useProjects((s) => s.pageOpen);
  useEffect(() => {
    // Files Subtle was opened with (installed app) come after the last project is restored.
    void initProjects().then(() => handleLaunchFiles((f, h) => void openDroppedFile(f, h)));
    registerServiceWorker();
  }, []);

  return (
    <div className="app">
      <TopBar />
      <SupportBanner />
      {/* Over the editor, which stays loaded (the video keeps playing where it was). */}
      {pageOpen && <ProjectsPage />}
      <div className="middle">
        <Player />
        <CueList />
      </div>
      <Timeline />
      <Dialogs />
      <ConfirmHost />
      <SmallScreen />
      <Tooltips />
      <Toaster
        theme="dark"
        position="top-center"
        offset={{ top: 60 }}
        closeButton
        toastOptions={{ className: 'app-toast' }}
        style={{ '--normal-bg': 'var(--bg-raised)', '--normal-border': 'var(--border-strong)', '--normal-text': 'var(--text)' } as React.CSSProperties}
      />
    </div>
  );
}
