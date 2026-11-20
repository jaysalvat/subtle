import { useState, type ReactNode } from 'react';
import { openDroppedFile } from '../actions';
import { droppedHandles, pickSubtitleFile, pickVideoFile } from '../store/file';
import { SUBS_ACCEPT, VIDEO_ACCEPT } from '../lib/files';

interface Props {
  accept: string;
  onFile: (file: File) => void;
  className?: string;
  children: ReactNode;
  label: string;
  /** The file is for this zone only (a reference file): no app routing, no system picker. */
  own?: boolean;
}

/** A <label> wrapping a hidden file input: keyboard and screen-reader friendly, click and drag & drop. */
export function DropZone({ accept, onFile, className = '', children, label, own = false }: Props) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`dropzone ${className} ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      // The system picker keeps the file (Chrome): subtitles, so ⌘S can save into them; a video, so
      // it can be reopened in one click after a reload.
      onClick={(e) => {
        if (own) return;
        const pick = accept === SUBS_ACCEPT ? pickSubtitleFile : accept === VIDEO_ACCEPT ? pickVideoFile : null;
        if (!pick || !('showOpenFilePicker' in window) || (e.target as HTMLElement).tagName === 'INPUT') return;
        e.preventDefault();
        const input = e.currentTarget.querySelector('input') as HTMLInputElement | null;
        void pick(() => input?.click());
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        // Any zone takes any file: a .srt dropped on the video zone still goes to the subtitles.
        const files = Array.from(e.dataTransfer.files);
        if (own) return files[0] && onFile(files[0]);
        void droppedHandles(e).then((handles) => files.forEach((f, i) => openDroppedFile(f, handles[i] ?? null)));
      }}
    >
      <input
        type="file"
        accept={accept}
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      {children}
    </label>
  );
}

export { SUBS_ACCEPT, VIDEO_ACCEPT, isSubtitleFile, isVideoFile } from '../lib/files';
