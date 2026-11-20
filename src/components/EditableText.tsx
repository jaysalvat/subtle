/**
 * A text you can rename in place: shown as text with a pencil; a click turns it into a field
 * (Enter or leaving it saves, Escape cancels). Keys don't reach the app's shortcuts meanwhile.
 */
import { useEffect, useState } from 'react';
import { PencilIcon } from './Icons';

export function EditableText({
  value,
  onSave,
  label,
  display,
  editing,
  onDone,
}: {
  value: string;
  onSave: (v: string) => void;
  label: string;
  /** What's shown (e.g. shortened); `value` is what's edited. */ display?: string;
  /** Turned on from elsewhere (a Rename menu item); `onDone` when the field closes. */ editing?: boolean;
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    if (editing) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  const end = () => {
    setDraft(null);
    onDone?.();
  };
  if (draft === null)
    return (
      <button
        type="button"
        className="editable-text"
        title={label}
        aria-label={`${label}: ${value}`}
        onClick={(e) => {
          e.stopPropagation();
          setDraft(value);
        }}
      >
        <span>{display ?? value}</span>
        <PencilIcon size={13} />
      </button>
    );
  const save = () => {
    if (draft !== value) onSave(draft);
    end();
  };
  return (
    <input
      className="input editable-text-input"
      aria-label={label}
      value={draft}
      autoFocus
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') end();
      }}
    />
  );
}
